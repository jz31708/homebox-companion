import type { Page, Route } from '@playwright/test';
import { baseMission, browserBlob, seedV2Bundle } from './phase1Persistence';

export const PHASE2_MISSION_ID = 'phase2-mission';

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

export interface ControlledTranscriptionRequest {
	index: number;
	authorization: string | null;
	contentType: string | null;
	bodySize: number;
}

export interface ControlledTranscriptionApi {
	requests: ControlledTranscriptionRequest[];
	waitForRequest(index: number): Promise<ControlledTranscriptionRequest>;
	fulfill(
		index: number,
		body: {
			text: string;
			start_offset_ms?: number | null;
			end_offset_ms?: number | null;
		},
		status?: number
	): Promise<void>;
	fail(index: number, status?: number): Promise<void>;
	abort(index: number): Promise<void>;
}

type RouteDecision =
	| { kind: 'fulfill'; status: number; body: unknown }
	| { kind: 'abort' };

interface PendingRoute {
	decision: Deferred<RouteDecision>;
	completed: Deferred<void>;
}

export async function installControlledTranscriptionRoute(
	page: Page
): Promise<ControlledTranscriptionApi> {
	const requests: ControlledTranscriptionRequest[] = [];
	const pending = new Map<number, PendingRoute>();
	const waiters = new Map<number, Deferred<void>>();

	await page.route('**/api/tools/audio/transcribe', async (route: Route) => {
		const request = route.request();
		const index = requests.length;
		requests.push({
			index,
			authorization: request.headers().authorization ?? null,
			contentType: request.headers()['content-type'] ?? null,
			bodySize: request.postDataBuffer()?.byteLength ?? 0,
		});
		const entry = { decision: deferred<RouteDecision>(), completed: deferred<void>() };
		pending.set(index, entry);
		waiters.get(index)?.resolve();
		try {
			const decision = await entry.decision.promise;
			if (decision.kind === 'abort') await route.abort('failed');
			else {
				await route.fulfill({
					status: decision.status,
					contentType: 'application/json',
					body: JSON.stringify(decision.body),
				});
			}
			entry.completed.resolve();
		} catch (error) {
			entry.completed.reject(error);
			throw error;
		} finally {
			pending.delete(index);
		}
	});

	async function waitForRequest(index: number): Promise<ControlledTranscriptionRequest> {
		if (requests[index]) return requests[index];
		const waiter = waiters.get(index) ?? deferred<void>();
		waiters.set(index, waiter);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				waiter.promise,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(
						() => reject(new Error(`Timed out waiting for transcription request ${index}`)),
						10_000
					);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			waiters.delete(index);
		}
		if (!requests[index]) throw new Error(`Transcription request ${index} was not recorded`);
		return requests[index];
	}

	async function settle(index: number, decision: RouteDecision): Promise<void> {
		await waitForRequest(index);
		const entry = pending.get(index);
		if (!entry) throw new Error(`Transcription request ${index} is no longer pending`);
		entry.decision.resolve(decision);
		await entry.completed.promise;
	}

	return {
		requests,
		waitForRequest,
		fulfill: (index, body, status = 200) =>
			settle(index, {
				kind: 'fulfill',
				status,
				body: { start_offset_ms: null, end_offset_ms: null, ...body },
			}),
		fail: (index, status = 503) =>
			settle(index, {
				kind: 'fulfill',
				status,
				body: { detail: 'Controlled transcription failure' },
			}),
		abort: (index) => settle(index, { kind: 'abort' }),
	};
}

export interface Phase2MediaOptions {
	microphone?: 'allowed' | 'denied';
	recorder?: 'immediate' | 'controlled';
	speechRecognition?: 'absent' | 'final' | 'error' | 'controlled';
	audioText?: string;
	audioMimeType?: string;
	speechText?: string;
}

export interface Phase2MediaStats {
	getUserMediaCalls: number;
	recorderStarts: number;
	recorderStops: number;
	trackStops: number;
	speechStarts: number;
	speechStops: number;
	unhandledRejections: string[];
}

export interface Phase2MediaControls {
	releaseRecorderData(): Promise<void>;
	releaseRecorderStop(): Promise<void>;
	emitSpeechFinal(text?: string): Promise<void>;
	emitSpeechError(): Promise<void>;
	stats(): Promise<Phase2MediaStats>;
}

