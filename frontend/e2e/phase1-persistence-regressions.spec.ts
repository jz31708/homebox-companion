import { expect, test } from '@playwright/test';
import {
	baseMission,
	activeSeedTimeMs,
	browserBlob,
	enterBulkCapture,
	failTranscriptSpanWrites,
	installDelayedMissionPhotoAppend,
	installBulkApiMocks,
	installNarrationMocks,
	missionId,
	photoRecord,
	readUnhandledRejections,
	readStore,
	resetBulkDatabase,
	seedV1Bundle,
	seedV2Bundle,
} from './support/phase1Persistence';

function key(mission: string, id: string): string {
	return `${mission}:${id}`;
}

function candidateRecord(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 2,
		missionId,
		id: 'candidate-1',
		state: 'needs_review',
		reviewTier: 'attention',
		name: 'USB-C cable',
		quantity: 3,
		entityMode: 'grouped',
		quantityBasis: 'explicit_count',
		sourceObservationIds: ['observation-1'],
		evidencePhotoIds: ['photo-1'],
		evidenceTranscriptSpanIds: ['span-1'],
		evidence: [
			{ photoId: 'photo-1', reason: 'Label is visible', quote: 'USB-C cable' },
			{ transcriptSpanId: 'span-1', reason: 'Narration identifies the cable' },
		],
		blockerCodes: ['duplicate_unresolved'],
		warningCodes: ['needs_review'],
		duplicateMatches: [
			{ existingItemId: 'homebox-existing', matchKind: 'model', reasons: ['same model'] },
		],
		duplicateResolution: {
			action: 'review',
			existingItemId: 'homebox-existing',
			atMs: 1_700_000_002_000,
		},
		createdHomeboxItemId: 'homebox-created',
		description: 'A braided cable',
		tagIds: ['electronics', 'cable'],
		manufacturer: 'Acme',
		modelNumber: 'C-100',
		serialNumber: 'SERIAL-1',
		purchasePrice: 12.5,
		purchaseFrom: 'Store',
		notes: 'Keep with the dock',
		customFields: { connector: 'USB-C', length: '2m' },
		suggestedAction: 'review',
		correctionHistory: [{ atMs: 1_700_000_001_000, fields: ['quantity'] }],
		payloadSnapshot: { parent_id: 'parent-1', quantity: 3, marker: 'lossless' },
		...overrides,
	};
}

async function prepareCapture(page: import('@playwright/test').Page): Promise<void> {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
}

async function seedReviewBundle(
	page: import('@playwright/test').Page,
	missionOverrides: Record<string, unknown> = {},
	candidateOverrides: Record<string, unknown> = {},
	options: {
		span?: Record<string, unknown>;
		chunk?: Record<string, unknown>;
		outbox?: Record<string, unknown>;
	} = {}
): Promise<void> {
	const mission = baseMission({
		status: 'reviewing',
		photoIds: ['photo-1'],
		transcriptSpanIds: ['span-1'],
		candidateIds: ['candidate-1'],
		outboxOperationIds: ['outbox-1'],
		...missionOverrides,
	});
	const photo = photoRecord('photo-1', 10);
	const audio = {
		schemaVersion: 2,
		missionId,
		id: 'audio-1',
		status: 'done',
		blob: browserBlob('audio', 'audio/webm'),
		mimeType: 'audio/webm',
		byteSize: 5,
		startedAtMs: 1_700_000_000_300,
		endedAtMs: 1_700_000_001_300,
		rawTranscript: 'raw audio transcript',
		transcript: 'server audio transcript',
		source: 'server',
		error: null,
		retryCount: 1,
	};
	const span = {
		schemaVersion: 2,
		missionId,
		id: 'span-1',
		sourceAudioSegmentId: 'audio-1',
		text: 'three cables beside the dock',
		startOffsetMs: 120,
		endOffsetMs: 980,
		source: 'server',
		canonical: true,
		...options.span,
	};
	const candidate = candidateRecord(candidateOverrides);
	const outbox = {
		schemaVersion: 2,
		missionId,
		id: 'outbox-1',
		candidateId: 'candidate-1',
		requestHash: 'hash-1',
		status: 'partial',
		evidencePhotoIds: ['photo-1'],
		homeboxItemId: 'homebox-created',
		lastError: { code: 'ATTACHMENT_FAILED', message: 'retry', retryable: true },
		payloadSnapshot: { name: 'USB-C cable', parent_id: 'parent-1' },
		expectedAttachmentManifest: ['photo-1'],
		attachmentResults: { 'photo-1': 'failed' },
		stepState: 'partial',
		attemptCount: 2,
		...options.outbox,
	};
	const chunk = options.chunk
		? {
				schemaVersion: 2,
				missionId,
				id: 'chunk-1',
				status: 'complete',
				photoIds: ['photo-1'],
				transcriptSpanIds: ['span-1'],
				requestHash: 'chunk-hash-1',
				observations: [{ id: 'observation-1', name: 'USB-C cable', evidencePhotoIds: ['photo-1'] }],
				error: null,
				...options.chunk,
			}
		: null;
	await seedV2Bundle(page, {
		missions: [{ key: missionId, value: mission }],
		photos: [{ key: key(missionId, 'photo-1'), value: photo }],
		audio: [{ key: key(missionId, 'audio-1'), value: audio }],
		spans: [{ key: key(missionId, 'span-1'), value: span }],
		chunks: chunk ? [{ key: key(missionId, 'chunk-1'), value: chunk }] : [],
		candidates: [{ key: key(missionId, 'candidate-1'), value: candidate }],
		outbox: [{ key: key(missionId, 'outbox-1'), value: outbox }],
		meta: [
			{
				key: `candidate-snapshot:${missionId}`,
				value: { candidates: [candidate], marker: 'mission-scoped' },
			},
		],
	});
}

