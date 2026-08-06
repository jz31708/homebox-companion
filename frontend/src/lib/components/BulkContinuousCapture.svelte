<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { Camera, CameraOff, Mic, MicOff, Zap } from 'lucide-svelte';
	import Button from '$lib/components/Button.svelte';
	import {
		ContinuousCaptureSession,
		DurableCaptureQueue,
		type CaptureAudioResult,
		type CapturedFrame,
		type CaptureSessionSnapshot,
		type DurableQueueSnapshot,
	} from '$lib/shared/ingestionCaptureCore';

	let {
		oncapture = async () => {},
		onaudio = async () => {},
		onstart = () => {},
		onstop = () => {},
	} = $props<{
		oncapture?: (frame: CapturedFrame) => Promise<void> | void;
		onaudio?: (audio: CaptureAudioResult) => Promise<void> | void;
		onstart?: (detail: { microphoneAvailable: boolean }) => Promise<void> | void;
		onstop?: () => Promise<void> | void;
	}>();

	let video = $state<HTMLVideoElement>();
	let session: ContinuousCaptureSession | null = null;
	let snapshot = $state<CaptureSessionSnapshot>({
		active: false,
		starting: false,
		microphoneAvailable: false,
		microphoneMuted: false,
		torchEnabled: false,
		elapsedMs: 0,
		capturedCount: 0,
		error: null,
	});
	let queueSnapshot = $state<DurableQueueSnapshot>({
		pending: 0,
		completed: 0,
		failed: 0,
		saturated: false,
		lastError: null,
	});
	let stopping = $state(false);
	let captureInFlight = $state(0);
	let flash = $state(false);
	let captureError = $state('');
	let inFlight = new Set<Promise<void>>();

	const queue = new DurableCaptureQueue<CapturedFrame, void>({
		maxPending: 20,
		persist: async (frame) => {
			await oncapture(frame);
		},
		onSnapshot: (next) => {
			queueSnapshot = next;
		},
	});

	function formatElapsed(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	}

	async function startSweep(): Promise<void> {
		if (!video || snapshot.starting || snapshot.active) return;
		captureError = '';
		session = new ContinuousCaptureSession(video, {
			targetLongEdge: 3072,
			jpegQuality: 0.9,
			onSnapshot: (next) => {
				snapshot = next;
			},
		});
		try {
			const result = await session.start();
			await onstart({ microphoneAvailable: result.microphoneAvailable });
		} catch (error) {
			captureError = error instanceof Error ? error.message : 'Camera unavailable.';
		}
	}

	function shutter(): void {
		if (!session || !snapshot.active || queueSnapshot.saturated || captureInFlight >= 4) return;
		captureError = '';
		captureInFlight += 1;
		flash = true;
		setTimeout(() => (flash = false), 90);
		const task = session
			.capture()
			.then(async (frame) => {
				await queue.enqueue(frame);
			})
			.catch((error) => {
				captureError =
					error instanceof Error ? error.message : 'Photo could not be captured or saved.';
			})
			.finally(() => {
				captureInFlight = Math.max(0, captureInFlight - 1);
				inFlight.delete(task);
			});
		inFlight.add(task);
	}

	async function flush(): Promise<void> {
		await Promise.allSettled([...inFlight]);
		await queue.flush();
	}

	export async function finishSweep(): Promise<void> {
		if (!session || stopping) return;
		stopping = true;
		captureError = '';
		try {
			await flush();
			const audio = await session.stop();
			if (audio) await onaudio(audio);
			await onstop();
		} catch (error) {
			captureError = error instanceof Error ? error.message : 'Sweep could not finish safely.';
			throw error;
		} finally {
			stopping = false;
			session = null;
		}
	}

	async function stopWithoutAudio(): Promise<void> {
		if (!session) return;
		try {
			await flush();
		} catch {
			// Navigation cleanup still stops media tracks; committed photos remain safe.
		}
		await session.stop();
		session = null;
	}

	async function toggleTorch(): Promise<void> {
		if (!session) return;
		await session.setTorch(!snapshot.torchEnabled);
	}

	function toggleMicrophone(): void {
		if (!session || !snapshot.microphoneAvailable) return;
		session.setMicrophoneMuted(!snapshot.microphoneMuted);
	}

	beforeNavigate(() => {
		void stopWithoutAudio();
	});
	onDestroy(() => {
		void stopWithoutAudio();
	});
</script>

<div class="mb-4 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950">
	<div class="relative">
		<video
			bind:this={video}
			class:invisible={!snapshot.active}
			class="aspect-[3/4] w-full bg-neutral-950 object-cover"
			playsinline
			muted
		></video>
		{#if flash}<div class="pointer-events-none absolute inset-0 bg-white/55"></div>{/if}
		{#if snapshot.active}
			<div class="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-caption text-white">
				<span class="h-2 w-2 rounded-full bg-red-500"></span>
				<span>{formatElapsed(snapshot.elapsedMs)}</span>
				<span>·</span>
				<span>{snapshot.capturedCount} photos</span>
				{#if queueSnapshot.pending > 0}<span>· {queueSnapshot.pending} saving</span>{/if}
			</div>
		{/if}
	</div>

	{#if snapshot.active}
		<div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3">
			<div class="flex gap-2">
				<Button variant="secondary" onclick={toggleTorch} aria-label="Toggle torch">
					<Zap size={18} class:text-warning-300={snapshot.torchEnabled} />
				</Button>
				<Button
					variant="secondary"
					onclick={toggleMicrophone}
					disabled={!snapshot.microphoneAvailable}
					aria-label="Toggle microphone"
				>
					{#if snapshot.microphoneMuted || !snapshot.microphoneAvailable}
						<MicOff size={18} />
					{:else}
						<Mic size={18} class="text-red-300" />
					{/if}
				</Button>
			</div>
			<button
				class="mx-auto h-20 w-20 rounded-full border-[6px] border-neutral-100 bg-neutral-200 shadow-lg active:scale-95 disabled:opacity-40"
				aria-label="Take photo"
				disabled={queueSnapshot.saturated || captureInFlight >= 4 || stopping}
				onclick={shutter}
			></button>
			<Button variant="secondary" onclick={() => void finishSweep()} disabled={stopping}>
				<CameraOff size={18} />
				<span class="hidden sm:inline">Stop</span>
			</Button>
		</div>
		<div class="px-3 pb-3 text-center text-caption text-neutral-400">
			{#if snapshot.microphoneAvailable}
				{snapshot.microphoneMuted ? 'Microphone muted' : 'Camera and narration are recording together'}
			{:else}
				Camera active · microphone unavailable · typed notes remain available
			{/if}
		</div>
	{:else}
		<div class="p-4">
			<Button variant="primary" full onclick={startSweep} disabled={snapshot.starting || stopping}>
				<Camera size={18} />
				{snapshot.starting ? 'Starting sweep…' : 'Start sweep'}
			</Button>
			<p class="mt-2 text-center text-caption text-neutral-500">
				Live rear camera and narration stay active while you take photos.
			</p>
		</div>
	{/if}

	{#if captureError || snapshot.error || queueSnapshot.lastError}
		<p class="px-4 pb-3 text-body-sm text-warning-300" role="alert" aria-live="polite">
			{captureError || snapshot.error || queueSnapshot.lastError?.message}
		</p>
	{/if}
</div>