export async function installPhase2MediaMocks(
	page: Page,
	options: Phase2MediaOptions = {}
): Promise<Phase2MediaControls> {
	await page.addInitScript(
		({
			microphone = 'allowed',
			recorder = 'immediate',
			speechRecognition = 'absent',
			audioText = 'phase2-audio',
			audioMimeType = 'audio/webm;codecs=opus',
			speechText = 'browser preview',
		}) => {
			type Phase2State = {
				getUserMediaCalls: number;
				recorderStarts: number;
				recorderStops: number;
				trackStops: number;
				speechStarts: number;
				speechStops: number;
				unhandledRejections: string[];
				releaseRecorderData(): void;
				releaseRecorderStop(): void;
				emitSpeechFinal(text?: string): void;
				emitSpeechError(): void;
			};
			type Phase2Window = Window & { __phase2Media?: Phase2State };
			let activeRecorder: Phase2MediaRecorder | null = null;
			let activeRecognition: Phase2SpeechRecognition | null = null;
			const state: Phase2State = {
				getUserMediaCalls: 0,
				recorderStarts: 0,
				recorderStops: 0,
				trackStops: 0,
				speechStarts: 0,
				speechStops: 0,
				unhandledRejections: [],
				releaseRecorderData: () => activeRecorder?.emitData(),
				releaseRecorderStop: () => activeRecorder?.emitStop(),
				emitSpeechFinal: (text?: string) => activeRecognition?.emitFinal(text ?? speechText),
				emitSpeechError: () => activeRecognition?.emitError(),
			};
			(window as Phase2Window).__phase2Media = state;
			window.addEventListener('unhandledrejection', (event) => {
				state.unhandledRejections.push(String(event.reason));
				event.preventDefault();
			});

			const track = { stop: () => (state.trackStops += 1) };
			const stream = new MediaStream();
			Object.defineProperty(stream, 'getTracks', { configurable: true, value: () => [track] });
			Object.defineProperty(stream, 'getAudioTracks', { configurable: true, value: () => [track] });
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					getUserMedia: async () => {
						state.getUserMediaCalls += 1;
						if (microphone === 'denied') {
							throw new DOMException('Microphone permission denied', 'NotAllowedError');
						}
						return stream;
					},
				},
			});

			class Phase2MediaRecorder {
				state: RecordingState = 'inactive';
				mimeType = audioMimeType;
				ondataavailable: ((event: { data: Blob }) => void) | null = null;
				onstop: (() => void) | null = null;
				private dataEmitted = false;
				private stopEmitted = false;
				constructor(_stream: MediaStream) {
					activeRecorder = this;
				}
				start(): void {
					this.state = 'recording';
					state.recorderStarts += 1;
					if (recorder === 'immediate') queueMicrotask(() => this.emitData());
				}
				stop(): void {
					this.state = 'inactive';
					state.recorderStops += 1;
					if (recorder === 'immediate') queueMicrotask(() => this.emitStop());
				}
				emitData(): void {
					if (this.dataEmitted) return;
					this.dataEmitted = true;
					this.ondataavailable?.({ data: new Blob([audioText], { type: audioMimeType }) });
				}
				emitStop(): void {
					if (this.stopEmitted) return;
					this.stopEmitted = true;
					this.onstop?.();
				}
			}
			Object.defineProperty(window, 'MediaRecorder', {
				configurable: true,
				value: Phase2MediaRecorder,
			});

			class Phase2SpeechRecognition {
				continuous = false;
				interimResults = false;
				onresult: ((event: unknown) => void) | null = null;
				onerror: ((event: { error: string }) => void) | null = null;
				constructor() {
					activeRecognition = this;
				}
				start(): void {
					state.speechStarts += 1;
					if (speechRecognition === 'final') queueMicrotask(() => this.emitFinal(speechText));
					if (speechRecognition === 'error') queueMicrotask(() => this.emitError());
				}
				stop(): void {
					state.speechStops += 1;
				}
				emitFinal(text: string): void {
					this.onresult?.({
						resultIndex: 0,
						results: [{ 0: { transcript: text }, isFinal: true }],
					});
				}
				emitError(): void {
					this.onerror?.({ error: 'network' });
				}
			}
			if (speechRecognition === 'absent') {
				Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
				Object.defineProperty(window, 'webkitSpeechRecognition', {
					configurable: true,
					value: undefined,
				});
			} else {
				Object.defineProperty(window, 'SpeechRecognition', {
					configurable: true,
					value: Phase2SpeechRecognition,
				});
				Object.defineProperty(window, 'webkitSpeechRecognition', {
					configurable: true,
					value: undefined,
				});
			}
		},
		options
	);

	return {
		releaseRecorderData: () =>
			page.evaluate(() =>
				(window as Window & { __phase2Media?: { releaseRecorderData(): void } }).__phase2Media?.releaseRecorderData()
			),
		releaseRecorderStop: () =>
			page.evaluate(() =>
				(window as Window & { __phase2Media?: { releaseRecorderStop(): void } }).__phase2Media?.releaseRecorderStop()
			),
		emitSpeechFinal: (text?: string) =>
			page.evaluate(
				(value) =>
					(window as Window & { __phase2Media?: { emitSpeechFinal(text?: string): void } })
						.__phase2Media?.emitSpeechFinal(value),
				text
			),
		emitSpeechError: () =>
			page.evaluate(() =>
				(window as Window & { __phase2Media?: { emitSpeechError(): void } }).__phase2Media?.emitSpeechError()
			),
		stats: () =>
			page.evaluate(() => {
				const state = (window as Window & { __phase2Media?: Phase2MediaStats }).__phase2Media;
				return {
					getUserMediaCalls: state?.getUserMediaCalls ?? 0,
					recorderStarts: state?.recorderStarts ?? 0,
					recorderStops: state?.recorderStops ?? 0,
					trackStops: state?.trackStops ?? 0,
					speechStarts: state?.speechStarts ?? 0,
					speechStops: state?.speechStops ?? 0,
					unhandledRejections: state?.unhandledRejections ?? [],
				};
			}),
	};
}