test('UI photo state becomes safe only after durable photo append commits', async ({ page }) => {
	await prepareCapture(page);
	const fileInput = page.locator('input[type="file"]');
	const input = fileInput.setInputFiles({
		name: 'delayed.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('delayed-photo'),
	});
	await expect.poll(async () => (await readStore(page, 'photos')).length).toBe(1);
	await input;
	await expect(page.getByText('Photos (1)')).toBeVisible();
});

test('generic mission saves preserve durable observation and outbox ID lists', async ({ page }) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{
			observationChunkIds: ['chunk-1'],
			outboxOperationIds: ['outbox-1'],
		},
		{},
		{ chunk: {} }
	);
	await page.goto('/bulk-capture');
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page
		.getByPlaceholder('Talk while capturing, or type notes here.')
		.fill('mission save flush');
	await page.getByRole('button', { name: 'Review Transcript' }).click();
	await expect
		.poll(async () => {
			const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
			return (missions.find((entry) => entry.id === missionId)?.editedTranscript as string) ?? '';
		})
		.toBe('mission save flush');
	const mission = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === missionId
	);
	expect(mission).toMatchObject({
		observationChunkIds: ['chunk-1'],
		outboxOperationIds: ['outbox-1'],
	});
});

test('quota failure rolls back the new batch and preserves prior evidence', async ({ page }) => {
	await page.addInitScript(() => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			if (this.name === 'photos' && (value as { filename?: string })?.filename === 'quota.jpg') {
				throw new DOMException('quota', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		};
	});
	await prepareCapture(page);
	const fileInput = page.locator('input[type="file"]');
	await fileInput.setInputFiles({
		name: 'first.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('first-photo'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await fileInput.setInputFiles({
		name: 'quota.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('quota-photo'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await expect.poll(async () => (await readStore(page, 'photos')).length).toBe(1);
});

test('capture sequences are unique, monotonic, and never reused after removal', async ({
	page,
}) => {
	await prepareCapture(page);
	const fileInput = page.locator('input[type="file"]');
	await fileInput.setInputFiles(
		Array.from({ length: 2 }, (_, index) => ({
			name: `initial-${index}.jpg`,
			mimeType: 'image/jpeg',
			buffer: Buffer.from(`initial-${index}`),
		}))
	);
	await expect(page.getByText('Photos (2)')).toBeVisible();
	await page.getByRole('button', { name: 'Remove photo' }).first().click();
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await fileInput.setInputFiles({
		name: 'after-removal.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('after-removal'),
	});
	await expect(page.getByText('Photos (2)')).toBeVisible();
	const photos = (await readStore(page, 'photos')) as Array<{ captureSequence: number }>;
	expect(photos.map((photo) => photo.captureSequence).sort((a, b) => a - b)).toEqual([1, 2]);
});

test('concurrent photo appends allocate durable non-reused sequences', async ({ page }) => {
	await prepareCapture(page);
	await expect(page.locator('input[type="file"]')).toHaveCount(1);
	await page.evaluate(() => {
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		const dispatch = (name: string) => {
			const transfer = new DataTransfer();
			transfer.items.add(new File([name], name, { type: 'image/jpeg' }));
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
			setter?.call(input, transfer.files);
			input.dispatchEvent(new Event('change', { bubbles: true }));
		};
		dispatch('concurrent-a.jpg');
		dispatch('concurrent-b.jpg');
	});
	await expect(page.getByText('Photos (2)')).toBeVisible();
	const photos = (await readStore(page, 'photos')) as Array<{ captureSequence: number }>;
	expect(photos.map((photo) => photo.captureSequence).sort((a, b) => a - b)).toEqual([0, 1]);
});

test('mocked camera browser plumbing persists non-empty blobs before visible photo state', async ({
	page,
}) => {
	await page.addInitScript(() => {
		(window as Window & { phase1PlayCalls?: number }).phase1PlayCalls = 0;
		const track = { stop() {}, applyConstraints: async () => {} };
		const stream = new MediaStream();
		Object.defineProperty(stream, 'getTracks', { value: () => [track] });
		Object.defineProperty(stream, 'getVideoTracks', { value: () => [track] });
		Object.defineProperty(navigator, 'mediaDevices', {
			value: { getUserMedia: async () => stream },
		});
		Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
			configurable: true,
			get: () => 4,
		});
		Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
			configurable: true,
			get: () => 1280,
		});
		Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
			configurable: true,
			get: () => 720,
		});
		HTMLMediaElement.prototype.play = async function () {
			const state = window as Window & { phase1PlayCalls?: number };
			state.phase1PlayCalls = (state.phase1PlayCalls ?? 0) + 1;
		};
		HTMLCanvasElement.prototype.toBlob = function (callback) {
			callback(new Blob(['camera-photo'], { type: 'image/jpeg' }));
		};
	});
	await prepareCapture(page);
	await page.getByRole('button', { name: /start camera/i }).click();
	await page.locator('video').dispatchEvent('loadedmetadata');
	await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
	expect(await page.locator('video').evaluate((element) => Boolean(element.srcObject))).toBe(true);
	await expect
		.poll(() =>
			page.evaluate(() => (window as Window & { phase1PlayCalls?: number }).phase1PlayCalls)
		)
		.toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByText('Photos (1)')).toBeVisible();
	const firstBlobSize = await page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const request = indexedDB.open('hbc-bulk-missions', 2);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const get = db.transaction('photos', 'readonly').objectStore('photos').getAll();
					get.onerror = () => reject(get.error);
					get.onsuccess = () => {
						db.close();
						resolve((get.result[0] as { blob?: Blob } | undefined)?.blob?.size ?? 0);
					};
				};
			})
	);
	expect(firstBlobSize).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByText('Photos (2)')).toBeVisible();
	const blobSizes = await page.evaluate(
		() =>
			new Promise<number[]>((resolve, reject) => {
				const request = indexedDB.open('hbc-bulk-missions', 2);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const get = db.transaction('photos', 'readonly').objectStore('photos').getAll();
					get.onerror = () => reject(get.error);
					get.onsuccess = () => {
						db.close();
						resolve(get.result.map((entry: { blob?: Blob }) => entry.blob?.size ?? 0));
					};
				};
			})
	);
	expect(blobSizes).toHaveLength(2);
	expect(blobSizes.every((size) => size > 0)).toBe(true);
});

