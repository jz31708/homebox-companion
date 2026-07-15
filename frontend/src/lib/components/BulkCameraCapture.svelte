<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Camera, CameraOff, Zap } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';

	let video = $state<HTMLVideoElement>();
	let { oncapture = () => {} } = $props<{ oncapture?: (blob: Blob) => void }>();
	let stream: MediaStream | null = null;
	let error = $state<string | null>(null);
	let active = $state(false);
	let torch = $state(false);

	async function start() {
		error = null;
		try {
			stream?.getTracks().forEach((track) => track.stop());
			stream = await navigator.mediaDevices.getUserMedia({
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 1920 },
					height: { ideal: 1080 },
				},
				audio: false,
			});
			if (!video) return;
			video.srcObject = stream;
			await video.play();
			active = true;
		} catch (cause) {
			active = false;
			error =
				cause instanceof DOMException && cause.name === 'NotAllowedError'
					? 'Camera permission denied.'
					: 'Camera unavailable. Use Add Photos below.';
		}
	}

	function stop() {
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		active = false;
	}

	async function shutter() {
		if (!video?.videoWidth || !video.videoHeight) return;
		const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(video.videoWidth * scale);
		canvas.height = Math.round(video.videoHeight * scale);
		canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', 0.82)
		);
		if (blob) oncapture(blob);
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

	onDestroy(stop);
</script>

<div class="mb-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950">
	{#if active}
		<video bind:this={video} class="aspect-[3/4] w-full object-cover" playsinline muted></video>
		<div class="flex items-center justify-center gap-4 p-3">
			<Button variant="secondary" onclick={toggleTorch}><Zap size={18} /></Button>
			<button
				class="h-16 w-16 rounded-full border-4 border-neutral-100 bg-neutral-200"
				aria-label="Take photo"
				onclick={shutter}
			></button>
			<Button variant="secondary" onclick={stop}><CameraOff size={18} /></Button>
		</div>
	{:else}
		<div class="p-4">
			{#if error}<p class="mb-3 text-body-sm text-warning-300">{error}</p>{/if}
			<Button variant="primary" full onclick={start}><Camera size={18} /> Start camera</Button>
		</div>
	{/if}
</div>
