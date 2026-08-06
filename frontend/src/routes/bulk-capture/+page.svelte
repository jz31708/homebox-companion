<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { bulkSweepWorkflow, type BulkMissionIdentity } from '$lib/workflows/bulkSweep.svelte';
	import * as bulkMissionDb from '$lib/services/bulkMissionDb';
	import { showToast } from '$lib/stores/ui.svelte';
	import Button from '$lib/components/Button.svelte';
	import StepIndicator from '$lib/components/StepIndicator.svelte';
	import BackLink from '$lib/components/BackLink.svelte';
	import AnalysisProgressBar from '$lib/components/AnalysisProgressBar.svelte';
	import BulkContinuousCapture from '$lib/components/BulkContinuousCapture.svelte';
	import type { CaptureAudioResult, CapturedFrame } from '$lib/shared/ingestionCaptureCore';
	import { FileText, ImagePlus, Sparkles, Trash2 } from 'lucide-svelte';

	const workflow = bulkSweepWorkflow;

	let fileInput: HTMLInputElement;
	let captureStudio: { finishSweep(): Promise<void> } | null = null;
	let speechRecognition: any = null;
	let routeActive = true;
	let isRecording = $state(false);
	let liveSupported = $state(false);
	let sweepIdentity: BulkMissionIdentity | null = null;
	const removingPhotoIds = new SvelteSet<string>();
	const retryingAudioIds = new SvelteSet<string>();
	let audioActionErrors = $state<Record<string, string>>({});
	let photoDrafts = $state<Record<string, { note: string; groupLabel: string; ignored: boolean }>>({});
	let photoActionErrors = $state<Record<string, string>>({});
	let transcriptPersistenceError = $state('');
	let transcriptPreviewNotice = $state('');
	let filePickerError = $state('');
	let failedFilePickerFiles = $state<File[]>([]);
	let retryingFilePicker = $state(false);
	let discardingSweep = $state(false);

	function isCurrentIdentity(identity: BulkMissionIdentity | null): identity is BulkMissionIdentity {
		if (!identity || !routeActive) return false;
		const current = workflow.getMissionIdentity();
		return current.missionId === identity.missionId && current.generation === identity.generation;
	}

	function stopSpeechPreview(): void {
		if (!speechRecognition) return;
		try {
			speechRecognition.stop();
		} catch {
			// Recognition may already be stopped.
		}
		speechRecognition = null;
	}

	function startSpeechPreview(identity: BulkMissionIdentity): void {
		stopSpeechPreview();
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognition) return;
		try {
			const recognition = new SpeechRecognition();
			recognition.continuous = true;
			recognition.interimResults = true;
			recognition.onresult = (event: any) => {
				if (!isCurrentIdentity(identity)) return;
				for (let index = event.resultIndex; index < event.results.length; index += 1) {
					const result = event.results[index];
					workflow.updateBrowserTranscriptPreview(
						result[0]?.transcript ?? '',
						Boolean(result.isFinal),
						identity
					);
				}
			};
			recognition.onerror = () => {
				if (speechRecognition === recognition) speechRecognition = null;
			};
			recognition.onend = () => {
				if (!isRecording || !isCurrentIdentity(identity) || speechRecognition !== recognition) return;
				setTimeout(() => {
					try {
						recognition.start();
					} catch {
						// Some browsers require a delay before restarting recognition.
					}
				}, 250);
			};
			speechRecognition = recognition;
			recognition.start();
		} catch {
			speechRecognition = null;
		}
	}

	onMount(async () => {
		await bulkMissionDb.cleanupStaleMissions();
		if (!workflow.state.locationId) await workflow.recover();
		if (!workflow.state.locationId) await goto(resolve('/location'));
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		liveSupported = Boolean(SpeechRecognition);
	});

	onDestroy(() => {
		routeActive = false;
		stopSpeechPreview();
		workflow.cancelActiveTranscriptions();
	});

	async function addFiles(files: FileList | File[] | null): Promise<void> {
		if (!files?.length) return;
		const selected = Array.from(files);
		try {
			await workflow.addPhotos(selected);
			failedFilePickerFiles = [];
			filePickerError = '';
			if (fileInput) fileInput.value = '';
		} catch (error) {
			failedFilePickerFiles = selected;
			filePickerError =
				error instanceof Error
					? error.message
					: 'Imported photos could not be saved. Earlier evidence was preserved.';
		}
	}

	async function retryFailedFiles(): Promise<void> {
		if (!failedFilePickerFiles.length || retryingFilePicker) return;
		retryingFilePicker = true;
		try {
			await addFiles(failedFilePickerFiles);
		} finally {
			retryingFilePicker = false;
		}
	}

	async function addCapturedPhoto(frame: CapturedFrame): Promise<void> {
		await workflow.addCapturedFrame(frame);
	}

	async function handleStudioStart(detail: { microphoneAvailable: boolean }): Promise<void> {
		sweepIdentity = workflow.getMissionIdentity();
		isRecording = detail.microphoneAvailable;
		transcriptPreviewNotice = detail.microphoneAvailable
			? 'Narration is recording with the live camera. Browser text is preview-only; server transcription is canonical.'
			: 'Microphone unavailable. Photos and typed notes remain available.';
		if (detail.microphoneAvailable && liveSupported) startSpeechPreview(sweepIdentity);
	}

	async function handleStudioAudio(audio: CaptureAudioResult): Promise<void> {
		const identity = sweepIdentity;
		if (!isCurrentIdentity(identity)) return;
		const missionStartedAt = workflow.state.startedAtMs;
		if (missionStartedAt == null) throw new Error('Mission timing is unavailable');
		const startedAt = Math.max(0, audio.startedAtMs - missionStartedAt);
		const endedAt = Math.max(startedAt, audio.endedAtMs - missionStartedAt);
		const segmentId = await workflow.addAudioSegment(
			audio.blob,
			audio.mimeType,
			startedAt,
			endedAt,
			identity
		);
		if (segmentId && isCurrentIdentity(identity)) await workflow.transcribeAudioSegment(segmentId);
	}

	async function handleStudioStop(): Promise<void> {
		stopSpeechPreview();
		isRecording = false;
		sweepIdentity = null;
	}

	async function finishActiveSweep(): Promise<boolean> {
		try {
			await captureStudio?.finishSweep();
			return true;
		} catch (error) {
			showToast(error instanceof Error ? error.message : 'Sweep could not finish safely.', 'error');
			return false;
		}
	}

	function setPhotoDraft(
		id: string,
		patch: Partial<{ note: string; groupLabel: string; ignored: boolean }>
	): void {
		const photo = workflow.state.photos.find((entry) => entry.id === id);
		if (!photo) return;
		photoDrafts = {
			...photoDrafts,
			[id]: {
				note: photoDrafts[id]?.note ?? photo.note,
				groupLabel: photoDrafts[id]?.groupLabel ?? photo.groupLabel,
				ignored: photoDrafts[id]?.ignored ?? photo.ignored,
				...patch,
			},
		};
	}

	async function savePhotoField(id: string, field: 'note' | 'groupLabel' | 'ignored'): Promise<void> {
		const photo = workflow.state.photos.find((entry) => entry.id === id);
		if (!photo) return;
		const value = photoDrafts[id]?.[field] ?? photo[field];
		try {
			await workflow.updatePhoto(id, { [field]: value });
			const next = { ...photoDrafts };
			delete next[id];
			photoDrafts = next;
			const errors = { ...photoActionErrors };
			delete errors[id];
			photoActionErrors = errors;
		} catch (error) {
			photoActionErrors = {
				...photoActionErrors,
				[id]: error instanceof Error ? error.message : 'Photo change could not be saved.',
			};
		}
	}

	async function removePhoto(id: string): Promise<void> {
		if (removingPhotoIds.has(id)) return;
		removingPhotoIds.add(id);
		try {
			await workflow.removePhoto(id);
			const errors = { ...photoActionErrors };
			delete errors[id];
			photoActionErrors = errors;
		} catch (error) {
			photoActionErrors = {
				...photoActionErrors,
				[id]: error instanceof Error ? error.message : 'Photo could not be removed.',
			};
		} finally {
			removingPhotoIds.delete(id);
		}
	}

	async function flushTranscriptPersistence(): Promise<boolean> {
		try {
			await workflow.flushTranscriptPersistence();
			transcriptPersistenceError = '';
			return true;
		} catch (error) {
			transcriptPersistenceError =
				error instanceof Error ? error.message : 'Transcript could not be saved.';
			return false;
		}
	}

	async function reviewTranscript(): Promise<void> {
		if (!(await finishActiveSweep())) return;
		if (!(await flushTranscriptPersistence())) return;
		if (!workflow.state.photos.some((photo) => !photo.ignored)) {
			showToast('Add at least one photo first', 'warning');
			return;
		}
		workflow.enterTranscriptReview();
	}

	async function analyze(): Promise<void> {
		if (!(await finishActiveSweep())) return;
		if (!(await flushTranscriptPersistence())) return;
		const result = await workflow.analyze();
		if (result) await goto(resolve('/bulk-review'));
		else if (workflow.state.error) showToast(workflow.state.error, 'error');
	}

	async function discardSweep(): Promise<void> {
		if (discardingSweep || !(await finishActiveSweep())) return;
		discardingSweep = true;
		try {
			await workflow.discardPersistedMission();
			await goto(resolve('/location'));
		} finally {
			discardingSweep = false;
		}
	}

	async function retryTranscription(segmentId: string): Promise<void> {
		if (retryingAudioIds.has(segmentId)) return;
		retryingAudioIds.add(segmentId);
		try {
			await workflow.retryAudioTranscription(segmentId);
			const next = { ...audioActionErrors };
			delete next[segmentId];
			audioActionErrors = next;
		} catch {
			audioActionErrors = {
				...audioActionErrors,
				[segmentId]: 'Transcription retry failed. The recording remains saved.',
			};
		} finally {
			retryingAudioIds.delete(segmentId);
		}
	}