for (const mode of ['null', 'zero-byte'] as const) {
	test(`camera ${mode} output is rejected with a retryable visible error`, async ({ page }) => {
		await page.addInitScript((outputMode) => {
			const track = { stop() {}, applyConstraints: async () => {} };
			const stream = new MediaStream();
			Object.defineProperty(stream, 'getTracks', { value: () => [track] });
			Object.defineProperty(stream, 'getVideoTracks', { value: () => [track] });
			Object.defineProperty(navigator, 'mediaDevices', {
				value: { getUserMedia: async () => stream },
			});
			Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
				configurable: true,
				get: () => 4,
			});
			Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
				configurable: true,
				get: () => 1280,
			});
			Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
				configurable: true,
				get: () => 720,
			});
			HTMLMediaElement.prototype.play = async function () {};
			HTMLCanvasElement.prototype.toBlob = function (callback) {
				callback(outputMode === 'null' ? null : new Blob([], { type: 'image/jpeg' }));
			};
		}, mode);
		await prepareCapture(page);
		await page.getByRole('button', { name: /start camera/i }).click();
		await page.locator('video').dispatchEvent('loadedmetadata');
		await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
		await page.getByRole('button', { name: 'Take photo' }).click();
		await expect(
			page.getByText('The camera returned an empty photo. Please try again.')
		).toBeVisible();
		await expect(page.getByText('Photos (0)')).toBeVisible();
	});
}

test('mission context, transcript, candidate, and outbox fields survive reload', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page, { parentItemId: 'parent-1', parentItemName: 'Cable box' });
	await page.goto('/bulk-capture');
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await expect(page.locator('textarea')).toHaveValue('edited shelf narration');
	await page.goto('/bulk-review');
	await expect(page.getByRole('heading', { name: 'USB-C cable' })).toBeVisible();
	await expect(page.getByText('A braided cable')).toBeVisible();
	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.waitForTimeout(200);
	const candidates = (await readStore(page, 'candidates')) as Array<Record<string, unknown>>;
	const candidate = candidates.find((entry) => entry.id === 'candidate-1');
	expect(candidate).toMatchObject(candidateRecord());
	const outbox = (await readStore(page, 'outbox')) as Array<Record<string, unknown>>;
	expect(outbox[0]).toMatchObject({
		status: 'partial',
		payloadSnapshot: { name: 'USB-C cable', parent_id: 'parent-1' },
		attachmentResults: { 'photo-1': 'failed' },
		attemptCount: 2,
	});
});

test('transcript span identity and edited text flush before reload', async ({ page }) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{},
		{},
		{
			span: {
				startOffsetMs: null,
				endOffsetMs: null,
				sourceAudioSegmentId: 'audio-1',
				source: 'manual',
				canonical: false,
			},
		}
	);
	await page.goto('/bulk-capture');
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page
		.getByPlaceholder('Talk while capturing, or type notes here.')
		.fill('flush before reload');
	await page.getByRole('button', { name: 'Review Transcript' }).click();
	await page.reload();
	const mission = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === missionId
	);
	const span = ((await readStore(page, 'spans')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === 'span-1'
	);
	expect(mission).toMatchObject({
		editedTranscript: 'flush before reload',
		transcriptEdited: true,
		transcriptSpanIds: ['span-1'],
	});
	expect(span).toMatchObject({
		sourceAudioSegmentId: 'audio-1',
		startOffsetMs: null,
		endOffsetMs: null,
		source: 'manual',
		canonical: false,
	});
});

test('outbox recovery reads and restores complete retry state after reload', async ({ page }) => {
	await page.addInitScript(() => {
		(window as Window & { phase1OutboxReads?: number }).phase1OutboxReads = 0;
		const originalGetAll = IDBObjectStore.prototype.getAll;
		IDBObjectStore.prototype.getAll = function (...args) {
			if (this.name === 'outbox') {
				const state = window as Window & { phase1OutboxReads?: number };
				state.phase1OutboxReads = (state.phase1OutboxReads ?? 0) + 1;
			}
			return originalGetAll.apply(this, args);
		};
	});
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page);
	await page.goto('/bulk-review');
	await expect(page.getByRole('heading', { name: 'USB-C cable' })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => (window as Window & { phase1OutboxReads?: number }).phase1OutboxReads)
		)
		.toBeGreaterThan(0);
	const outbox = ((await readStore(page, 'outbox')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === 'outbox-1'
	);
	expect(outbox).toMatchObject({
		status: 'partial',
		requestHash: 'hash-1',
		homeboxItemId: 'homebox-created',
		lastError: { code: 'ATTACHMENT_FAILED', message: 'retry', retryable: true },
		payloadSnapshot: { name: 'USB-C cable', parent_id: 'parent-1' },
		expectedAttachmentManifest: ['photo-1'],
		attachmentResults: { 'photo-1': 'failed' },
		stepState: 'partial',
		attemptCount: 2,
	});
});

