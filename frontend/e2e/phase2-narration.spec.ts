import { expect, test, type Page } from '@playwright/test';
import {
	enterBulkCapture,
	establishAuthenticatedOrigin,
	installBulkApiMocks,
	readStore,
	resetBulkDatabase,
} from './support/phase1Persistence';
import {
	installAbortIgnoringTranscriptionFetch,
	installAudioCommitOrderingProbe,
	installControlledTranscriptionRoute,
	installOneShotPhase2IdbFailure,
	installPhase2MediaMocks,
	phase2AudioRecord,
	readAudioCommitOrderingProbe,
	readAudioSnapshots,
	seedPhase2NarrationMission,
	type ControlledTranscriptionApi,
	type Phase2MediaControls,
	type Phase2MediaOptions,
} from './support/phase2Narration';

interface PreparedNarration {
	api: ControlledTranscriptionApi;
	media: Phase2MediaControls;
}

async function prepareFreshNarration(
	page: Page,
	mediaOptions: Phase2MediaOptions = {},
	options: { orderingProbe?: boolean; ignoreAbort?: boolean } = {}
): Promise<PreparedNarration> {
	await installBulkApiMocks(page);
	const api = await installControlledTranscriptionRoute(page);
	const media = await installPhase2MediaMocks(page, mediaOptions);
	if (options.orderingProbe) await installAudioCommitOrderingProbe(page);
	if (options.ignoreAbort) await installAbortIgnoringTranscriptionFetch(page);
	await establishAuthenticatedOrigin(page);
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	return { api, media };
}

async function prepareSeededNarration(
	page: Page,
	audio: Array<Record<string, unknown>>,
	mission: Record<string, unknown> = {}
): Promise<PreparedNarration> {
	await installBulkApiMocks(page);
	const api = await installControlledTranscriptionRoute(page);
	const media = await installPhase2MediaMocks(page);
	await establishAuthenticatedOrigin(page);
	await resetBulkDatabase(page);
	await seedPhase2NarrationMission(page, audio, mission);
	await page.goto('/bulk-capture');
	await expect(page.getByRole('heading', { name: 'Bulk Sweep' })).toBeVisible();
	return { api, media };
}

async function recordOnce(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
}

async function waitForAudioStatus(page: Page, status: string, id?: string): Promise<void> {
	await expect
		.poll(async () => {
			const records = await readAudioSnapshots(page);
			return (id ? records.find((entry) => entry.id === id) : records[0])?.status;
		})
		.toBe(status);
}

async function currentMission(page: Page): Promise<Record<string, unknown>> {
	const missions = (await readStore(page, 'missions')) as Array<Record<string, unknown>>;
	const mission = missions
		.filter((entry) => entry.status === 'capturing')
		.sort((a, b) => Number(b.updatedAtMs ?? 0) - Number(a.updatedAtMs ?? 0))[0];
	if (!mission) throw new Error('No active capturing mission was found');
	return mission;
}

async function recordingRow(page: Page, segmentId: string) {
	return page
		.getByText(`Recording ${segmentId.slice(-6)}`, { exact: true })
		.locator('..')
		.locator('..');
}

test('recording is durable before publication and server completion', async ({ page }) => {
	const { api } = await prepareFreshNarration(
		page,
		{ speechRecognition: 'absent', recorder: 'immediate' },
		{ orderingProbe: true }
	);
	await recordOnce(page);
	const request = await api.waitForRequest(0);
	expect(request.authorization).toBe('Bearer phase-e2e-token');
	expect(request.contentType).toContain('multipart/form-data');
	expect(request.bodySize).toBeGreaterThan(0);
	await waitForAudioStatus(page, 'transcribing');
	const audio = await readAudioSnapshots(page);
	expect(audio).toHaveLength(1);
	expect(audio[0]).toMatchObject({
		status: 'transcribing',
		retryCount: 1,
		blobText: 'phase2-audio',
		blobSize: 'phase2-audio'.length,
	});
	expect(audio[0].activeAttemptId).toEqual(expect.any(String));
	const mission = await currentMission(page);
	expect(mission.audioSegmentIds).toEqual([audio[0].id]);
	await expect(page.getByText(/^Recording /)).toHaveCount(1);
	await expect(page.getByText('Transcribing', { exact: true })).toBeVisible();
	expect(await readAudioCommitOrderingProbe(page)).toEqual({
		audioInsertCommitted: true,
		recordingRowObserved: true,
		recordingRowObservedAfterCommit: true,
		fetchObservedAfterCommit: true,
	});
	await api.fulfill(0, { text: 'server canonical' });
	await waitForAudioStatus(page, 'done');
});

