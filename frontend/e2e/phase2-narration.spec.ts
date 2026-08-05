import { expect, test, type Page } from '@playwright/test';
import {
	baseMission,
	browserBlob,
	enterBulkCapture,
	establishAuthenticatedOrigin,
	installBulkApiMocks,
	resetBulkDatabase,
	readStore,
	seedV2Bundle,
} from './support/phase1Persistence';
import {
	installControlledTranscriptionRoute,
	installPhase2MediaMocks,
} from './support/phase2Narration';

async function prepare(page: Page, speechRecognition: 'absent' | 'final' | 'error' = 'absent') {
	await installBulkApiMocks(page);
	const api = await installControlledTranscriptionRoute(page);
	await installPhase2MediaMocks(page, { speechRecognition });
	await establishAuthenticatedOrigin(page);
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	return api;
}

async function record(page: Page) {
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
}

async function audio(page: Page) {
	return (await readStore(page, 'audio')) as Array<Record<string, unknown>>;
}

test('recording is durable before publication and server completion', async ({ page }) => {
	const api = await prepare(page);
	await record(page);
	const request = await api.waitForRequest(0);
	expect(request.authorization).toBe('Bearer phase-e2e-token');
	expect(request.contentType).toContain('multipart/form-data');
	expect(request.bodySize).toBeGreaterThan(0);
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('transcribing');
	const rows = await audio(page);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({ status: 'transcribing', retryCount: 1, byteSize: 12 });
	await api.fulfill(0, { text: 'server canonical', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
});

test('no SpeechRecognition persists audio then restores canonical server transcript', async ({
	page,
}) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fulfill(0, { text: 'server canonical', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	const before = (await audio(page))[0];
	const spans = (await readStore(page, 'spans')) as Array<Record<string, unknown>>;
	expect(spans).toMatchObject([
		{ id: `server:${before.id}`, source: 'server', canonical: true, text: 'server canonical' },
	]);
	await page.reload();
	await expect(page.getByPlaceholder('Talk while capturing, or type notes here.')).toHaveValue(
		'server canonical'
	);
	expect((await audio(page))[0]).toMatchObject({
		id: before.id,
		status: 'done',
		retryCount: 1,
		transcript: 'server canonical',
	});
});

test('successful SpeechRecognition remains preview-only and server result becomes canonical', async ({
	page,
}) => {
	const api = await prepare(page, 'final');
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByText('browser preview', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
	await api.waitForRequest(0);
	expect(await readStore(page, 'spans')).toHaveLength(0);
	await api.fulfill(0, { text: 'server canonical', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	expect(await readStore(page, 'spans')).toMatchObject([
		{
			id: expect.stringMatching(/^server:/),
			text: 'server canonical',
			source: 'server',
			canonical: true,
		},
	]);
});

test('SpeechRecognition error leaves MediaRecorder available for canonical server transcription', async ({
	page,
}) => {
	const api = await prepare(page, 'error');
	await record(page);
	await api.waitForRequest(0);
	await api.fulfill(0, {
		text: 'server after browser error',
		start_offset_ms: null,
		end_offset_ms: null,
	});
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	const rows = await audio(page);
	expect(rows[0]).toMatchObject({
		source: 'server',
		transcript: 'server after browser error',
		retryCount: 1,
	});
});

test('provider failure preserves durable audio evidence and exposes retry', async ({ page }) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fail(0, 503);
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('failed');
	const rows = await audio(page);
	expect(rows[0]).toMatchObject({
		status: 'failed',
		retryCount: 1,
		error: { code: 'TRANSCRIPTION_FAILED', retryable: true },
	});
	expect(await readStore(page, 'spans')).toHaveLength(0);
	await expect(page.getByRole('button', { name: 'Retry transcription' })).toBeVisible();
});

test('retry after reload reuses the exact segment and Blob and advances retry count', async ({
	page,
}) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fail(0);
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('failed');
	const before = (await audio(page))[0];
	await page.reload();
	await page.getByRole('button', { name: 'Retry transcription' }).click();
	await api.waitForRequest(1);
	expect((await audio(page))[0]).toMatchObject({
		id: before.id,
		retryCount: 2,
	});
	await api.fulfill(1, { text: 'retry transcript', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	expect(
		(await readStore(page, 'spans')).filter(
			(span) => (span as Record<string, unknown>).id === `server:${before.id}`
		)
	).toHaveLength(1);
});

test('duplicate retry clicks acquire one durable attempt and one provider request', async ({
	page,
}) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fail(0);
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('failed');
	await page.reload();
	const retry = page.getByRole('button', { name: 'Retry transcription' });
	await expect(retry).toBeVisible({ timeout: 15_000 });
	await Promise.all([retry.click({ force: true }), retry.click({ force: true })]);
	await api.waitForRequest(1);
	await expect(retry).toBeDisabled();
	expect((await audio(page))[0].retryCount).toBe(2);
	await api.fulfill(1, { text: 'one retry', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	expect(api.requests).toHaveLength(2);
});

test('provider offsets are converted to stable mission-relative span offsets', async ({ page }) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fulfill(0, { text: 'offset transcript', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	const span = (await readStore(page, 'spans'))[0] as Record<string, unknown>;
	expect(span).toMatchObject({
		startOffsetMs: expect.any(Number),
		endOffsetMs: expect.any(Number),
	});
});

test('missing invalid and out-of-range provider offsets use the durable interval', async ({
	page,
}) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fulfill(0, { text: 'fallback transcript', start_offset_ms: -1, end_offset_ms: 999999 });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	const span = (await readStore(page, 'spans'))[0] as Record<string, unknown>;
	expect(Number(span.startOffsetMs)).toBeGreaterThanOrEqual(0);
	expect(Number(span.endOffsetMs)).toBeGreaterThanOrEqual(Number(span.startOffsetMs));
});

test('microphone denial leaves typed transcript usable and creates no audio record', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	await installControlledTranscriptionRoute(page);
	await installPhase2MediaMocks(page);
	await establishAuthenticatedOrigin(page);
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	await page
		.getByPlaceholder('Talk while capturing, or type notes here.')
		.fill('typed kitchen notes');
	await expect(page.getByPlaceholder('Talk while capturing, or type notes here.')).toHaveValue(
		'typed kitchen notes'
	);
});

test('server transcript has one deterministic span after reload', async ({ page }) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fulfill(0, { text: 'stable transcript', start_offset_ms: null, end_offset_ms: null });
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('done');
	const id = (await audio(page))[0].id;
	await page.reload();
	expect(
		(await readStore(page, 'spans')).filter(
			(span) => (span as Record<string, unknown>).id === `server:${id}`
		)
	).toHaveLength(1);
});

test('reload repairs an interrupted attempt without changing Blob identity or retry count', async ({
	page,
}) => {
	await installBulkApiMocks(page);
	const api = await installControlledTranscriptionRoute(page);
	await installPhase2MediaMocks(page);
	await establishAuthenticatedOrigin(page);
	await resetBulkDatabase(page);
	const missionId = 'phase2-interrupted';
	await seedV2Bundle(page, {
		missions: [
			{
				key: missionId,
				value: baseMission({
					id: missionId,
					status: 'capturing',
					audioSegmentIds: ['audio-interrupted'],
				}),
			},
		],
		audio: [
			{
				key: `${missionId}:audio-interrupted`,
				value: {
					schemaVersion: 2,
					missionId,
					id: 'audio-interrupted',
					status: 'transcribing',
					blob: browserBlob('audio-bytes-audio-interrupted', 'audio/webm'),
					mimeType: 'audio/webm',
					byteSize: 27,
					startedAtMs: 0,
					endedAtMs: 1000,
					rawTranscript: '',
					retryCount: 3,
					activeAttemptId: 'attempt-old',
					activeAttemptStartedAtMs: Date.now() - 5000,
					error: null,
				},
			},
		],
	});
	await page.goto('/bulk-capture');
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('failed');
	expect((await audio(page))[0]).toMatchObject({
		id: 'audio-interrupted',
		retryCount: 3,
		activeAttemptId: null,
		error: { code: 'TRANSCRIPTION_INTERRUPTED' },
	});
	await page.getByRole('button', { name: 'Retry transcription' }).click();
	await api.waitForRequest(0);
	expect((await audio(page))[0].retryCount).toBe(4);
	await api.fulfill(0, { text: 'recovered', start_offset_ms: null, end_offset_ms: null });
});

test('failure remains retryable and does not create a partial deterministic span', async ({
	page,
}) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	await api.fail(0);
	await expect.poll(async () => (await audio(page))[0]?.status).toBe('failed');
	const row = (await audio(page))[0];
	expect(row).toMatchObject({
		status: 'failed',
		activeAttemptId: null,
		error: { code: 'TRANSCRIPTION_FAILED' },
	});
	expect(
		(await readStore(page, 'spans')).filter(
			(span) => (span as Record<string, unknown>).id === `server:${row.id}`
		)
	).toHaveLength(0);
});

test('late provider completion cannot attach to a different current recording', async ({
	page,
}) => {
	const api = await prepare(page);
	await record(page);
	await api.waitForRequest(0);
	const missionA = (await readStore(page, 'missions')).find(
		(entry) => (entry as Record<string, unknown>).status === 'capturing'
	) as Record<string, unknown>;
	await page
		.locator('input[type="file"]')
		.setInputFiles({
			name: 'mission-a.jpg',
			mimeType: 'image/jpeg',
			buffer: Buffer.from('mission-a'),
		});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.getByRole('button', { name: /Discard this sweep/i }).click();
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	const missionB = (await readStore(page, 'missions')).find(
		(entry) => (entry as Record<string, unknown>).status === 'capturing'
	) as Record<string, unknown>;
	expect(missionB.id).not.toBe(missionA.id);
	await api.fulfill(0, {
		text: 'mission A transcript',
		start_offset_ms: null,
		end_offset_ms: null,
	});
	const current = (await readStore(page, 'missions')).find(
		(entry) => (entry as Record<string, unknown>).id === missionB.id
	) as Record<string, unknown>;
	expect(current.audioSegmentIds).toEqual([]);
	expect(current.transcriptSpanIds).toEqual([]);
	expect(current.rawTranscript).toBe('');
});
