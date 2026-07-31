<script lang="ts">
	import { onDestroy } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { Camera, CameraOff, Zap } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';

	let video = $state<HTMLVideoElement>();
	let { oncapture = () => {} } = $props<{ oncapture?: (blob: Blob) => Promise<void> | void }>();
	let stream: MediaStream | null = null;
	let error = $state<string | null>(null);
	let active = $state(false);
	let starting = $state(false);
	let torch = $state(false);
	let persisting = $state(false);
	let persistingGeneration: number | null = null;
	let lifecycleGeneration = 0;
	let cancelMetadataWait: (() => void) | null = null;

	function stopTracks(candidate: MediaStream | null) {
		candidate?.getTracks().forEach((track) => track.stop());
	}

	function waitForMetadata(element: HTMLVideoElement, generation: number): Promise<void> {
		if (element.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const cleanup = () => {
				element.removeEventListener('loadedmetadata', onLoaded);
				element.removeEventListener('error', onError);
				if (cancelMetadataWait === cancel) cancelMetadataWait = null;
			};
			const finish = (callback: () => void) => {
				if (settled) return;
				settled = true;
				cleanup();
				callback();
			};
			const onLoaded = () => finish(resolve);
			const onError = () => finish(() => reject(new Error('Camera metadata unavailable')));
			const cancel = () => finish(() => reject(new Error('Camera startup canceled')));

			cancelMetadataWait = cancel;
			element.addEventListener('loadedmetadata', onLoaded, { once: true });
			element.addEventListener('error', onError, { once: true });
			if (generation !== lifecycleGeneration) cancel();
		});
	}

	async function start() {
		const generation = ++lifecycleGeneration;
		error = null;
		starting = true;
		cancelMetadataWait?.();
		cancelMetadataWait = null;
		if (video) video.srcObject = null;
		stopTracks(stream);
		stream = null;
		active = false;
		try {
			const acquiredStream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 1920 },
					height: { ideal: 1080 },
				},
				audio: false,
			});
			if (generation !== lifecycleGeneration) {
				stopTracks(acquiredStream);
				return;
			}
			if (!video) {
				stopTracks(acquiredStream);
				throw new Error('Camera preview is not mounted');
			}
			stream = acquiredStream;
			video.srcObject = acquiredStream;
			await waitForMetadata(video, generation);
			if (generation !== lifecycleGeneration) return;
			await video.play();
			if (generation !== lifecycleGeneration) return;
			active = true;
		} catch (cause) {
			if (generation !== lifecycleGeneration) return;
			stopTracks(stream);
			stream = null;
			if (video) video.srcObject = null;
			active = false;
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? 'Camera permission denied.'
					: 'Camera unavailable. Use Add Photos below.';
		} finally {
			if (generation === lifecycleGeneration) starting = false;
		}
	}

	function stop() {
		lifecycleGeneration += 1;
		cancelMetadataWait?.();
		cancelMetadataWait = null;
		if (video) video.srcObject = null;
		stopTracks(stream);
		stream = null;
		active = false;
		starting = false;
		torch = false;
		if (persistingGeneration !== null) {
			persisting = false;
			persistingGeneration = null;
		}
	}

	function isCaptureGenerationActive(generation: number, captureStream: MediaStream | null) {
		const currentVideo = video;
		return Boolean(
			generation === lifecycleGeneration &&
			active &&
			captureStream &&
			stream === captureStream &&
			currentVideo?.srcObject === captureStream &&
			currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
			currentVideo.videoWidth > 0 &&
			currentVideo.videoHeight > 0 &&
			captureStream.getVideoTracks().some((track) => track.readyState !== 'ended')
		);
	}

	async function shutter() {
		const generation = lifecycleGeneration;
		const captureStream = stream;
		if (persisting || !isCaptureGenerationActive(generation, captureStream)) return;
		const currentVideo = video;
		if (!currentVideo) return;
		persisting = true;
		persistingGeneration = generation;
		const scale = Math.min(1, 1920 / Math.max(currentVideo.videoWidth, currentVideo.videoHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(currentVideo.videoWidth * scale);
		canvas.height = Math.round(currentVideo.videoHeight * scale);
		canvas.getContext('2d')?.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
		try {
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', 0.82)
			);
			if (!isCaptureGenerationActive(generation, captureStream)) return;
			if (!blob || blob.size === 0) {
				error = 'The camera returned an empty photo. Please try again.';
				return;
			}
			await oncapture(blob);
		} catch (cause) {
			if (generation === lifecycleGeneration) {
				error = cause instanceof Error ? cause.message : 'Photo could not be saved. Try again.';
			}
		} finally {
			if (persistingGeneration === generation) {
				persisting = false;
				persistingGeneration = null;
			}
		}
	}

	async function toggleTorch() {
		const track = stream?.getVideoTracks()[0];
		if (!track || !('applyConstraints' in track)) return;
		torch = !torch;
		try {
			await track.applyConstraints({ advanced: [{ torch }] } as unknown as Parameters<
				typeof track.applyConstraints
			>[0]);
		} catch {
			torch = false;
		}
	}

	beforeNavigate(stop);
	onDestroy(stop);
</script>

<div class="mb-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950">
	<video
		bind:this={video}
		class:invisible={!active}
		class="aspect-[3/4] w-full object-cover"
		playsinline
		muted
	></video>
	{#if active}
		<div class="flex items-center justify-center gap-4 p-3">
			<Button variant="secondary" onclick={toggleTorch}><Zap size={18} /></Button>
			<button
				class="h-16 w-16 rounded-full border-4 border-neutral-100 bg-neutral-200"
				aria-label="Take photo"
				disabled={persisting}
				onclick={shutter}
			></button>
			<Button variant="secondary" onclick={stop}><CameraOff size={18} /></Button>
		</div>
	{:else}
		<div class="p-4">
			{#if error}<p class="mb-3 text-body-sm text-warning-300">{error}</p>{/if}
			<Button variant="primary" full onclick={start} disabled={starting}>
				<Camera size={18} />
				{starting ? 'Starting camera…' : 'Start camera'}
			</Button>
		</div>
	{/if}
	{#if active && error}
		<p class="px-4 pb-3 text-body-sm text-warning-300" role="status" aria-live="polite">{error}</p>
	{/if}
</div>