test('no SpeechRecognition persists audio then restores canonical server transcript', async ({
	page,
}) => {
	const { api } = await prepareFreshNarration(page, {
		speechRecognition: 'absent',
		recorder: 'immediate',
		audioText: 'durable-audio',
	});
	await recordOnce(page);
	await api.waitForRequest(0);
	const before = (await readAudioSnapshots(page))[0];
	await api.fulfill(0, { text: 'server canonical' });
	await waitForAudioStatus(page, 'done');
	const committed = (await readAudioSnapshots(page))[0];
	expect(committed).toMatchObject({
		id: before.id,
		status: 'done',
		retryCount: 1,
		source: 'server',
		transcript: 'server canonical',
		rawTranscript: 'server canonical',
		error: null,
		blobText: 'durable-audio',
	});
	expect(committed.activeAttemptId).toBeNull();
	const spans = (await readStore(page, 'spans')) as Array<Record<string, unknown>>;
	expect(spans).toMatchObject([
		{
			id: `server:${committed.id}`,
			sourceAudioSegmentId: committed.id,
			text: 'server canonical',
			source: 'server',
			canonical: true,
		},
	]);
	expect(await currentMission(page)).toMatchObject({
		rawTranscript: 'server canonical',
		canonicalTranscript: 'server canonical',
		editedTranscript: 'server canonical',
		transcriptEdited: false,
		transcriptSource: 'server',
		transcriptSpanIds: [`server:${committed.id}`],
	});
	await page.reload();
	await expect(page.getByPlaceholder('Talk while capturing, or type notes here.')).toHaveValue(
		'server canonical'
	);
	await expect(page.getByText('Transcribed', { exact: true })).toBeVisible();
	const recovered = (await readAudioSnapshots(page))[0];
	expect(recovered).toMatchObject({
		id: committed.id,
		blobText: committed.blobText,
		blobSize: committed.blobSize,
		retryCount: 1,
		status: 'done',
		transcript: 'server canonical',
	});
	expect(
		((await readStore(page, 'spans')) as Array<Record<string, unknown>>).filter(
			(span) => span.id === `server:${committed.id}`
		)
	).toHaveLength(1);
});

