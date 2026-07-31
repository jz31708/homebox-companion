import type { Page } from '@playwright/test';

export const BULK_STORES = [
	'missions',
	'photos',
	'audio',
	'spans',
	'chunks',
	'candidates',
	'outbox',
	'meta',
] as const;

export type BulkStoreName = (typeof BULK_STORES)[number];

export const missionId = 'phase1-mission';
export const activeSeedTimeMs = Date.now();

export function browserBlob(text: string, type: string): Record<string, string> {
	return { __phase1BlobText: text, __phase1BlobType: type };
}

export function baseMission(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 2,
		id: missionId,
		status: 'capturing',
		locationId: 'room-1',
		locationName: 'Living room',
		parentItemId: null,
		parentItemName: null,
		areaLabel: 'upper cabinet',
		locationPath: 'Living room',
		createdAtMs: activeSeedTimeMs - 200,
		startedAtMs: activeSeedTimeMs - 100,
		updatedAtMs: activeSeedTimeMs,
		photoIds: [],
		audioSegmentIds: [],
		transcriptSpanIds: [],
		observationChunkIds: [],
		candidateIds: [],
		outboxOperationIds: [],
		chunkSize: 6,
		lastError: null,
		rawTranscript: 'raw shelf narration',
		canonicalTranscript: 'canonical shelf narration',
		editedTranscript: 'edited shelf narration',
		transcriptEdited: true,
		transcriptSource: 'server',
		nextCaptureSequence: 10,
		...overrides,
	};
}

export async function installBulkApiMocks(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem('hbc_token', 'phase1-e2e-token');
		window.localStorage.setItem('hbc_token_expires', new Date(Date.now() + 3600000).toISOString());
	});
	await page.route('**/api/**', async (route) => {
		const path = new URL(route.request().url()).pathname.replace('/api', '');
		if (path === '/config') {
			await route.fulfill({
				json: {
					is_demo_mode: false,
					homebox_url: 'http://homebox.test',
					capture_max_images: 80,
					capture_max_file_size_mb: 10,
				},
			});
			return;
		}
		if (path === '/version') {
			await route.fulfill({
				json: { version: 'phase1-e2e', latest_version: null, update_available: false },
			});
			return;
		}
		if (path === '/locations' || path === '/locations/tree') {
			await route.fulfill({
				json: [{ id: 'room-1', name: 'Living room', description: '', itemCount: 0, children: [] }],
			});
			return;
		}
		if (path === '/tags') {
			await route.fulfill({ json: [] });
			return;
		}
		if (path.startsWith('/items/bulk/')) {
			await route.fulfill({
				json: { status: 'complete', homeboxItemId: 'phase1-item', attachments: [] },
			});
			return;
		}
		await route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } });
	});
}

