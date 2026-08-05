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
	import BulkCameraCapture from '$lib/components/BulkCameraCapture.svelte';
	import { Camera, Mic, MicOff, Trash2, ImagePlus, FileText, Sparkles } from 'lucide-svelte';

	const workflow = bulkSweepWorkflow;

	let fileInput: HTMLInputElement;
	let mediaRecorder: MediaRecorder | null = null;
	let speechRecognition: any = null;
	let narrationGeneration = 0;
	let routeActive = true;
	let isRecording = $state(false);
	let liveSupported = $state(false);
	const removingPhotoIds = new SvelteSet<string>();
	let photoDrafts = $state<Record<string, { note: string; groupLabel: string; ignored: boolean }>>(
		{}
	);
	let photoActionErrors = $state<Record<string, string>>({});
	let photoRetryKinds = $state<Record<string, 'edit' | 'remove'>>({});
	let transcriptPersistenceError = $state('');
	let transcriptPreviewNotice = $state('');
	let filePickerError = $state('');
	let failedFilePickerFiles = $state<File[]>([]);
	let retryingFilePicker = $state(false);
	let photoRetryPatches = $state<
		Record<string, Partial<{ note: string; groupLabel: string; ignored: boolean }>>
	>({});

	interface NarrationSession {
		generation: number;
		workflowIdentity: BulkMissionIdentity;
		stream: MediaStream;
		recorder: MediaRecorder;
		speechRecognition: any;
		chunks: Blob[];
		recordingStartedAt: number;
		recordingStoppedAt: number | null;
		stopping: boolean;
		invalidated: boolean;
	}

	let narrationSession: NarrationSession | null = null;

	function isCurrentNarration(session: NarrationSession): boolean {
		return (
			routeActive &&
			narrationSession === session &&
			session.generation === narrationGeneration &&
			!session.invalidated &&
			workflow.getMissionIdentity().missionId === session.workflowIdentity.missionId &&
			workflow.getMissionIdentity().generation === session.workflowIdentity.generation
		);
	}

	function stopStream(stream: MediaStream): void {
		stream.getTracks().forEach((track) => {
			try {
				track.stop();
			} catch (error) {
				console.warn('Could not stop narration track', error);
			}
		});
	}

	function reportTranscriptFailure(session: NarrationSession, error: unknown): void {
		if (!isCurrentNarration(session)) return;
		const detail = error instanceof Error ? error.message : 'Durable transcript save failed.';
		transcriptPersistenceError = `Transcript could not be saved. Retry or save your notes. ${detail}`;
	}

	onMount(async () => {
		await bulkMissionDb.cleanupStaleMissions();
		if (!workflow.state.locationId) {
			await workflow.recover();
		}
		if (!workflow.state.locationId) goto(resolve('/location'));
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		liveSupported = Boolean(SpeechRecognition);
	});

	onDestroy(() => {
		routeActive = false;
		stopNarration(true);
		workflow.cancelActiveTranscriptions();
	});

	async function addFiles(files: FileList | File[] | null) {
		if (!files?.length) return;
		const selectedFiles = Array.from(files);
		try {
			await workflow.addPhotos(selectedFiles);
			failedFilePickerFiles = [];
			filePickerError = '';
			if (fileInput) fileInput.value = '';
		} catch (cause) {
			failedFilePickerFiles = selectedFiles;
			const message =
				cause instanceof Error
					? cause.message
					: workflow.state.error || 'Photo could not be saved. Earlier evidence was preserved.';
			filePickerError = `${message.replace(/[.!?]+$/, '')}. Retry the selected files.`;
		}
	}

	async function retryFailedFilePickerFiles() {
		if (retryingFilePicker || failedFilePickerFiles.length === 0) return;
		retryingFilePicker = true;
		try {
			await addFiles(failedFilePickerFiles);
		} finally {
			retryingFilePicker = false;
		}
	}

	async function addCapturedPhoto(event: CustomEvent<Blob>) {
		try {
			await workflow.addPhotos([
				new File([event.detail], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }),
			]);
		} catch {
			showToast(
				'Photo could not be saved. Earlier photos remain safe; retry this capture.',
				'error'
			);
			throw new Error('Photo could not be saved. Retry this capture.');
		}
	}

	async function startNarration() {
		transcriptPreviewNotice =
			'Browser preview is optional; server transcription will save the canonical transcript.';
		stopNarration(true);
		const generation = ++narrationGeneration;
		const workflowIdentity = workflow.getMissionIdentity();
		let stream: MediaStream | null = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			if (
				!routeActive ||
				generation !== narrationGeneration ||
				workflow.getMissionIdentity().missionId !== workflowIdentity.missionId ||
				workflow.getMissionIdentity().generation !== workflowIdentity.generation
			) {
				stopStream(stream);
				return;
			}
			const recorder = new MediaRecorder(stream);
			const session: NarrationSession = {
				generation,
				workflowIdentity,
				stream,
				recorder,
				speechRecognition: null,
				chunks: [],
				recordingStartedAt: Date.now(),
				recordingStoppedAt: null,
				stopping: false,
				invalidated: false,
			};
			narrationSession = session;
			mediaRecorder = recorder;
			recorder.ondataavailable = (event) => {
				if (isCurrentNarration(session) && event.data.size > 0) session.chunks.push(event.data);
			};
			recorder.onstop = () => {
				session.recordingStoppedAt = Date.now();
				void finalizeNarration(session);
			};
			recorder.start();
			isRecording = true;
			startSpeechRecognition(session);
		} catch (error) {
			if (stream) stopStream(stream);
			if (generation === narrationGeneration) {
				narrationSession = null;
				mediaRecorder = null;
				isRecording = false;
			}
			showToast('Microphone unavailable. You can type notes instead.', 'warning');
			console.warn(error);
		}
	}

	function startSpeechRecognition(session: NarrationSession): void {
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognition) return;
		try {
			const recognition = new SpeechRecognition();
			session.speechRecognition = recognition;
			speechRecognition = recognition;
			recognition.continuous = true;
			recognition.interimResults = true;
			recognition.onresult = (event: any) => {
				if (!isCurrentNarration(session)) return;
				for (let i = event.resultIndex; i < event.results.length; i++) {
					const result = event.results[i];
					const text = result[0]?.transcript ?? '';
					const write = Promise.resolve().then(() =>
						workflow.updateBrowserTranscriptPreview(
							text,
							Boolean(result.isFinal),
							session.workflowIdentity
						)
					);
					const handledWrite = write.then(
						() => {},
						(error) => reportTranscriptFailure(session, error)
					);
					void handledWrite;
				}
			};
			recognition.onerror = () => {
				if (!isCurrentNarration(session)) return;
				liveSupported = false;
				session.speechRecognition = null;
				if (speechRecognition === recognition) speechRecognition = null;
				try {
					recognition.stop();
				} catch {
					// Recognition failure must leave MediaRecorder available for server fallback.
				}
			};
			recognition.start();
		} catch (error) {
			liveSupported = false;
			const failedRecognition = session.speechRecognition;
			session.speechRecognition = null;
			if (speechRecognition === failedRecognition) speechRecognition = null;
			console.warn('Browser speech recognition unavailable; using server transcription', error);
		}
	}

	async function finalizeNarration(session: NarrationSession): Promise<void> {
		try {
			if (!isCurrentNarration(session)) return;
			if (!isCurrentNarration(session)) return;
			const blob = new Blob(session.chunks, {
				type: session.recorder.mimeType || 'audio/webm',
			});
			if (blob.size === 0) return;
			const missionStartedAt = workflow.state.startedAtMs;
			if (missionStartedAt == null) throw new Error('Mission timing is unavailable');
			const startedAt = Math.max(0, session.recordingStartedAt - missionStartedAt);
			const endedAt = Math.max(
				startedAt,
				(session.recordingStoppedAt ?? Date.now()) - missionStartedAt
			);
			const segmentId = await workflow.addAudioSegment(
				blob,
				blob.type || 'audio/webm',
				startedAt,
				endedAt,
				session.workflowIdentity
			);
			if (!isCurrentNarration(session)) return;
			if (segmentId) await workflow.transcribeAudioSegment(segmentId);
		} catch (error) {
			reportTranscriptFailure(session, error);
		} finally {
			stopStream(session.stream);
			if (narrationSession === session) narrationSession = null;
			if (mediaRecorder === session.recorder) mediaRecorder = null;
			if (speechRecognition === session.speechRecognition) speechRecognition = null;
			if (isCurrentNarration(session)) isRecording = false;
		}
	}

	function stopNarration(invalidate = false): void {
		const session = narrationSession;
		if (!session) {
			isRecording = false;
			return;
		}
		if (invalidate) {
			narrationGeneration += 1;
			session.invalidated = true;
		}
		if (session.speechRecognition) {
			try {
				session.speechRecognition.stop();
			} catch {
				// Recognition may already have failed; recorder cleanup still proceeds.
			}
			session.speechRecognition = null;
		}
		if (session.recorder.state !== 'inactive') {
			session.stopping = true;
			try {
				session.recorder.stop();
			} catch (error) {
				reportTranscriptFailure(session, error);
			}
		}
		if (invalidate) {
			stopStream(session.stream);
			narrationSession = null;
			mediaRecorder = null;
			speechRecognition = null;
		}
		isRecording = false;
	}

	function setPhotoDraft(
		id: string,
		patch: Partial<{ note: string; groupLabel: string; ignored: boolean }>
	) {
		const photo = workflow.state.photos.find((entry) => entry.id === id);
		if (!photo) return;
		const current = photoDrafts[id] ?? {
			note: photo.note,
			groupLabel: photo.groupLabel,
			ignored: photo.ignored,
		};
		photoDrafts = { ...photoDrafts, [id]: { ...current, ...patch } };
	}

	async function savePhotoPatch(
		id: string,
		patch: Partial<{ note: string; groupLabel: string; ignored: boolean }>
	): Promise<void> {
		if (!Object.keys(patch).length) return;
		const photoBefore = workflow.state.photos.find((entry) => entry.id === id);
		const previousValues = photoBefore
			? {
					note: photoBefore.note,
					groupLabel: photoBefore.groupLabel,
					ignored: photoBefore.ignored,
				}
			: null;
		photoRetryPatches = { ...photoRetryPatches, [id]: patch };
		try {
			await workflow.updatePhoto(id, patch);
			const nextDrafts = { ...photoDrafts };
			delete nextDrafts[id];
			photoDrafts = nextDrafts;
			const nextErrors = { ...photoActionErrors };
			delete nextErrors[id];
			photoActionErrors = nextErrors;
			const nextKinds = { ...photoRetryKinds };
			delete nextKinds[id];
			photoRetryKinds = nextKinds;
			const nextPatches = { ...photoRetryPatches };
			delete nextPatches[id];
			photoRetryPatches = nextPatches;
		} catch (cause) {
			await workflow.recover().catch(() => false);
			if (previousValues) photoDrafts = { ...photoDrafts, [id]: previousValues };
			photoActionErrors = {
				...photoActionErrors,
				[id]: cause instanceof Error ? cause.message : 'Photo could not be saved. Try again.',
			};
			photoRetryKinds = { ...photoRetryKinds, [id]: 'edit' };
			showToast('Photo edit failed. The previous value was kept; retry when ready.', 'error');
		}
	}

	async function savePhotoField(
		id: string,
		field: 'note' | 'groupLabel' | 'ignored'
	): Promise<void> {
		const photo = workflow.state.photos.find((entry) => entry.id === id);
		if (!photo) return;
		const draft = photoDrafts[id];
		const value = draft?.[field] ?? photo[field];
		await savePhotoPatch(id, { [field]: value });
	}

	async function removePhoto(id: string): Promise<void> {
		if (removingPhotoIds.has(id)) return;
		removingPhotoIds.add(id);
		try {
			await workflow.removePhoto(id);
			const nextErrors = { ...photoActionErrors };
			delete nextErrors[id];
			photoActionErrors = nextErrors;
			const nextKinds = { ...photoRetryKinds };
			delete nextKinds[id];
			photoRetryKinds = nextKinds;
			const nextDrafts = { ...photoDrafts };
			delete nextDrafts[id];
			photoDrafts = nextDrafts;
		} catch (cause) {
			photoActionErrors = {
				...photoActionErrors,
				[id]: cause instanceof Error ? cause.message : 'Photo could not be removed. Try again.',
			};
			photoRetryKinds = { ...photoRetryKinds, [id]: 'remove' };
			showToast('Photo removal failed. Nothing was removed; retry when ready.', 'error');
		} finally {
			removingPhotoIds.delete(id);
		}
	}

	async function flushTranscriptPersistence(): Promise<boolean> {
		const maybeWorkflow = workflow as unknown as {
			flushTranscriptPersistence?: () => Promise<void> | void;
		};
		try {
			if (typeof maybeWorkflow.flushTranscriptPersistence === 'function') {
				await maybeWorkflow.flushTranscriptPersistence();
			}
			transcriptPersistenceError = '';
			return true;
		} catch (error) {
			const detail =
				workflow.state.error || (error instanceof Error ? error.message : 'Durable save failed.');
			transcriptPersistenceError = `Transcript could not save. Retry. ${detail}`;
			return false;
		}
	}

	async function retryPhotoAction(id: string): Promise<void> {
		if (photoRetryKinds[id] === 'remove') {
			await removePhoto(id);
			return;
		}
		await savePhotoPatch(id, photoRetryPatches[id] ?? {});
	}

	async function reviewTranscript(): Promise<void> {
		if (!(await flushTranscriptPersistence())) return;
		if (workflow.state.photos.filter((photo) => !photo.ignored).length === 0) {
			showToast('Add at least one photo first', 'warning');
			return;
		}
		workflow.enterTranscriptReview();
	}

	async function analyze() {
		if (!(await flushTranscriptPersistence())) return;
		const result = await workflow.analyze();
		if (result) goto(resolve('/bulk-review'));
		else if (workflow.state.error) showToast(workflow.state.error, 'error');
	}

	async function retryTranscription(segmentId: string): Promise<void> {
		await workflow.retryAudioTranscription(segmentId);
	}