test('successful SpeechRecognition remains preview-only and server result becomes canonical', async ({
	page,
}) => {
	const { api } = await prepareFreshNarration(page, {
		speechRecognition: 'final',
		speechText: 'browser preview',
	});
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByText('browser preview', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
	await api.waitForRequest(0);
	expect(await readStore(page, 'spans')).toHaveLength(0);
	expect((await currentMission(page)).canonicalTranscript).not.toBe('browser preview');
	await api.fulfill(0, { text: 'server canonical' });
	await waitForAudioStatus(page, 'done');
	await expect(page.getByPlaceholder('Talk while capturing, or type notes here.')).toHaveValue(
		'server canonical'
	);
	const audio = (await readAudioSnapshots(page))[0];
	const spans = (await readStore(page, 'spans')) as Array<Record<string, unknown>>;
	expect(spans).toMatchObject([
		{
			id: `server:${audio.id}`,
			text: 'server canonical',
			source: 'server',
			canonical: true,
		},
	]);
	expect(spans.some((span) => span.text === 'browser preview')).toBe(false);
	await page.reload();
	const afterReload = (await readStore(page, 'spans')) as Array<Record<string, unknown>>;
	expect(afterReload.filter((span) => span.id === `server:${audio.id}`)).toHaveLength(1);
	expect(afterReload.some((span) => span.text === 'browser preview')).toBe(false);
});

test('SpeechRecognition error leaves MediaRecorder available for canonical server transcription', async ({
	page,
}) => {
	const { api, media } = await prepareFreshNarration(page, {
		speechRecognition: 'error',
	});
	await recordOnce(page);
	await api.waitForRequest(0);
	await api.fulfill(0, { text: 'server after browser error' });
	await waitForAudioStatus(page, 'done');
	expect((await readAudioSnapshots(page))[0]).toMatchObject({
		status: 'done',
		source: 'server',
		transcript: 'server after browser error',
		retryCount: 1,
	});
	expect(await media.stats()).toMatchObject({
		getUserMediaCalls: 1,
		recorderStarts: 1,
		recorderStops: 1,
		speechStarts: 1,
		unhandledRejections: [],
	});
});

test('provider failure preserves the exact audio evidence and exposes durable retry', async ({
	page,
}) => {
	const { api } = await prepareFreshNarration(page, {
		speechRecognition: 'absent',
		audioText: 'failed-audio-bytes',
	});
	await recordOnce(page);
	await api.waitForRequest(0);
	await api.fail(0, 503);
	await waitForAudioStatus(page, 'failed');
	const audio = (await readAudioSnapshots(page))[0];
	expect(audio).toMatchObject({
		status: 'failed',
		retryCount: 1,
		blobText: 'failed-audio-bytes',
		blobSize: 'failed-audio-bytes'.length,
		error: {
			code: 'TRANSCRIPTION_FAILED',
			message: 'Server transcription failed. Retry this recording.',
			retryable: true,
		},
	});
	expect(audio.activeAttemptId).toBeNull();
	expect(audio.activeAttemptStartedAtMs).toBeNull();
	expect((await currentMission(page)).audioSegmentIds).toEqual([audio.id]);
	expect(await readStore(page, 'spans')).toHaveLength(0);
	await expect(page.getByText('Transcription failed', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Retry transcription' })).toBeVisible();
	expect(JSON.stringify(audio)).not.toContain('Controlled transcription failure');
});

test('retry after reload reuses the exact segment and Blob and advances retry count', async ({
	page,
}) => {
	const { api } = await prepareFreshNarration(page, { audioText: 'same-blob' });
	await recordOnce(page);
	await api.waitForRequest(0);
	await api.fail(0);
	await waitForAudioStatus(page, 'failed');
	const before = (await readAudioSnapshots(page))[0];
	await page.reload();
	await page.getByRole('button', { name: 'Retry transcription' }).click();
	await api.waitForRequest(1);
	await api.fulfill(1, { text: 'retry transcript' });
	await waitForAudioStatus(page, 'done');
	const records = await readAudioSnapshots(page);
	expect(records).toHaveLength(1);
	expect(records[0]).toMatchObject({
		id: before.id,
		blobText: before.blobText,
		blobSize: before.blobSize,
		retryCount: 2,
		status: 'done',
		error: null,
	});
	expect(
		((await readStore(page, 'spans')) as Array<Record<string, unknown>>).filter(
			(span) => span.id === `server:${before.id}`
		)
	).toHaveLength(1);
});

test('duplicate retry clicks acquire one durable attempt and one provider request', async ({
	page,
}) => {
	const { api } = await prepareFreshNarration(page);
	await recordOnce(page);
	await api.waitForRequest(0);
	await api.fail(0);
	await waitForAudioStatus(page, 'failed');
	await page.reload();
	const retry = page.getByRole('button', { name: 'Retry transcription' });
	await expect(retry).toBeVisible();
	await Promise.all([retry.click({ force: true }), retry.click({ force: true })]);
	await api.waitForRequest(1);
	expect(api.requests).toHaveLength(2);
	expect((await readAudioSnapshots(page))[0].retryCount).toBe(2);
	await api.fulfill(1, { text: 'one retry' });
	await waitForAudioStatus(page, 'done');
	expect(api.requests).toHaveLength(2);
	const id = (await readAudioSnapshots(page))[0].id;
	expect(
		((await readStore(page, 'spans')) as Array<Record<string, unknown>>).filter(
			(span) => span.id === `server:${id}`
		)
	).toHaveLength(1);
});

test('reload repairs an interrupted attempt without changing Blob identity or retry count', async ({
	page,
}) => {
	const interrupted = phase2AudioRecord('audio-interrupted', {
		status: 'transcribing',
		retryCount: 3,
		activeAttemptId: 'attempt-old',
		activeAttemptStartedAtMs: Date.now() - 5_000,
		error: null,
	});
	const { api } = await prepareSeededNarration(page, [interrupted]);
	await waitForAudioStatus(page, 'failed', 'audio-interrupted');
	const repaired = (await readAudioSnapshots(page))[0];
	expect(repaired).toMatchObject({
		id: 'audio-interrupted',
		status: 'failed',
		retryCount: 3,
		activeAttemptId: null,
		activeAttemptStartedAtMs: null,
		error: { code: 'TRANSCRIPTION_INTERRUPTED', retryable: true },
		blobText: 'audio-bytes-audio-interrupted',
	});
	await page.getByRole('button', { name: 'Retry transcription' }).click();
	await api.waitForRequest(0);
	expect((await readAudioSnapshots(page))[0].retryCount).toBe(4);
	await api.fulfill(0, { text: 'recovered' });
	await waitForAudioStatus(page, 'done', 'audio-interrupted');
});

test('retrying an older recording binds the canonical span to that exact segment', async ({
	page,
}) => {
	const older = phase2AudioRecord('audio-older', { startedAtMs: 1_000, endedAtMs: 2_000 });
	const newer = phase2AudioRecord('audio-newer', { startedAtMs: 3_000, endedAtMs: 4_000 });
	const { api } = await prepareSeededNarration(page, [older, newer]);
	const row = await recordingRow(page, 'audio-older');
	await row.getByRole('button', { name: 'Retry transcription' }).click();
	await api.waitForRequest(0);
	await api.fulfill(0, { text: 'older transcript' });
	await waitForAudioStatus(page, 'done', 'audio-older');
	const spans = (await readStore(page, 'spans')) as Array<Record<string, unknown>>;
	expect(spans).toContainEqual(
		expect.objectContaining({
			id: 'server:audio-older',
			sourceAudioSegmentId: 'audio-older',
		})
	);
	expect(spans.some((span) => span.sourceAudioSegmentId === 'audio-newer')).toBe(false);
	expect((await readAudioSnapshots(page)).find((entry) => entry.id === 'audio-newer')?.transcript).not.toBe(
		'older transcript'
	);
});

test('provider offsets are converted to stable mission-relative span offsets', async ({ page }) => {
	const { api } = await prepareSeededNarration(page, [
		phase2AudioRecord('audio-offset', { startedAtMs: 5_000, endedAtMs: 9_000 }),
	]);
	await page.getByRole('button', { name: 'Retry transcription' }).click();
	await api.waitForRequest(0);
	await api.fulfill(0, {
		text: 'offset transcript',
		start_offset_ms: 500,
		end_offset_ms: 2_500,
	});
	await waitForAudioStatus(page, 'done', 'audio-offset');
	const span = ((await readStore(page, 'spans')) as Array<Record<string, unknown>>)[0];
	expect(span).toMatchObject({ startOffsetMs: 5_500, endOffsetMs: 7_500 });
	await page.reload();
	expect(((await readStore(page, 'spans')) as Array<Record<string, unknown>>)[0]).toMatchObject({
		startOffsetMs: 5_500,
		endOffsetMs: 7_500,
	});
});

test('missing invalid and out-of-range provider offsets use the documented bounded interval', async ({
	page,
}) => {
	const records = [
		phase2AudioRecord('audio-null'),
		phase2AudioRecord('audio-negative'),
		phase2AudioRecord('audio-reversed'),
		phase2AudioRecord('audio-bounded'),
	];
	const { api } = await prepareSeededNarration(page, records);
	const responses = [
		{ start_offset_ms: null, end_offset_ms: null },
		{ start_offset_ms: -1, end_offset_ms: 500 },
		{ start_offset_ms: 2_000, end_offset_ms: 1_000 },
		{ start_offset_ms: 3_000, end_offset_ms: 20_000 },
	];
	for (let index = 0; index < records.length; index += 1) {
		const id = String(records[index].id);
		const row = await recordingRow(page, id);
		await row.getByRole('button', { name: 'Retry transcription' }).click();
		await api.waitForRequest(index);
		await api.fulfill(index, { text: id, ...responses[index] });
		await waitForAudioStatus(page, 'done', id);
	}
	const spans = (await readStore(page, 'spans')) as Array<Record<string, unknown>>;
	for (const id of ['audio-null', 'audio-negative', 'audio-reversed']) {
		expect(spans.find((span) => span.id === `server:${id}`)).toMatchObject({
			startOffsetMs: 5_000,
			endOffsetMs: 9_000,
		});
	}
	expect(spans.find((span) => span.id === 'server:audio-bounded')).toMatchObject({
		startOffsetMs: 8_000,
		endOffsetMs: 9_000,
	});
});

test('success transaction rollback produces no partial canonical state', async ({ page }) => {
	const { api } = await prepareFreshNarration(page);
	await recordOnce(page);
	await api.waitForRequest(0);
	await installOneShotPhase2IdbFailure(page, 'success-span-put');
	await api.fulfill(0, { text: 'must roll back' });
	await waitForAudioStatus(page, 'failed');
	const audio = (await readAudioSnapshots(page))[0];
	expect(audio.status).toBe('failed');
	expect(audio.blobText).toBe('phase2-audio');
	expect(audio.retryCount).toBe(1);
	expect(await readStore(page, 'spans')).toHaveLength(0);
	expect((await currentMission(page)).canonicalTranscript).not.toBe('must roll back');
	await expect(page.getByRole('button', { name: 'Retry transcription' })).toBeVisible();
});

test('failure transaction rollback does not publish a false durable failed state', async ({ page }) => {
	const { api } = await prepareFreshNarration(page);
	await recordOnce(page);
	await api.waitForRequest(0);
	await installOneShotPhase2IdbFailure(page, 'failure-mission-put');
	await api.fail(0);
	await expect
		.poll(async () => (await readAudioSnapshots(page))[0]?.status)
		.toBe('transcribing');
	const before = (await readAudioSnapshots(page))[0];
	expect(before.activeAttemptId).toEqual(expect.any(String));
	await page.reload();
	await waitForAudioStatus(page, 'failed');
	const repaired = (await readAudioSnapshots(page))[0];
	expect(repaired).toMatchObject({
		id: before.id,
		blobText: before.blobText,
		retryCount: before.retryCount,
		status: 'failed',
		error: { code: 'TRANSCRIPTION_INTERRUPTED' },
	});
});

test('late recorder preview and provider callbacks from mission A cannot mutate mission B', async ({
	page,
}) => {
	const { api, media } = await prepareFreshNarration(
		page,
		{ recorder: 'controlled', speechRecognition: 'controlled' },
		{ ignoreAbort: true }
	);
	await page.getByRole('button', { name: 'Narrate' }).click();
	await media.releaseRecorderData();
	await media.emitSpeechFinal('mission A preview');
	await expect(page.getByText('mission A preview', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Stop' }).click();
	await media.releaseRecorderStop();
	await api.waitForRequest(0);
	const missionA = await currentMission(page);
	const missionAId = String(missionA.id);
	await page.getByRole('link', { name: 'Back to mode choice' }).click();
	await page.getByRole('button', { name: /Bulk Sweep/ }).click();
	await expect(page.getByText('Photos (0)')).toBeVisible();
	const missionB = await currentMission(page);
	expect(missionB.id).not.toBe(missionAId);
	await api.fulfill(0, { text: 'mission A provider result' });
	await page.waitForTimeout(100);
	const finalMissionB = ((await readStore(page, 'missions')) as Array<Record<string, unknown>>).find(
		(entry) => entry.id === missionB.id
	);
	expect(finalMissionB).toMatchObject({
		audioSegmentIds: [],
		transcriptSpanIds: [],
		rawTranscript: '',
		canonicalTranscript: '',
		editedTranscript: '',
		lastError: null,
	});
	expect((await media.stats()).unhandledRejections).toEqual([]);
});

test('microphone denial leaves typed transcript usable and creates no audio record', async ({ page }) => {
	const { api } = await prepareFreshNarration(page, { microphone: 'denied' });
	await page.getByRole('button', { name: 'Narrate' }).click();
	await expect(page.getByText('Microphone unavailable. You can type notes instead.', { exact: true })).toBeVisible();
	const textarea = page.getByPlaceholder('Talk while capturing, or type notes here.');
	await textarea.fill('typed kitchen notes');
	await expect(textarea).toHaveValue('typed kitchen notes');
	await expect.poll(async () => (await currentMission(page)).editedTranscript).toBe(
		'typed kitchen notes'
	);
	expect(await readAudioSnapshots(page)).toHaveLength(0);
	expect(api.requests).toHaveLength(0);
});
