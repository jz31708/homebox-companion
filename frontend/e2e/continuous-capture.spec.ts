import { expect, test, type Page } from '@playwright/test';
import {
	enterBulkCapture,
	establishAuthenticatedOrigin,
	installBulkApiMocks,
	readStore,
	resetBulkDatabase,
} from './support/phase1Persistence';
import { installPhase2MediaMocks, type Phase2MediaOptions } from './support/phase2Narration';

async function prepare(
	page: Page,
	mediaOptions: Phase2MediaOptions = {}
): Promise<Awaited<ReturnType<typeof installPhase2MediaMocks>>> {
	await page.addInitScript(() => {
		const state = window as Window & { continuousCaptureNativePickerClicks?: number };
		state.continuousCaptureNativePickerClicks = 0;
		const originalClick = HTMLInputElement.prototype.click;
		HTMLInputElement.prototype.click = function () {
			if (this.type === 'file') state.continuousCaptureNativePickerClicks! += 1;
			return originalClick.call(this);
		};
	});
	await installBulkApiMocks(page);
	const media = await installPhase2MediaMocks(page, {
		speechRecognition: 'absent',
		recorder: 'immediate',
		...mediaOptions,
	});
	await page.route('**/api/tools/audio/transcribe', async (route) => {
		await route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				text: 'continuous capture narration',
				start_offset_ms: null,
				end_offset_ms: null,
				segments: [],
			}),
		});
	});
	await establishAuthenticatedOrigin(page);
	await resetBulkDatabase(page);
	await enterBulkCapture(page);
	return media;
}

async function rapidShutter(page: Page, count: number): Promise<void> {
	await page.evaluate((tapCount) => {
		const button = Array.from(document.querySelectorAll('button')).find(
			(entry) => entry.getAttribute('aria-label') === 'Take photo'
		) as HTMLButtonElement | undefined;
		if (!button) throw new Error('Live shutter is unavailable');
		for (let index = 0; index < tapCount; index += 1) button.click();
	}, count);
}

async function photoRecords(page: Page): Promise<Array<Record<string, unknown>>> {
	return (await readStore(page, 'photos')) as Array<Record<string, unknown>>;
}

test('primary flow uses live camera and records ten rapid shutters in tap order', async ({ page }) => {
	const media = await prepare(page);
	await page.getByRole('button', { name: /start camera.*narrate/i }).click();
	await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

	await rapidShutter(page, 10);
	await expect.poll(async () => (await photoRecords(page)).length).toBe(10);

	const records = (await photoRecords(page)).sort(
		(a, b) => Number(a.captureSequence) - Number(b.captureSequence)
	);
	expect(records.map((record) => record.captureSequence)).toEqual([
		0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
	]);
	const offsets = records.map((record) => Number(record.sessionOffsetMs));
	for (let index = 1; index < offsets.length; index += 1) {
		expect(offsets[index]).toBeGreaterThanOrEqual(offsets[index - 1]);
	}
	expect(records.every((record) => Number(record.byteSize) > 0)).toBe(true);

	const runtime = await page.evaluate(() => ({
		videoActive: Array.from(document.querySelectorAll('video')).some((video) => Boolean(video.srcObject)),
		nativePickerClicks:
			(window as Window & { continuousCaptureNativePickerClicks?: number })
				.continuousCaptureNativePickerClicks ?? 0,
	}));
	expect(runtime).toEqual({ videoActive: true, nativePickerClicks: 0 });

	await page.getByRole('button', { name: 'Stop' }).click();
	await expect.poll(async () => ((await readStore(page, 'audio')) as unknown[]).length).toBe(1);
	await expect(page.getByText('Transcribed', { exact: true })).toBeVisible();
	const stats = await media.stats();
	expect(stats.recorderStarts).toBe(1);
	expect(stats.recorderStops).toBe(1);
});

test('microphone denial falls back to live video and typed notes without native picker', async ({
	page,
}) => {
	const media = await prepare(page, { microphone: 'denied' });
	await page.getByRole('button', { name: /start camera.*narrate/i }).click();
	await expect(page.getByText(/microphone unavailable/i)).toBeVisible();
	await page.getByRole('button', { name: 'Take photo' }).click();
	await expect.poll(async () => (await photoRecords(page)).length).toBe(1);

	const transcript = page.getByPlaceholder(
		'Talk while capturing, or type notes here. You can fix this before analysis.'
	);
	await transcript.fill('placard du bas, note saisie sans micro');
	await expect(transcript).toHaveValue('placard du bas, note saisie sans micro');

	const stats = await media.stats();
	expect(stats.getUserMediaCalls).toBe(2);
	expect(stats.recorderStarts).toBe(0);
	expect(
		await page.evaluate(
			() =>
				(window as Window & { continuousCaptureNativePickerClicks?: number })
					.continuousCaptureNativePickerClicks ?? 0
		)
	).toBe(0);
});

test('transcript review flushes every queued shutter before leaving capture', async ({ page }) => {
	await prepare(page);
	await page.getByRole('button', { name: /start camera.*narrate/i }).click();
	await rapidShutter(page, 6);
	await page.getByRole('button', { name: 'Review Transcript' }).click();

	await expect.poll(async () => (await photoRecords(page)).length).toBe(6);
	await expect(page.getByRole('button', { name: /analyze with this transcript/i })).toBeVisible();
	const records = (await photoRecords(page)).sort(
		(a, b) => Number(a.captureSequence) - Number(b.captureSequence)
	);
	expect(records.map((record) => record.captureSequence)).toEqual([0, 1, 2, 3, 4, 5]);
});