test('first capture waits for the newly-created mission before appending evidence', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	const bulkSweepButton = page.getByRole('button', { name: /bulk sweep/i });
	await bulkSweepButton.click();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'first-capture.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('first-capture'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await expect(page.getByText(/Photo could not be saved/i)).toHaveCount(0);
	const mission = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id !== missionId
	);
	const photos = (await readStore(page, 'photos')) as Array<Record<string, unknown>>;
	expect(mission).toMatchObject({ photoIds: [photos[0]?.id] });
});

test('accepted reactive tag and custom-field payloads reserve outbox state without DataCloneError', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{},
		{
			state: 'accepted',
			reviewTier: 'ready',
			blockerCodes: [],
			warningCodes: [],
			duplicateMatches: [],
			duplicateResolution: null,
		}
	);
	await page.goto('/bulk-review');
	await page.getByRole('button', { name: /Submit Accepted \(1\)/ }).click();
	await expect.soft(page).toHaveURL(/\/bulk-complete/);
	const outbox = ((await readStore(page, 'outbox')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === `${missionId}:candidate-1`
	);
	await expect.soft(outbox).toMatchObject({
		status: 'complete',
		payloadSnapshot: {
			tag_ids: ['electronics', 'cable'],
			custom_fields: { connector: 'USB-C', length: '2m' },
		},
	});
});

test('successful submission persists candidate status and Homebox identity across reload recovery', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{},
		{
			state: 'accepted',
			reviewTier: 'ready',
			blockerCodes: [],
			warningCodes: [],
			duplicateMatches: [],
			duplicateResolution: null,
		}
	);
	await page.goto('/bulk-review');
	await page.getByRole('button', { name: /Submit Accepted \(1\)/ }).click();
	await expect.soft(page).toHaveURL(/\/bulk-complete/);
	const storedCandidate = (
		(await readStore(page, 'candidates')) as Array<Record<string, unknown>>
	).find((entry) => entry.id === 'candidate-1');
	await expect.soft(storedCandidate).toMatchObject({
		state: 'submitted',
		createdHomeboxItemId: 'phase1-item',
	});

	await page.goto('/bulk-review');
	await page.reload();
	await page.getByRole('tab', { name: /submitted/i }).click();
	await expect.soft(page.getByRole('heading', { name: 'USB-C cable' })).toBeVisible();
	await expect.soft(page.getByText(/Review status: submitted/)).toBeVisible();
});

test('candidate recovery and edit preserve duplicateCandidateIds without fabricating confidence', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{},
		{
			duplicateCandidateIds: ['candidate-peer-1', 'candidate-peer-2'],
		}
	);
	await page.goto('/bulk-review');
	await page.reload();
	await expect(page.getByRole('heading', { name: 'USB-C cable' })).toBeVisible();
	await expect.soft(page.locator('p.hidden')).not.toContainText('NaN%');
	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.waitForTimeout(250);
	const candidate = ((await readStore(page, 'candidates')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === 'candidate-1'
	);
	await expect.soft(candidate).toMatchObject({
		duplicateCandidateIds: ['candidate-peer-1', 'candidate-peer-2'],
	});
	await expect.soft(candidate).not.toHaveProperty('confidence');
});

test('photo removal strips evidence-photo IDs from surviving outbox payload, manifest, and results', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{},
		{ evidencePhotoIds: [], evidence: [], sourceObservationIds: [], evidenceTranscriptSpanIds: [] },
		{
			outbox: {
				evidencePhotoIds: ['photo-1'],
				payloadSnapshot: { name: 'USB-C cable', evidence_photo_ids: ['photo-1'] },
				expectedAttachmentManifest: ['photo-1'],
				attachmentResults: { 'photo-1': 'failed' },
			},
		}
	);
	await page.goto('/bulk-capture');
	await page.getByRole('button', { name: 'Remove photo' }).click();
	await expect(page.getByText('Photos (0)')).toBeVisible();
	const outbox = ((await readStore(page, 'outbox')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === 'outbox-1'
	);
	expect(outbox).toMatchObject({
		evidencePhotoIds: [],
		expectedAttachmentManifest: [],
		attachmentResults: {},
		payloadSnapshot: { evidence_photo_ids: [] },
	});
});

test('concurrent stale mission save cannot reintroduce a photo removed atomically', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page, {}, { evidencePhotoIds: [], evidence: [] });
	await page.goto('/bulk-capture');
	const remove = page.getByRole('button', { name: 'Remove photo' });
	const transcript = page.getByPlaceholder('Talk while capturing, or type notes here.');
	await Promise.all([remove.click(), transcript.fill('stale mission save')]);
	await expect(page.getByText('Photos (0)')).toBeVisible();
	await page.getByRole('button', { name: 'Review Transcript' }).click();
	await page.waitForTimeout(250);
	const mission = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === missionId
	);
	expect(mission).toMatchObject({ photoIds: [] });
});

test('transcript edit failure is surfaced by flush/review instead of claiming a safe review state', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			if (
				this.name === 'missions' &&
				(value as { editedTranscript?: string })?.editedTranscript ===
					'transcript persistence failure'
			) {
				throw new DOMException('transcript persistence failed', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		};
	});
	await prepareCapture(page);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'transcript-evidence.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('transcript-evidence'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page
		.getByPlaceholder('Talk while capturing, or type notes here.')
		.fill('transcript persistence failure');
	await page.getByRole('button', { name: 'Review Transcript' }).click();
	await expect
		.soft(page.getByRole('button', { name: 'Analyze with this transcript' }))
		.toHaveCount(0);
	await expect.soft(page.getByText(/persistence failed|could not save|retry/i)).toBeVisible();
});

