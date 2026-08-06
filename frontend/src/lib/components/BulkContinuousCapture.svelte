<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import { Camera, CameraOff, Mic, MicOff, RotateCcw, Zap } from 'lucide-svelte';
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
	let retryingFailed = $state(false);
	let flash = $state(false);
	let captureError = $state('');
	let tapCount = $state(0);
	let failedFrames = $state<CapturedFrame[]>([]);
	let captureTail: Promise<unknown> = Promise.resolve();

	const queue = new DurableCaptureQueue<Promise<CapturedFrame>, void>({
		maxPending: 20,
		persist: async (framePromise) => {
			await oncapture(await framePromise);
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
		tapCount = 0;
		failedFrames = [];
		captureTail = Promise.resolve();
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

	function rememberFailedFrame(frame: CapturedFrame): void {
		if (failedFrames.some((entry) => entry.id === frame.id)) return;
		failedFrames = [...failedFrames, frame].sort(
			(a, b) => a.captureSequence - b.captureSequence
		);
	}

	function persistFrame(framePromise: Promise<CapturedFrame>): void {
		void queue.enqueue(framePromise).catch(async (error) => {
			try {
				rememberFailedFrame(await framePromise);
			} catch {
				// Extraction failure has no usable frame to retry.
			}
			captureError = error instanceof Error ? error.message : 'Photo could not be captured or saved.';
		});
	}

	function shutter(): void {
		const current = session;
		if (!current || !snapshot.active || queueSnapshot.saturated || stopping) return;
		captureError = '';
		const captureSequence = tapCount;
		const takenAtMs = Date.now();
		const sessionOffsetMs = snapshot.elapsedMs;
		tapCount += 1;
		flash = true;
		setTimeout(() => (flash = false), 90);

		const framePromise = captureTail
			.then(() => current.capture())
			.then((frame) => ({
				...frame,
				captureSequence,
				takenAtMs,
				sessionOffsetMs,
			}));
		captureTail = framePromise.catch(() => undefined);
		persistFrame(framePromise);
	}

	async function retryFailedSaves(): Promise<void> {
		if (retryingFailed || failedFrames.length === 0) return;
		retryingFailed = true;
		captureError = '';
		const retrying = [...failedFrames];
		const stillFailed: CapturedFrame[] = [];
		for (const frame of retrying) {
			try {
				await queue.enqueue(Promise.resolve(frame));
			} catch (error) {
				stillFailed.push(frame);
				captureError =
					error instanceof Error ? error.message : 'Photo could not be saved on retry.';
			}
		}
		failedFrames = stillFailed;
		if (stillFailed.length === 0) captureError = '';
		retryingFailed = false;
	}

	async function flush(): Promise<void> {
		await captureTail;
		await queue.flush();
		if (failedFrames.length > 0) {
			throw new Error(
				`${failedFrames.length} captured photo${failedFrames.length === 1 ? '' : 's'} still need saving. Retry before continuing.`
			);
		}
	}

	export async function finishSweep(): Promise<void> {
		if (!session || stopping) return;
		stopping = true;
		captureError = '';
		const current = session;
		try {
			await flush();
			const audio = await current.stop();
			if (audio) await onaudio(audio);
			await onstop();
		} catch (error) {
			captureError = error instanceof Error ? error.message : 'Sweep could not finish safely.';
			throw error;
		} finally {
			stopping = false;
			if (!captureError && session === current) session = null;
		}
	}

	async function discardMediaOnly(): Promise<void> {
		const current = session;
		if (!current) return;
		try {
			await current.stop();
		} finally {
			if (session === current) session = null;
		}
	}

	async function toggleTorch(): Promise<void> {
		if (session) await session.setTorch(!snapshot.torchEnabled);
	}

	function toggleMicrophone(): void {
		if (session && snapshot.microphoneAvailable) {
			session.setMicrophoneMuted(!snapshot.microphoneMuted);
		}
	}

	beforeNavigate((navigation) => {
		if (!snapshot.active || stopping) return;
		navigation.cancel();
		captureError = 'Finishing and saving the active sweep. Navigate again when Stop completes.';
		void finishSweep();
	});
	onDestroy(() => {
		void discardMediaOnly();
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
				<span>{tapCount} photos</span>
				{#if queueSnapshot.pending > 0}<span>· {queueSnapshot.pending} saving</span>{/if}
				{#if failedFrames.length > 0}<span>· {failedFrames.length} failed</span>{/if}
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
				disabled={queueSnapshot.saturated || stopping}
				onclick={shutter}
			></button>
			<Button variant="secondary" onclick={() => void finishSweep()} disabled={stopping}>
				<CameraOff size={18} />
				<span class="hidden sm:inline">Stop</span>
			</Button>
		</div>
		{#if failedFrames.length > 0}
			<div class="px-3 pb-3">
				<Button variant="secondary" full onclick={retryFailedSaves} disabled={retryingFailed}>
					<RotateCcw size={16} />
					{retryingFailed ? 'Retrying saves…' : `Retry ${failedFrames.length} failed save${failedFrames.length === 1 ? '' : 's'}`}
				</Button>
			</div>
		{/if}
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
				{snapshot.starting ? 'Starting camera…' : 'Start camera & narrate sweep'}
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