export interface AudioSnapshot {
	id: string;
	missionId: string;
	status: string;
	mimeType: string;
	byteSize: number;
	startedAtMs: number;
	endedAtMs: number;
	retryCount: number;
	activeAttemptId: string | null;
	activeAttemptStartedAtMs: number | null;
	transcript: string | null;
	rawTranscript: string;
	source: string | null;
	error: { code: string; message: string; retryable: boolean } | null;
	blobSize: number;
	blobText: string;
}

export async function readAudioSnapshots(page: Page): Promise<AudioSnapshot[]> {
	return page.evaluate(
		() =>
			new Promise<AudioSnapshot[]>((resolve, reject) => {
				const request = indexedDB.open('hbc-bulk-missions', 2);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const get = db.transaction('audio', 'readonly').objectStore('audio').getAll();
					get.onerror = () => reject(get.error);
					get.onsuccess = async () => {
						try {
							const result = await Promise.all(
								(get.result as Array<Record<string, unknown>>).map(async (record) => {
									const blob = record.blob as Blob;
									return {
										id: String(record.id),
										missionId: String(record.missionId),
										status: String(record.status),
										mimeType: String(record.mimeType),
										byteSize: Number(record.byteSize),
										startedAtMs: Number(record.startedAtMs),
										endedAtMs: Number(record.endedAtMs),
										retryCount: Number(record.retryCount ?? 0),
										activeAttemptId: (record.activeAttemptId as string | null) ?? null,
										activeAttemptStartedAtMs:
											(record.activeAttemptStartedAtMs as number | null) ?? null,
										transcript: (record.transcript as string | null) ?? null,
										rawTranscript: String(record.rawTranscript ?? ''),
										source: (record.source as string | null) ?? null,
										error:
											(record.error as AudioSnapshot['error'] | undefined) ?? null,
										blobSize: blob.size,
										blobText: await blob.text(),
									};
								})
							);
							db.close();
							resolve(result);
						} catch (error) {
							db.close();
							reject(error);
						}
					};
				};
			})
	);
}

export interface AudioCommitOrderingProbe {
	audioInsertCommitted: boolean;
	recordingRowObserved: boolean;
	recordingRowObservedAfterCommit: boolean | null;
	fetchObservedAfterCommit: boolean | null;
}

export async function installAudioCommitOrderingProbe(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state: AudioCommitOrderingProbe = {
			audioInsertCommitted: false,
			recordingRowObserved: false,
			recordingRowObservedAfterCommit: null,
			fetchObservedAfterCommit: null,
		};
		(window as Window & { __phase2Ordering?: AudioCommitOrderingProbe }).__phase2Ordering = state;
		const inserts = new WeakSet<IDBTransaction>();
		const originalTransaction = IDBDatabase.prototype.transaction;
		IDBDatabase.prototype.transaction = function (
			storeNames: string | string[],
			mode?: IDBTransactionMode,
			options?: IDBTransactionOptions
		): IDBTransaction {
			const transaction = originalTransaction.call(this, storeNames, mode, options);
			transaction.addEventListener('complete', () => {
				if (inserts.has(transaction)) state.audioInsertCommitted = true;
			});
			return transaction;
		};
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
			const record = value as { status?: string; activeAttemptId?: string | null };
			if (this.name === 'audio' && record.status === 'persisted' && !record.activeAttemptId) {
				inserts.add(this.transaction);
			}
			return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
		};
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
			if (new URL(url, window.location.href).pathname === '/api/tools/audio/transcribe') {
				state.fetchObservedAfterCommit = state.audioInsertCommitted;
			}
			return originalFetch(input, init);
		};
		window.addEventListener('DOMContentLoaded', () => {
			const observer = new MutationObserver(() => {
				if (state.recordingRowObserved || !document.body.textContent?.includes('Recording ')) return;
				state.recordingRowObserved = true;
				state.recordingRowObservedAfterCommit = state.audioInsertCommitted;
			});
			observer.observe(document.documentElement, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		});
	});
}