test('v1 to v2 migration preserves blobs, keys, and migration metadata', async ({ page }) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	const v1Mission = {
		id: missionId,
		status: 'capturing',
		locationId: 'room-1',
		locationName: 'Living room',
		parentItemId: null,
		areaLabel: '',
		locationPath: 'Living room',
		startedAtMs: activeSeedTimeMs - 1_000,
		photoIds: ['v1-photo'],
		audioSegmentIds: [],
		transcriptSpanIds: [],
		observationChunkIds: [],
		candidateIds: ['v1-candidate'],
		outboxOperationIds: [],
		chunkSize: 6,
		lastError: null,
	};
	const v1Photo = {
		missionId,
		id: 'v1-photo',
		status: 'ready',
		blob: browserBlob('v1-blob', 'image/jpeg'),
		filename: 'v1.jpg',
		mimeType: 'image/jpeg',
		byteSize: 7,
		takenAtMs: 1_700_000_010_100,
		sessionOffsetMs: 100,
		note: '',
		groupLabel: '',
		ignored: false,
	};
	const v1Candidate = {
		missionId,
		id: 'v1-candidate',
		state: 'needs_review',
		reviewTier: 'attention',
		name: 'Legacy item',
		quantity: 1,
		evidencePhotoIds: ['v1-photo'],
	};
	await seedV1Bundle(page, {
		missions: [{ key: missionId, value: v1Mission }],
		photos: [{ key: key(missionId, 'v1-photo'), value: v1Photo }],
		candidates: [{ key: key(missionId, 'v1-candidate'), value: v1Candidate }],
	});
	await page.goto('/bulk-capture');
	await expect(page.getByText('Photos (1)')).toBeVisible();
	const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
	const photos = (await readStore(page, 'photos')) as Array<Record<string, unknown>>;
	const candidates = (await readStore(page, 'candidates')) as Array<Record<string, unknown>>;
	const meta = (await readStore(page, 'meta')) as Array<Record<string, unknown>>;
	expect(missions.find((entry) => entry.id === missionId)).toMatchObject({
		schemaVersion: 2,
		createdAtMs: activeSeedTimeMs - 1_000,
		parentItemName: null,
		nextCaptureSequence: 1,
	});
	expect(photos.find((entry) => entry.id === 'v1-photo')).toMatchObject({
		schemaVersion: 2,
		captureSequence: 0,
	});
	const migratedBlobSize = await page.evaluate(
		({ databaseName, storeName, recordKey }) =>
			new Promise<number>((resolve, reject) => {
				const request = indexedDB.open(databaseName, 2);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const get = db.transaction(storeName, 'readonly').objectStore(storeName).get(recordKey);
					get.onerror = () => reject(get.error);
					get.onsuccess = () => {
						const size = (get.result as { blob?: Blob } | undefined)?.blob?.size ?? -1;
						db.close();
						resolve(size);
					};
				};
			}),
		{
			databaseName: 'hbc-bulk-missions',
			storeName: 'photos',
			recordKey: key(missionId, 'v1-photo'),
		}
	);
	expect(migratedBlobSize).toBe(7);
	expect(candidates.find((entry) => entry.id === 'v1-candidate')).toMatchObject({
		schemaVersion: 2,
		correctionHistory: [],
		payloadSnapshot: null,
	});
	expect(meta.find((entry) => entry.schemaVersion === 2)).toMatchObject({
		recordsMigrated: true,
	});
});

test('candidate replacement removes stale records and updates the mission ID list exactly', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	const mission = baseMission({
		status: 'reviewing',
		candidateIds: ['candidate-a', 'candidate-b'],
	});
	await seedV2Bundle(page, {
		missions: [{ key: missionId, value: mission }],
		candidates: [
			{
				key: key(missionId, 'candidate-a'),
				value: candidateRecord({ id: 'candidate-a', name: 'A' }),
			},
			{
				key: key(missionId, 'candidate-b'),
				value: candidateRecord({ id: 'candidate-b', name: 'B' }),
			},
		],
	});
	await page.goto('/bulk-review');
	await expect(page.getByRole('heading', { name: 'A' })).toBeVisible();
	await page.getByRole('button', { name: 'Edit' }).first().click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.waitForTimeout(200);
	const candidates = (await readStore(page, 'candidates')) as Array<Record<string, unknown>>;
	const storedMission = (
		(await readStore(page, 'missions')) as Array<Record<string, unknown>>
	).find((entry) => entry.id === missionId);
	expect(candidates.map((entry) => entry.id).sort()).toEqual(['candidate-a', 'candidate-b']);
	expect(storedMission?.candidateIds).toEqual(['candidate-a', 'candidate-b']);
});

test('candidate replacement failure is atomic and leaves the prior candidate record intact', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			if (this.name === 'candidates' && (value as { name?: string })?.name === 'Replacement') {
				throw new DOMException('candidate write failed', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		};
	});
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page);
	await page.goto('/bulk-review');
	await page.getByRole('button', { name: 'Edit' }).click();
	await page.locator('input.input-sm').first().fill('Replacement');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.waitForTimeout(200);
	const candidates = (await readStore(page, 'candidates')) as Array<Record<string, unknown>>;
	expect(candidates).toHaveLength(1);
	expect(candidates[0]).toMatchObject({ id: 'candidate-1', name: 'USB-C cable' });
});

test('failed photo edit rolls back visible and durable state', async ({ page }) => {
	await page.addInitScript(() => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			if (this.name === 'photos' && (value as { note?: string })?.note === 'failed edit') {
				throw new DOMException('photo edit failed', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		};
	});
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page);
	await page.goto('/bulk-capture');
	const note = page.getByPlaceholder('Quick note');
	await expect(note).toHaveValue('photo note');
	await note.fill('failed edit');
	await note.press('Tab');
	await expect(
		page.getByText('Photo edit failed. The previous value was kept; retry when ready.', {
			exact: true,
		})
	).toBeVisible();
	await expect(note).toHaveValue('photo note');
	const photo = ((await readStore(page, 'photos')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === 'photo-1'
	);
	expect(photo).toMatchObject({ note: 'photo note', groupLabel: 'shelf group', ignored: false });
});

