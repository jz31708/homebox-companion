import type { Page, Route } from '@playwright/test';

export interface ControlledTranscriptionRequest {
	index: number;
	authorization: string | null;
	contentType: string | null;
	bodySize: number;
}

export interface ControlledTranscriptionApi {
	requests: ControlledTranscriptionRequest[];
	waitForRequest(index: number): Promise<ControlledTranscriptionRequest>;
	fulfill(index: number, body: Record<string, unknown>, status?: number): Promise<void>;
	fail(index: number, status?: number): Promise<void>;
}

type Pending = {
	resolve: (value: { status: number; body: unknown }) => void;
	promise: Promise<{ status: number; body: unknown }>;
};

export async function installControlledTranscriptionRoute(
	page: Page
): Promise<ControlledTranscriptionApi> {
	const requests: ControlledTranscriptionRequest[] = [];
	const pending = new Map<number, Pending>();
	const waiters = new Map<number, (request: ControlledTranscriptionRequest) => void>();
	await page.route('**/api/tools/audio/transcribe', async (route: Route) => {
		const request = route.request();
		const index = requests.length;
		const observed = {
			index,
			authorization: request.headers().authorization ?? null,
			contentType: request.headers()['content-type'] ?? null,
			bodySize: request.postDataBuffer()?.byteLength ?? 0,
		};
		requests.push(observed);
		waiters.get(index)?.(observed);
		let resolve!: Pending['resolve'];
		const promise = new Promise<{ status: number; body: unknown }>((done) => (resolve = done));
		pending.set(index, { resolve, promise });
		const decision = await promise;
		await route.fulfill({
			status: decision.status,
			contentType: 'application/json',
			body: JSON.stringify(decision.body),
		});
		pending.delete(index);
	});
	async function waitForRequest(index: number): Promise<ControlledTranscriptionRequest> {
		if (requests[index]) return requests[index];
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error(`Timed out waiting for transcription request ${index}`)),
				10000
			);
			waiters.set(index, (request) => {
				clearTimeout(timeout);
				waiters.delete(index);
				resolve(request);
			});
		});
	}
	async function settle(index: number, status: number, body: unknown): Promise<void> {
		await waitForRequest(index);
		const entry = pending.get(index);
		if (!entry) throw new Error(`Transcription request ${index} is not pending`);
		entry.resolve({ status, body });
		await entry.promise;
	}
	return {
		requests,
		waitForRequest,
		fulfill: (index, body, status = 200) => settle(index, status, body),
		fail: (index, status = 503) =>
			settle(index, status, { detail: 'controlled transcription failure' }),
	};
}

export interface Phase2MediaControls {
	stats(): Promise<{
		recorderStarts: number;
		recorderStops: number;
		speechStarts: number;
		unhandledRejections: string[];
	}>;
}

export async function installPhase2MediaMocks(
	page: Page,
	options: { speechRecognition?: 'absent' | 'final' | 'error'; audioText?: string } = {}
): Promise<Phase2MediaControls> {
	await page.addInitScript(({ speechRecognition = 'absent', audioText = 'phase2-audio' }) => {
		const state = {
			recorderStarts: 0,
			recorderStops: 0,
			speechStarts: 0,
			unhandledRejections: [] as string[],
		};
		(window as Window & { __phase2?: typeof state }).__phase2 = state;
		window.addEventListener('unhandledrejection', (event) => {
			state.unhandledRejections.push(String(event.reason));
			event.preventDefault();
		});
		const stream = { getTracks: () => [{ stop() {} }] } as unknown as MediaStream;
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: { getUserMedia: async () => stream },
		});
		class Recorder {
			state: RecordingState = 'inactive';
			mimeType = 'audio/webm;codecs=opus';
			ondataavailable: ((event: { data: Blob }) => void) | null = null;
			onstop: (() => void) | null = null;
			constructor(_stream: MediaStream) {}
			start() {
				this.state = 'recording';
				state.recorderStarts++;
				queueMicrotask(() =>
					this.ondataavailable?.({ data: new Blob([audioText], { type: this.mimeType }) })
				);
			}
			stop() {
				this.state = 'inactive';
				state.recorderStops++;
				queueMicrotask(() => this.onstop?.());
			}
		}
		Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: Recorder });
		class Recognition {
			onresult: ((event: unknown) => void) | null = null;
			onerror: ((event: unknown) => void) | null = null;
			start() {
				state.speechStarts++;
				queueMicrotask(() =>
					speechRecognition === 'final'
						? this.onresult?.({
								resultIndex: 0,
								results: [{ 0: { transcript: 'browser preview' }, isFinal: true }],
							})
						: speechRecognition === 'error'
							? this.onerror?.({ error: 'network' })
							: undefined
				);
			}
			stop() {}
		}
		Object.defineProperty(window, 'SpeechRecognition', {
			configurable: true,
			value: speechRecognition === 'absent' ? undefined : Recognition,
		});
		Object.defineProperty(window, 'webkitSpeechRecognition', {
			configurable: true,
			value: undefined,
		});
	}, options);
	return {
		stats: () =>
			page.evaluate(
				() =>
					(
						window as Window & {
							__phase2?: {
								recorderStarts: number;
								recorderStops: number;
								speechStarts: number;
								unhandledRejections: string[];
							};
						}
					).__phase2 ?? {
						recorderStarts: 0,
						recorderStops: 0,
						speechStarts: 0,
						unhandledRejections: [],
					}
			),
	};
}