export async function installNarrationMocks(
	page: Page,
	options: {
		speechRecognition?: 'error' | 'absent' | 'final';
		transcription?: 'success' | 'failure';
		recorder?: 'immediate' | 'delayed';
		speechText?: string;
		failAudioPersistence?: boolean;
	}
): Promise<void> {
	await page.addInitScript(
		({
			speechRecognition,
			recorder = 'immediate',
			speechText = 'final shelf narration',
			failAudioPersistence = false,
		}) => {
			const state = window as Window & {
				phase1UnhandledRejections?: string[];
				phase1ReleaseRecorder?: () => void;
			};
			state.phase1UnhandledRejections = [];
			window.addEventListener('unhandledrejection', (event) => {
				state.phase1UnhandledRejections?.push(String(event.reason));
				event.preventDefault();
			});

			const mediaDevices = {
				getUserMedia: async () => new MediaStream(),
			};
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });

			let delayedRecorderCallbacks: (() => void)[] = [];
			state.phase1ReleaseRecorder = () => {
				const callbacks = delayedRecorderCallbacks;
				delayedRecorderCallbacks = [];
				callbacks.forEach((callback) => callback());
			};

			class Phase1MediaRecorder {
				state = 'inactive';
				mimeType = 'audio/webm';
				ondataavailable: ((event: { data: Blob }) => void) | null = null;
				onstop: (() => void) | null = null;
				constructor(_stream: MediaStream) {}
				start() {
					this.state = 'recording';
					const emitData = () =>
						this.ondataavailable?.({ data: new Blob(['phase1-audio'], { type: 'audio/webm' }) });
					if (recorder === 'delayed') delayedRecorderCallbacks.push(emitData);
					else emitData();
				}
				stop() {
					this.state = 'inactive';
					const emitStop = () => this.onstop?.();
					if (recorder === 'delayed') delayedRecorderCallbacks.push(emitStop);
					else emitStop();
				}
			}
			Object.defineProperty(window, 'MediaRecorder', {
				configurable: true,
				value: Phase1MediaRecorder,
			});

			if (speechRecognition === 'error' || speechRecognition === 'final') {
				class Phase1SpeechRecognition {
					continuous = false;
					interimResults = false;
					onerror: ((event: { error: string }) => void) | null = null;
					onresult: ((event: unknown) => void) | null = null;
					start() {
						queueMicrotask(() => {
							if (speechRecognition === 'error') this.onerror?.({ error: 'network' });
							else
								this.onresult?.({
									resultIndex: 0,
									results: [
										{
											0: { transcript: speechText },
											isFinal: true,
										},
									],
								});
						});
					}
					stop() {}
				}
				Object.defineProperty(window, 'SpeechRecognition', {
					configurable: true,
					value: Phase1SpeechRecognition,
				});
			}
		},
		{
			speechRecognition: options.speechRecognition,
			recorder: options.recorder,
			speechText: options.speechText,
			failAudioPersistence: options.failAudioPersistence,
		}
	);
	if (options.failAudioPersistence) {
		await page.addInitScript(() => {
			const originalPut = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (value, key) {
				if (this.name === 'audio') {
					throw new DOMException('audio persistence failed', 'QuotaExceededError');
				}
				return originalPut.call(this, value, key);
			};
		});
	}

	await page.route('**/api/tools/audio/transcribe', async (route) => {
		if (options.transcription === 'failure') {
			await route.fulfill({ status: 503, json: { detail: 'phase1 transcription unavailable' } });
			return;
		}
		await route.fulfill({ json: { text: 'server shelf narration' } });
	});
}

export async function installDelayedMissionPhotoAppend(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = window as Window & {
			phase1ArmDelayedAppend?: () => void;
			phase1ReleaseDelayedAppend?: () => void;
			phase1DelayedAppendPending?: boolean;
		};
		let armed = false;
		let delayedSuccessListeners: Array<{
			request: IDBRequest;
			listener: EventListenerOrEventListenerObject;
		}> = [];
		state.phase1DelayedAppendPending = false;
		state.phase1ArmDelayedAppend = () => {
			armed = true;
		};
		state.phase1ReleaseDelayedAppend = () => {
			const listeners = delayedSuccessListeners;
			delayedSuccessListeners = [];
			state.phase1DelayedAppendPending = false;
			for (const { request, listener } of listeners) {
				if (typeof listener === 'function') listener.call(request, new Event('success'));
				else listener.handleEvent(new Event('success'));
			}
		};

		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			const request = originalPut.call(this, value, key);
			const shouldDelay =
				armed &&
				this.name === 'missions' &&
				Array.isArray((value as { photoIds?: unknown })?.photoIds) &&
				(value as { photoIds: unknown[] }).photoIds.length >= 2;
			if (!shouldDelay) return request;
			state.phase1DelayedAppendPending = true;
			return new Proxy(request, {
				get(target, property, receiver) {
					if (property === 'addEventListener') {
						return (
							type: string,
							listener: EventListenerOrEventListenerObject,
							options?: boolean | AddEventListenerOptions
						) => {
							if (type === 'success') {
								delayedSuccessListeners.push({ request: target, listener });
								return;
							}
							return target.addEventListener(type, listener, options);
						};
					}
					const result = Reflect.get(target, property, target);
					return typeof result === 'function' ? result.bind(target) : result;
				},
			});
		};
	});
}

export async function failTranscriptSpanWrites(page: Page, text: string): Promise<void> {
	await page.addInitScript((failureText) => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			if (this.name === 'spans' && (value as { text?: string })?.text === failureText) {
				throw new DOMException('transcript span persistence failed', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		};
	}, text);
}

export async function readUnhandledRejections(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			(window as Window & { phase1UnhandledRejections?: string[] }).phase1UnhandledRejections ?? []
	);
}