test('successful removal keeps mission, chunk, candidate, and outbox references coherent', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page, {}, {}, { chunk: { status: 'complete' } });
	await page.goto('/bulk-capture');
	await page.getByRole('button', { name: 'Remove photo' }).click();
	await expect(page.getByText('Photos (0)')).toBeVisible();
	const mission = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === missionId
	);
	const photos = await readStore(page, 'photos');
	const chunks = ((await readStore(page, 'chunks')) as Array<Record<string, unknown>>).filter(
		(entry) => entry.missionId === missionId
	);
	const candidates = (
		(await readStore(page, 'candidates')) as Array<Record<string, unknown>>
	).filter((entry) => entry.missionId === missionId);
	const outbox = ((await readStore(page, 'outbox')) as Array<Record<string, unknown>>).filter(
		(entry) => entry.missionId === missionId
	);
	expect(photos).toHaveLength(0);
	expect(chunks).toHaveLength(1);
	expect(chunks[0]).toMatchObject({
		id: 'chunk-1',
		status: 'pending',
		photoIds: [],
		observations: [],
	});
	expect(candidates).toHaveLength(0);
	expect(outbox).toHaveLength(0);
	expect(mission).toMatchObject({
		photoIds: [],
		observationChunkIds: ['chunk-1'],
		candidateIds: [],
		outboxOperationIds: [],
	});
});

test('photo removal failure leaves UI unchanged and guards duplicate clicks', async ({ page }) => {
	await page.addInitScript(() => {
		(window as Window & { phase1DeleteCalls?: number }).phase1DeleteCalls = 0;
		const originalDelete = IDBObjectStore.prototype.delete;
		IDBObjectStore.prototype.delete = function (key) {
			if (this.name === 'photos' && String(key).endsWith(':photo-1')) {
				const state = window as Window & { phase1DeleteCalls?: number };
				state.phase1DeleteCalls = (state.phase1DeleteCalls ?? 0) + 1;
				throw new DOMException('remove failed', 'QuotaExceededError');
			}
			return originalDelete.call(this, key);
		};
	});
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page);
	await page.goto('/bulk-capture');
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Remove photo' }).dblclick();
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await expect(
		page.getByText('Photo removal failed. Nothing was removed; retry when ready.', { exact: true })
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => (window as Window & { phase1DeleteCalls?: number }).phase1DeleteCalls)
		)
		.toBe(1);
});

test('discard removes mission-scoped metadata along with the mission', async ({ page }) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(page);
	await seedV2Bundle(page, {
		meta: [
			{ key: `candidate-snapshot:${missionId}`, value: { marker: 'mission-scoped' } },
			{
				key: 'schema',
				value: { schemaVersion: 2, recordsMigrated: true, migrationVersion: 2, marker: 'global' },
			},
			{ key: 'unrelated-meta', value: { marker: 'keep' } },
		],
	});
	await page.goto('/bulk-capture');
	await page.getByRole('button', { name: /discard this sweep/i }).click();
	await expect(page.getByText('Photos (1)')).toHaveCount(0);
	const missions = await readStore(page, 'missions');
	const meta = (await readStore(page, 'meta')) as Array<Record<string, unknown>>;
	expect(missions).toHaveLength(0);
	expect(meta.find((entry) => entry.marker === 'mission-scoped')).toBeUndefined();
	expect(meta.find((entry) => entry.marker === 'keep')).toBeDefined();
	expect(meta.find((entry) => entry.marker === 'global')).toMatchObject({
		schemaVersion: 2,
		recordsMigrated: true,
		migrationVersion: 2,
		marker: 'global',
	});
});

test('phase1 blocker 6: late camera oncapture after teardown cannot attach to a later mission', async ({
	page,
}) => {
	await page.addInitScript(() => {
		let resolveCamera: ((stream: MediaStream) => void) | null = null;
		let resolveBlob: ((blob: Blob | null) => void) | null = null;
		let stopCount = 0;
		let playCount = 0;
		const track = {
			stop: () => {
				stopCount += 1;
			},
			applyConstraints: async () => {},
		};
		const stream = new MediaStream();
		Object.defineProperty(stream, 'getTracks', { value: () => [track] });
		Object.defineProperty(stream, 'getVideoTracks', { value: () => [track] });
		Object.defineProperty(navigator, 'mediaDevices', {
			value: {
				getUserMedia: () =>
					new Promise<MediaStream>((resolve) => {
						resolveCamera = resolve;
					}),
			},
		});
		Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
			configurable: true,
			get: () => 4,
		});
		Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
			configurable: true,
			get: () => 1280,
		});
		Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
			configurable: true,
			get: () => 720,
		});
		HTMLMediaElement.prototype.play = async function () {
			playCount += 1;
		};
		HTMLCanvasElement.prototype.toBlob = function (callback) {
			resolveBlob = callback;
		};
		(
			window as Window & {
				phase1ResolveCamera?: () => void;
				phase1ResolveBlob?: () => void;
				phase1CameraStops?: () => number;
				phase1CameraPlayCount?: () => number;
			}
		).phase1ResolveCamera = () => resolveCamera?.(stream);
		(
			window as Window & {
				phase1ResolveCamera?: () => void;
				phase1ResolveBlob?: () => void;
				phase1CameraStops?: () => number;
				phase1CameraPlayCount?: () => number;
			}
		).phase1CameraStops = () => stopCount;
		(
			window as Window & {
				phase1ResolveCamera?: () => void;
				phase1ResolveBlob?: () => void;
				phase1CameraStops?: () => number;
				phase1CameraPlayCount?: () => number;
			}
		).phase1ResolveBlob = () =>
			resolveBlob?.(new Blob(['late-camera-photo'], { type: 'image/jpeg' }));
		(
			window as Window & {
				phase1ResolveCamera?: () => void;
				phase1ResolveBlob?: () => void;
				phase1CameraStops?: () => number;
				phase1CameraPlayCount?: () => number;
			}
		).phase1CameraPlayCount = () => playCount;
	});
	await prepareCapture(page);
	await page.getByRole('button', { name: /start camera/i }).click();
	await expect(page.getByRole('button', { name: /starting camera/i })).toBeVisible();
	await page.evaluate(() =>
		(window as Window & { phase1ResolveCamera?: () => void }).phase1ResolveCamera?.()
	);
	await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
	expect(await page.locator('video').evaluate((element) => Boolean(element.srcObject))).toBe(true);
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as Window & { phase1CameraPlayCount?: () => number }).phase1CameraPlayCount?.()
			)
		)
		.toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Take photo' }).click();
	await page.getByRole('link', { name: 'Back to mode choice' }).click();
	await expect(page).toHaveURL(/\/mode/);
	await page.evaluate(() =>
		(window as Window & { phase1ResolveBlob?: () => void }).phase1ResolveBlob?.()
	);
	await expect
		.poll(() =>
			page.evaluate(() =>
				(window as Window & { phase1CameraStops?: () => number }).phase1CameraStops?.()
			)
		)
		.toBe(1);
	await expect.poll(async () => (await readStore(page, 'photos')).length).toBe(0);
});