</script>

<svelte:head>
	<title>Bulk Sweep - Homebox Companion</title>
</svelte:head>

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
			oninput={(event) => workflow.setAreaLabel((event.currentTarget as HTMLInputElement).value)}
		/>
	</label>
	<BulkCameraCapture
		oncapture={(blob: Blob) => addCapturedPhoto(new CustomEvent('capture', { detail: blob }))}
	/>

	<div class="mb-4 grid grid-cols-2 gap-3">
		<Button variant="primary" onclick={() => fileInput.click()}>
			<ImagePlus size={18} strokeWidth={1.5} />
			<span>Add Photos</span>
		</Button>
		{#if isRecording}
			<Button variant="secondary" onclick={stopNarration}>
				<MicOff size={18} strokeWidth={1.5} />
				<span>Stop</span>
			</Button>
		{:else}
			<Button variant="secondary" onclick={startNarration}>
				<Mic size={18} strokeWidth={1.5} />
				<span>Narrate</span>
			</Button>
		{/if}
	</div>
	{#if workflow.state.photos.length > 0}
		<Button variant="secondary" full onclick={() => workflow.discardPersistedMission()}>
			<span>Discard this sweep</span>
		</Button>
	{/if}
	<input
		bind:this={fileInput}
		class="hidden"
		type="file"
		accept="image/*"
		capture="environment"
		multiple
		onchange={(event) => void addFiles(event.currentTarget.files)}
	/>
	{#if filePickerError}
		<div
			class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-error-500/30 bg-error-500/10 p-3"
			role="alert"
		>
			<p class="text-error-200 text-body-sm">{filePickerError}</p>
			<Button
				variant="secondary"
				disabled={retryingFilePicker}
				onclick={() => void retryFailedFilePickerFiles()}>Try again</Button
			>
		</div>
	{/if}

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<div class="mb-3 flex items-center justify-between gap-3">
			<div class="flex items-center gap-2 text-neutral-100">
				<FileText size={18} strokeWidth={1.5} />
				<h3 class="font-semibold">Live Transcript</h3>
			</div>
			<span class="text-caption text-neutral-500">
				{#if isRecording}
					recording
				{:else if liveSupported}
					live ready
				{:else}
					type notes
				{/if}
			</span>
		</div>
		<textarea
			class="input min-h-32"
			placeholder="Talk while capturing, or type notes here. You can fix this before analysis."
			value={workflow.state.editedTranscriptText}
			oninput={(event) =>
				void workflow.editTranscript(event.currentTarget.value).catch(() => undefined)}
		></textarea>
		{#if workflow.state.interimTranscriptText}
			<p class="mt-2 text-body-sm italic text-neutral-400">
				{workflow.state.interimTranscriptText}
			</p>
		{/if}
		{#if transcriptPreviewNotice}
			<div class="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="alert">
				{transcriptPreviewNotice}
			</div>
		{:else if transcriptPersistenceError}
			<p class="text-error-300 mt-2 text-body-sm" role="alert">
				{transcriptPersistenceError}
			</p>
		{:else if workflow.state.error}
			<p class="text-error-300 mt-2 text-body-sm" role="alert">
				{workflow.state.error}
			</p>
		{/if}
	</section>

	<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
		<h3 class="mb-3 font-semibold text-neutral-100">Recordings</h3>
		<div class="space-y-2">
			{#each workflow.state.audioSegments as segment (segment.id)}
				<div class="flex items-center justify-between gap-3 rounded-lg bg-neutral-800 p-3">
					<div class="min-w-0">
						<p class="truncate text-body-sm text-neutral-200">Recording {segment.id.slice(-6)}</p>
						<p class="text-caption text-neutral-400">
							{segment.status} · attempt {segment.retryCount ?? 0}
						</p>
						{#if segment.error}<p class="text-error-300 text-caption">
								{segment.error.message}
							</p>{/if}
					</div>
					{#if segment.status === 'failed'}
						<Button variant="secondary" onclick={() => void retryTranscription(segment.id)}>
							Retry transcription
						</Button>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<div class="mb-4 flex items-center justify-between">
		<h3 class="font-semibold text-neutral-100">Photos ({workflow.state.photos.length})</h3>
		<span class="text-caption text-neutral-500">Ignored photos are kept out of analysis</span>
	</div>

	<div class="grid grid-cols-2 gap-3">
		{#each workflow.state.photos as photo, index (photo.id)}
			<div class="overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900">
				<div class="relative aspect-square bg-neutral-800">
					<img
						src={photo.previewUrl}
						alt="Bulk sweep capture {index + 1}"
						class="h-full w-full object-cover"
					/>
					<span
						class="absolute left-2 top-2 rounded bg-neutral-950/80 px-2 py-1 text-caption text-neutral-200"
					>
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
						onkeydown={(event) => {
							if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
						}}
					/>
					<input
						class="input-sm"
						placeholder="Quick note"
						value={photoDrafts[photo.id]?.note ?? photo.note}
						oninput={(event) => setPhotoDraft(photo.id, { note: event.currentTarget.value })}
						onchange={() => void savePhotoField(photo.id, 'note')}
						onkeydown={(event) => {
							if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
						}}
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
							aria-busy={removingPhotoIds.has(photo.id)}
							disabled={removingPhotoIds.has(photo.id)}
							onclick={() => void removePhoto(photo.id)}
						>
							<Trash2 size={16} strokeWidth={1.5} />
						</button>
					</div>
					{#if photoActionErrors[photo.id]}
						<div class="flex items-center justify-between gap-2" role="status" aria-live="polite">
							<p class="text-caption text-warning-300">{photoActionErrors[photo.id]}</p>
							<Button
								variant="secondary"
								disabled={removingPhotoIds.has(photo.id)}
								onclick={() => void retryPhotoAction(photo.id)}>Retry</Button
							>
						</div>
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
		<Button variant="secondary" full onclick={() => workflow.cancelAnalysis()}
			>Cancel analysis</Button
		>
	{:else if workflow.state.status === 'transcript_review'}
		<Button variant="primary" full onclick={analyze}>
			<Sparkles size={18} strokeWidth={1.5} />
			<span>Analyze with this transcript</span>
		</Button>
	{:else}
		<Button variant="primary" full onclick={reviewTranscript}>
			<Camera size={18} strokeWidth={1.5} />
			<span>Review Transcript</span>
		</Button>
	{/if}
</div>