export async function resetBulkDatabase(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase('hbc-bulk-missions');
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
			request.onblocked = () => resolve();
		});
	});
}

export async function seedV2Bundle(
	page: Page,
	values: Partial<Record<BulkStoreName, Array<{ key: string; value: unknown }>>>
): Promise<void> {
	await page.evaluate(
		({ stores, values }) =>
			new Promise<void>((resolve, reject) => {
				const decode = (value: unknown): unknown => {
					if (Array.isArray(value)) return value.map(decode);
					if (value && typeof value === 'object') {
						const entry = value as Record<string, unknown>;
						if (typeof entry.__phase1BlobText === 'string')
							return new Blob([entry.__phase1BlobText], {
								type: String(entry.__phase1BlobType ?? ''),
							});
						return Object.fromEntries(
							Object.entries(entry).map(([key, child]) => [key, decode(child)])
						);
					}
					return value;
				};
				const request = indexedDB.open('hbc-bulk-missions', 2);
				request.onupgradeneeded = () => {
					for (const store of stores) {
						if (!request.result.objectStoreNames.contains(store))
							request.result.createObjectStore(store);
					}
				};
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const transaction = db.transaction(stores, 'readwrite');
					for (const store of stores) {
						for (const entry of values[store] ?? [])
							transaction.objectStore(store).put(decode(entry.value), entry.key);
					}
					transaction.oncomplete = () => {
						db.close();
						resolve();
					};
					transaction.onerror = () => reject(transaction.error);
				};
			}),
		{ stores: BULK_STORES, values }
	);
}

export async function seedV1Bundle(
	page: Page,
	values: Partial<Record<BulkStoreName, Array<{ key: string; value: unknown }>>>
): Promise<void> {
	await page.evaluate(
		({ stores, values }) =>
			new Promise<void>((resolve, reject) => {
				const decode = (value: unknown): unknown => {
					if (Array.isArray(value)) return value.map(decode);
					if (value && typeof value === 'object') {
						const entry = value as Record<string, unknown>;
						if (typeof entry.__phase1BlobText === 'string')
							return new Blob([entry.__phase1BlobText], {
								type: String(entry.__phase1BlobType ?? ''),
							});
						return Object.fromEntries(
							Object.entries(entry).map(([key, child]) => [key, decode(child)])
						);
					}
					return value;
				};
				const deleteRequest = indexedDB.deleteDatabase('hbc-bulk-missions');
				deleteRequest.onerror = () => reject(deleteRequest.error);
				deleteRequest.onsuccess = () => {
					const request = indexedDB.open('hbc-bulk-missions', 1);
					request.onupgradeneeded = () => {
						for (const store of stores) request.result.createObjectStore(store);
					};
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						const db = request.result;
						const transaction = db.transaction(stores, 'readwrite');
						for (const store of stores) {
							for (const entry of values[store] ?? [])
								transaction.objectStore(store).put(decode(entry.value), entry.key);
						}
						transaction.oncomplete = () => {
							db.close();
							resolve();
						};
						transaction.onerror = () => reject(transaction.error);
					};
				};
			}),
		{ stores: BULK_STORES, values }
	);
}

export async function readStore(page: Page, store: BulkStoreName): Promise<unknown[]> {
	return page.evaluate(
		(storeName) =>
			new Promise<unknown[]>((resolve, reject) => {
				const request = indexedDB.open('hbc-bulk-missions', 2);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const get = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
					get.onsuccess = () => {
						db.close();
						resolve(get.result);
					};
					get.onerror = () => reject(get.error);
				};
			}),
		store
	);
}

export async function enterBulkCapture(page: Page): Promise<void> {
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
}

export function photoRecord(id: string, sequence: number, blob = 'phase1-photo') {
	return {
		schemaVersion: 2,
		missionId,
		id,
		status: 'ready',
		blob: browserBlob(blob, 'image/jpeg'),
		filename: `${id}.jpg`,
		mimeType: 'image/jpeg',
		byteSize: blob.length,
		takenAtMs: 1_700_000_000_300,
		sessionOffsetMs: 200,
		note: 'photo note',
		groupLabel: 'shelf group',
		ignored: false,
		captureSequence: sequence,
	};
}
