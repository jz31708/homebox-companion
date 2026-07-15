<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { bulkSweepWorkflow } from '$lib/workflows/bulkSweep.svelte';
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
	let recordingStartedAt = 0;
	let audioChunkIndex = 0;
	let isRecording = $state(false);
	let liveSupported = $state(false);

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
		stopNarration();
	});

	async function addFiles(files: FileList | null) {
		if (!files?.length) return;
		await workflow.addPhotos(Array.from(files));
		if (fileInput) fileInput.value = '';
	}

	async function addCapturedPhoto(event: CustomEvent<Blob>) {
		await workflow.addPhotos([
			new File([event.detail], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }),
		]);
	}

	async function startNarration() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			audioChunkIndex = 0;
			recordingStartedAt = Date.now();
			mediaRecorder = new MediaRecorder(stream);
			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					const chunkStart = recordingStartedAt - (workflow.state.startedAtMs ?? recordingStartedAt) + audioChunkIndex * 30_000;
					audioChunkIndex += 1;
					void workflow.addAudioSegment(event.data, event.data.type || 'audio/webm', chunkStart, chunkStart + 30_000);
				}
			};
			mediaRecorder.onstop = () => {
				stream.getTracks().forEach((track) => track.stop());
			};
			mediaRecorder.start(30_000);
			startSpeechRecognition();
			isRecording = true;
		} catch (error) {
			showToast('Microphone unavailable. You can type notes instead.', 'warning');
			console.warn(error);
		}
	}

	function startSpeechRecognition() {
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognition) return;
		speechRecognition = new SpeechRecognition();
		speechRecognition.continuous = true;
		speechRecognition.interimResults = true;
		speechRecognition.onresult = (event: any) => {
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i];
				const text = result[0]?.transcript ?? '';
				workflow.appendLiveTranscript(text, result.isFinal);
			}
		};
		speechRecognition.onerror = () => {
			liveSupported = false;
		};
		speechRecognition.start();
	}

	function stopNarration() {
		if (speechRecognition) {
			speechRecognition.stop();
			speechRecognition = null;
		}
		if (mediaRecorder && mediaRecorder.state !== 'inactive') {
			mediaRecorder.stop();
		}
		mediaRecorder = null;
		isRecording = false;
	}

	function reviewTranscript() {
		if (workflow.state.photos.filter((photo) => !photo.ignored).length === 0) {
			showToast('Add at least one photo first', 'warning');
			return;
		}
		workflow.enterTranscriptReview();
	}

	async function analyze() {
		const result = await workflow.analyze();
		if (result) goto(resolve('/bulk-review'));
		else if (workflow.state.error) showToast(workflow.state.error, 'error');
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
		onchange={(event) => addFiles(event.currentTarget.files)}
	/>

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
			oninput={(event) => workflow.editTranscript(event.currentTarget.value)}
		></textarea>
		{#if workflow.state.interimTranscriptText}
			<p class="mt-2 text-body-sm italic text-neutral-400">
				{workflow.state.interimTranscriptText}
			</p>
		{/if}
	</section>
	{#if workflow.state.audioSegments.length > 0}
		<section class="mb-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
			<h3 class="mb-2 font-semibold text-neutral-100">Narration segments</h3>
			{#each workflow.state.audioSegments as segment (segment.id)}
				<div class="flex items-center justify-between gap-3 border-t border-neutral-800 py-2 text-body-sm">
					<span class="text-neutral-300">{segment.transcriptStatus}</span>
					{#if segment.transcriptStatus === 'failed'}
						<button class="text-blue-300 underline" type="button" onclick={() => workflow.retryAudioTranscription(segment.id)}>Retry</button>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	<div class="mb-4 flex items-center justify-between">
		<h3 class="font-semibold text-neutral-100">Photos ({workflow.state.photos.length})</h3>
		<span class="text-caption text-neutral-500"
			>{workflow.state.photos.filter((photo) => !photo.ignored).length} ready · offline-safe</span
		>
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
				<div class="flex items-center justify-between gap-2 p-3">
					<span class="text-caption text-neutral-500"
						>{photo.ignored ? 'Ignored' : 'Saved locally'}</span
					>
					<div class="flex items-center justify-between gap-2">
						<label class="flex items-center gap-2 text-body-sm text-neutral-300">
							<input
								type="checkbox"
								checked={photo.ignored}
								onchange={(event) =>
									workflow.updatePhoto(photo.id, { ignored: event.currentTarget.checked })}
							/>
							Ignore
						</label>
						<button
							class="btn-icon"
							type="button"
							aria-label="Remove photo"
							onclick={() => workflow.removePhoto(photo.id)}
						>
							<Trash2 size={16} strokeWidth={1.5} />
						</button>
					</div>
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
	{#if workflow.state.status === 'transcript_review'}
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