test('location fallback and persisted parent override use the correct payload target', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{ parentItemId: null, parentItemName: null },
		{
			state: 'accepted',
			reviewTier: 'ready',
			blockerCodes: [],
			warningCodes: [],
			duplicateMatches: [],
		}
	);
	await page.goto('/bulk-review');
	await expect(page.locator('pre')).toContainText('"parent_id": "room-1"');

	await page.goto('/location');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{ parentItemId: 'parent-1', parentItemName: 'Cable box' },
		{
			state: 'accepted',
			reviewTier: 'ready',
			blockerCodes: [],
			warningCodes: [],
			duplicateMatches: [],
		}
	);
	await page.goto('/bulk-review');
	await expect(page.locator('pre')).toContainText('"parent_id": "parent-1"');
});

test('phase1 blocker 1: queued mutable mission writes cannot resurrect discarded work into a new mission', async ({
	page,
}) => {
	await prepareCapture(page);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'discarded-evidence.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('discarded-evidence'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.getByRole('textbox', { name: 'Area label (optional)' }).fill('discarded shelf');
	await page.getByRole('button', { name: /discard this sweep/i }).click();

	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await expect(page.getByText('Photos (0)')).toBeVisible();
	await page.waitForTimeout(250);

	const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
	expect(missions.filter((mission) => mission.areaLabel === 'discarded shelf')).toHaveLength(0);
	expect(missions).toHaveLength(1);
	expect(missions[0]).not.toHaveProperty(
		'photoIds',
		expect.arrayContaining([expect.stringContaining('discarded')])
	);
});

test('phase1 blocker 2: v1 migration durably repairs mission ID lists when nextCaptureSequence is unchanged', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await seedV1Bundle(page, {
		missions: [
			{
				key: missionId,
				value: {
					...baseMission({ nextCaptureSequence: 1 }),
					photoIds: ['stale-photo-id'],
					status: 'capturing',
				},
			},
		],
		photos: [
			{
				key: key(missionId, 'actual-photo-id'),
				value: photoRecord('actual-photo-id', 0),
			},
		],
	});
	await page.goto('/bulk-capture');
	await expect(page.getByText('Photos (1)')).toBeVisible();
	const mission = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === missionId
	);
	expect(mission).toMatchObject({ photoIds: ['actual-photo-id'], nextCaptureSequence: 1 });
});

test('phase1 blocker 3: SpeechRecognition failure still sends the durable audio segment to server transcription', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await installNarrationMocks(page, { speechRecognition: 'error', transcription: 'success' });
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.waitForTimeout(50);
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect.poll(async () => (await readStore(page, 'audio')).length).toBe(1);
	await expect
		.poll(async () => {
			const segments = (await readStore(page, 'audio')) as Array<Record<string, unknown>>;
			return segments[0]?.status;
		})
		.toBe('done');
	const audio = ((await readStore(page, 'audio')) as Array<Record<string, unknown>>)[0];
	expect(audio).toMatchObject({
		status: 'done',
		source: 'server',
		transcript: 'server shelf narration',
	});
});

test('phase1 blocker 4: server transcription failure persists failed/error/retry state and is visible', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await installNarrationMocks(page, { speechRecognition: 'absent', transcription: 'failure' });
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
	await expect.poll(async () => (await readStore(page, 'audio')).length).toBe(1);
	await page.waitForTimeout(250);
	const audio = ((await readStore(page, 'audio')) as Array<Record<string, unknown>>)[0];
	expect.soft(audio).toMatchObject({
		status: 'failed',
		error: {
			code: 'TRANSCRIPTION_FAILED',
			message: expect.any(String),
			retryable: true,
		},
	});
	expect.soft(audio?.retryCount).toBeGreaterThan(0);
	await expect.soft(page.getByRole('alert')).toContainText(/transcription|retry/i);
});