export async function readAudioCommitOrderingProbe(
	page: Page
): Promise<AudioCommitOrderingProbe> {
	return page.evaluate(
		() =>
			(window as Window & { __phase2Ordering?: AudioCommitOrderingProbe }).__phase2Ordering ?? {
				audioInsertCommitted: false,
				recordingRowObserved: false,
				recordingRowObservedAfterCommit: null,
				fetchObservedAfterCommit: null,
			}
	);
}

export type Phase2IdbFailure = 'success-span-put' | 'failure-mission-put';

export async function installOneShotPhase2IdbFailure(
	page: Page,
	kind: Phase2IdbFailure
): Promise<void> {
	await page.evaluate((failureKind) => {
		let fired = false;
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
			const record = value as { id?: string; lastError?: { code?: string } | null };
			const fail =
				!fired &&
				((failureKind === 'success-span-put' &&
					this.name === 'spans' &&
					record.id?.startsWith('server:')) ||
					(failureKind === 'failure-mission-put' &&
						this.name === 'missions' &&
						record.lastError?.code?.startsWith('TRANSCRIPTION_')));
			if (fail) {
				fired = true;
				throw new DOMException('Controlled Phase 2 IndexedDB failure', 'QuotaExceededError');
			}
			return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
		};
	}, kind);
}

export async function installAbortIgnoringTranscriptionFetch(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
			if (new URL(url, window.location.href).pathname !== '/api/tools/audio/transcribe' || !init) {
				return originalFetch(input, init);
			}
			const { signal: _ignoredSignal, ...withoutSignal } = init;
			return originalFetch(input, withoutSignal);
		};
	});
}

export function phase2AudioRecord(
	id: string,
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	const text = `audio-bytes-${id}`;
	return {
		schemaVersion: 2,
		missionId: PHASE2_MISSION_ID,
		id,
		status: 'failed',
		blob: browserBlob(text, 'audio/webm'),
		mimeType: 'audio/webm',
		byteSize: text.length,
		startedAtMs: 5_000,
		endedAtMs: 9_000,
		rawTranscript: '',
		transcript: '',
		source: 'server',
		error: {
			code: 'TRANSCRIPTION_FAILED',
			message: 'Server transcription failed. Retry this recording.',
			retryable: true,
		},
		retryCount: 1,
		activeAttemptId: null,
		activeAttemptStartedAtMs: null,
		...overrides,
	};
}

export async function seedPhase2NarrationMission(
	page: Page,
	audioRecords: Array<Record<string, unknown>>,
	missionOverrides: Record<string, unknown> = {},
	spanRecords: Array<Record<string, unknown>> = []
): Promise<void> {
	const now = Date.now();
	await seedV2Bundle(page, {
		missions: [
			{
				key: PHASE2_MISSION_ID,
				value: baseMission({
					id: PHASE2_MISSION_ID,
					status: 'capturing',
					createdAtMs: now - 20_000,
					startedAtMs: now - 10_000,
					updatedAtMs: now,
					audioSegmentIds: audioRecords.map((record) => String(record.id)),
					transcriptSpanIds: spanRecords.map((record) => String(record.id)),
					rawTranscript: '',
					canonicalTranscript: '',
					editedTranscript: '',
					transcriptEdited: false,
					transcriptSource: 'none',
					lastError: null,
					...missionOverrides,
				}),
			},
		],
		audio: audioRecords.map((record) => ({
			key: `${PHASE2_MISSION_ID}:${String(record.id)}`,
			value: { ...record, missionId: PHASE2_MISSION_ID },
		})),
		spans: spanRecords.map((record) => ({
			key: `${PHASE2_MISSION_ID}:${String(record.id)}`,
			value: { ...record, missionId: PHASE2_MISSION_ID },
		})),
	});
}