</script>

<svelte:head><title>Bulk Sweep - Homebox Companion</title></svelte:head>

<div class="animate-in pb-36">
	<StepIndicator currentStep={2} />
	<BackLink href="/mode" label="Back to mode choice" />
	<h2 class="mb-1 text-h2 text-neutral-100">Bulk Sweep</h2>
	<p class="mb-4 text-body-sm text-neutral-400">{workflow.state.locationPath}</p>

	<label class="mb-4 block text-body-sm text-neutral-300">
		Area label (optional)
		<input
			class="input mt-2 w-full"
			value={workflow.state.areaLabel ?? ''}
			placeholder="left desk drawer or box 3"
			oninput={(event) => workflow.setAreaLabel(event.currentTarget.value)}
		/>
	</label>

	<BulkContinuousCapture
		bind:this={captureStudio}
		oncapture={addCapturedPhoto}
		onaudio={handleStudioAudio}
		onstart={handleStudioStart}
		onstop={handleStudioStop}
	/>

	<div class="mb-4">
		<Button variant="secondary" full onclick={() => fileInput.click()}>
			<ImagePlus size={18} strokeWidth={1.5} />
			<span>Import existing photos</span>
		</Button>
	</div>
	<input
		bind:this={fileInput}
		class="hidden"
		type="file"
		accept="image/*"
		multiple
		onchange={(event) => void addFiles(event.currentTarget.files)}
	/>
	{#if filePickerError}
		<div class="mb-4 rounded-lg border border-error-500/30 bg-error-500/10 p-3" role="alert">
			<p class="text-body-sm text-error-200">{filePickerError}</p>
			<Button variant="secondary" disabled={retryingFilePicker} onclick={retryFailedFiles}>Retry import</Button>
		</div>
	{/if}

	{#if workflow.state.photos.length > 0}
		<div class="mb-4">
			<Button variant="secondary" full disabled={discardingSweep} onclick={discardSweep}>
				Discard this sweep
			</Button>
		</div>
	{/if}

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<div class="flex items-center gap-2 text-neutral-100">
				<FileText size={18} strokeWidth={1.5} />
				<h3 class="font-semibold">Live Transcript</h3>
			</div>
			<span class="text-caption text-neutral-500">
				{isRecording ? 'recording' : liveSupported ? 'preview ready' : 'type notes'}
			</span>
		</div>
		<textarea
			class="input min-h-32"
			placeholder="Talk while capturing, or type notes here. You can fix this before analysis."
			value={workflow.state.editedTranscriptText}
			oninput={(event) => void workflow.editTranscript(event.currentTarget.value).catch(() => undefined)}
		></textarea>
		{#if workflow.state.interimTranscriptText}
			<p class="mt-2 text-body-sm italic text-neutral-400">{workflow.state.interimTranscriptText}</p>
		{/if}
		{#if transcriptPreviewNotice}
			<p class="mt-2 text-body-sm text-neutral-400">{transcriptPreviewNotice}</p>
		{/if}
		{#if transcriptPersistenceError || workflow.state.error}
			<p class="mt-2 text-body-sm text-error-300" role="alert">
				{transcriptPersistenceError || workflow.state.error}
			</p>
		{/if}
	</section>

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<h3 class="mb-3 font-semibold text-neutral-100">Recordings</h3>
		<div class="space-y-2">
			{#each workflow.state.audioSegments as segment (segment.id)}
				<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-800 p-3">
					<div class="min-w-0">
						<p class="truncate text-body-sm text-neutral-200">Recording {segment.id.slice(-6)}</p>
						<p class="text-caption text-neutral-400">{segment.status} · attempt {segment.retryCount ?? 0}</p>
						{#if segment.error}<p class="text-caption text-error-300">{segment.error.message}</p>{/if}
						{#if audioActionErrors[segment.id]}<p class="text-caption text-error-300">{audioActionErrors[segment.id]}</p>{/if}
					</div>
					<p class="text-caption text-neutral-400">
						{segment.status === 'persisted'
							? 'Saved, waiting for transcription'
							: segment.status === 'transcribing'
								? 'Transcribing'
								: segment.status === 'done'
									? 'Transcribed'
									: segment.status === 'failed'
										? 'Transcription failed'
										: 'Ignored'}
					</p>
					{#if segment.status === 'failed'}
						<Button
							variant="secondary"
							disabled={retryingAudioIds.has(segment.id)}
							ariaBusy={retryingAudioIds.has(segment.id)}
							onclick={() => void retryTranscription(segment.id)}
						>Retry transcription</Button>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<div class="mb-4 flex items-center justify-between gap-3">
		<h3 class="font-semibold text-neutral-100">Photos ({workflow.state.photos.length})</h3>
		<span class="text-caption text-neutral-500">Only durable photos appear here</span>
	</div>
	<div class="grid grid-cols-2 gap-3">
		{#each workflow.state.photos as photo, index (photo.id)}
			<div class="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
				<div class="relative aspect-square bg-neutral-800">
					<img src={photo.previewUrl} alt="Bulk sweep capture {index + 1}" class="h-full w-full object-cover" />
					<span class="absolute left-2 top-2 rounded bg-neutral-950/80 px-2 py-1 text-caption text-neutral-200">
						P{String(index).padStart(3, '0')}
					</span>
				</div>
				<div class="space-y-2 p-3">
					<input
						class="input-sm"
						placeholder="Group label"
						value={photoDrafts[photo.id]?.groupLabel ?? photo.groupLabel}
						oninput={(event) => setPhotoDraft(photo.id, { groupLabel: event.currentTarget.value })}
						onchange={() => void savePhotoField(photo.id, 'groupLabel')}
					/>
					<input
						class="input-sm"
						placeholder="Quick note"
						value={photoDrafts[photo.id]?.note ?? photo.note}
						oninput={(event) => setPhotoDraft(photo.id, { note: event.currentTarget.value })}
						onchange={() => void savePhotoField(photo.id, 'note')}
					/>
					<div class="flex items-center justify-between gap-2">
						<label class="flex items-center gap-2 text-body-sm text-neutral-300">
							<input
								type="checkbox"
								checked={photoDrafts[photo.id]?.ignored ?? photo.ignored}
								onchange={(event) => {
									setPhotoDraft(photo.id, { ignored: event.currentTarget.checked });
									void savePhotoField(photo.id, 'ignored');
								}}
							/>
							Ignore
						</label>
						<button
							class="btn-icon"
							type="button"
							aria-label="Remove photo"
							disabled={removingPhotoIds.has(photo.id)}
							onclick={() => void removePhoto(photo.id)}
						><Trash2 size={16} strokeWidth={1.5} /></button>
					</div>
					{#if photoActionErrors[photo.id]}
						<p class="text-caption text-warning-300">{photoActionErrors[photo.id]}</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	{#if workflow.state.analysisProgress}
		<div class="mt-4">
			<AnalysisProgressBar
				current={workflow.state.analysisProgress.current}
				total={workflow.state.analysisProgress.total}
				message={workflow.state.analysisProgress.message}
			/>
		</div>
	{/if}
</div>

<div class="fixed-bottom-panel p-4">
	{#if workflow.state.status === 'analyzing'}
		<Button variant="secondary" full onclick={() => workflow.cancelAnalysis()}>Cancel analysis</Button>
	{:else if workflow.state.status === 'transcript_review'}
		<Button variant="primary" full onclick={analyze}>
			<Sparkles size={18} strokeWidth={1.5} />
			<span>Analyze with this transcript</span>
		</Button>
	{:else}
		<Button variant="primary" full onclick={reviewTranscript}>
			<span>Review Transcript</span>
		</Button>
	{/if}
</div>