test('phase1 blocker 5: removing a photo invalidates the outbox requestHash with the sanitized payload', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await seedReviewBundle(
		page,
		{},
		{ evidencePhotoIds: [], evidence: [], sourceObservationIds: [], evidenceTranscriptSpanIds: [] },
		{
			outbox: {
				evidencePhotoIds: ['photo-1'],
				payloadSnapshot: { name: 'USB-C cable', evidence_photo_ids: ['photo-1'] },
				expectedAttachmentManifest: ['photo-1'],
				attachmentResults: { 'photo-1': 'failed' },
			},
		}
	);
	await page.goto('/bulk-capture');
	await page.getByRole('button', { name: 'Remove photo' }).click();
	const outbox = ((await readStore(page, 'outbox')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === 'outbox-1'
	) as Record<string, unknown>;
	expect(outbox.payloadSnapshot).toMatchObject({ evidence_photo_ids: [] });
	expect(outbox.requestHash).toBe(JSON.stringify(outbox.payloadSnapshot));
});

test('phase1 blocker 7: file-picker quota failure is visible, retryable, and preserves prior evidence', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const originalPut = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (value, key) {
			if (
				this.name === 'photos' &&
				(value as { filename?: string })?.filename === 'quota-retry.jpg'
			) {
				throw new DOMException('quota', 'QuotaExceededError');
			}
			return originalPut.call(this, value, key);
		};
	});
	await prepareCapture(page);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'prior-evidence.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('prior-evidence'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'quota-retry.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('quota-evidence'),
	});
	await expect.soft(page.getByText(/Photo could not be saved|retry/i)).toBeVisible();
	const photos = (await readStore(page, 'photos')) as Array<Record<string, unknown>>;
	expect(photos).toHaveLength(1);
	expect(photos[0]).toMatchObject({ filename: 'prior-evidence.jpg' });
});

test('phase1 capture lifecycle A: a delayed mission-A photo cannot mutate a new mission B', async ({
	page,
}) => {
	await installDelayedMissionPhotoAppend(page);
	await prepareCapture(page);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'mission-a-before-delay.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('mission-a-before-delay'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	const missionA = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>)[0];
	const missionAId = String(missionA.id);

	await page.evaluate(() =>
		(window as Window & { phase1ArmDelayedAppend?: () => void }).phase1ArmDelayedAppend?.()
	);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'mission-a-delayed.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('mission-a-delayed'),
	});
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as Window & { phase1DelayedAppendPending?: boolean }).phase1DelayedAppendPending
			)
		)
		.toBe(true);

	await page.getByRole('link', { name: 'Back to mode choice' }).click();
	await page.getByRole('button', { name: /Bulk Sweep/ }).click();
	await expect(page.getByText('Photos (0)')).toBeVisible();

	await page.evaluate(() =>
		(window as Window & { phase1ReleaseDelayedAppend?: () => void }).phase1ReleaseDelayedAppend?.()
	);
	await expect
		.poll(async () =>
			((await readStore(page, 'missions')) as Array<Record<string, unknown>>).some(
				(mission) => mission.id !== missionAId
			)
		)
		.toBe(true);

	const photos = (await readStore(page, 'photos')) as Array<Record<string, unknown>>;
	const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
	const currentMissionId = String(missions.find((mission) => mission.id !== missionAId)?.id);
	const currentMission = missions.find((mission) => mission.id === currentMissionId);
	expect(photos.filter((photo) => photo.missionId === currentMissionId)).toHaveLength(0);
	expect(currentMission).toMatchObject({ photoIds: [] });
	await expect(page.getByText('Photos (0)')).toBeVisible();
});

test('phase1 capture lifecycle B: delayed MediaRecorder callbacks cannot attach old audio to mission B', async ({
	page,
}) => {
	await installNarrationMocks(page, {
		speechRecognition: 'absent',
		transcription: 'success',
		recorder: 'delayed',
		failAudioPersistence: true,
	});
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'mission-a-audio-anchor.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('mission-a-audio-anchor'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();

	await page.getByRole('link', { name: 'Back to mode choice' }).click();
	await page.getByRole('button', { name: /Bulk Sweep/ }).click();
	await expect(page.getByText('Photos (0)')).toBeVisible();
	const currentMissionId = String(
		((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
			(mission) => mission.status === 'capturing'
		)?.id
	);
	await page.evaluate(() =>
		(window as Window & { phase1ReleaseRecorder?: () => void }).phase1ReleaseRecorder?.()
	);
	await page.waitForTimeout(300);

	const audio = (await readStore(page, 'audio')) as Array<Record<string, unknown>>;
	const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
	const currentMission = missions.find((mission) => mission.id === currentMissionId);
	expect(audio.filter((segment) => segment.missionId === currentMissionId)).toHaveLength(0);
	expect(currentMission).toMatchObject({ audioSegmentIds: [] });
	expect(
		(await readUnhandledRejections(page)).filter(
			(message) => !/^AbortError:\s*AbortError$/.test(message)
		)
	).toEqual([]);
});

test('phase1 capture lifecycle C: final speech append failure is handled and preserves photo evidence', async ({
	page,
}) => {
	const finalText = 'final speech append failure';
	await failTranscriptSpanWrites(page, finalText);
	await installNarrationMocks(page, {
		speechRecognition: 'final',
		transcription: 'success',
		speechText: finalText,
	});
	await prepareCapture(page);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'preserved-evidence.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('preserved-evidence'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await expect(page.getByRole('alert')).toContainText(/retry|save|transcript/i);

	const photos = (await readStore(page, 'photos')) as Array<Record<string, unknown>>;
	const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
	const mission = missions.find((entry) => entry.id === missionId || entry.status === 'capturing');
	expect(photos).toHaveLength(1);
	expect(mission).toMatchObject({ photoIds: [photos[0].id] });
	expect(
		(await readUnhandledRejections(page)).filter(
			(message) => !/^AbortError:\s*AbortError$/.test(message)
		)
	).toEqual([]);
});
