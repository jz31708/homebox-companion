import { expect, test } from '@playwright/test';

async function mockBulkApi(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		window.localStorage.setItem('hbc_token', 'e2e-token');
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
				json: { version: 'e2e', latest_version: null, update_available: false },
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
			await route.fulfill({ json: { status: 'complete', homeboxItemId: 'e2e-item', attachments: [] } });
			return;
		}
		await route.fulfill({ status: 404, json: { detail: `Unhandled ${path}` } });
	});
}

test('Bulk Sweep persists Blob evidence and recovers after reload', async ({ page }) => {
	await mockBulkApi(page);
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'shelf.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('fake-image'),
	});
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.reload();
	await expect(page.getByText('Photos (1)')).toBeVisible();
	await page.getByRole('button', { name: /discard this sweep/i }).click();
	await expect(page.getByText('Photos (1)')).toHaveCount(0);
	const stores = await page.evaluate(async () => {
		const request = indexedDB.open('hbc-bulk-missions');
		return await new Promise<string[]>((resolve) => {
			request.onsuccess = () => resolve(Array.from(request.result.objectStoreNames));
		});
	});
	expect(stores).toEqual(
		expect.arrayContaining([
			'missions',
			'photos',
			'audio',
			'spans',
			'chunks',
			'candidates',
			'outbox',
			'meta',
		])
	);
	const missionCount = await page.evaluate(async () => {
		const request = indexedDB.open('hbc-bulk-missions');
		return await new Promise<number>((resolve) => {
			request.onsuccess = () => {
				const all = request.result
					.transaction('missions', 'readonly')
					.objectStore('missions')
					.getAll();
				all.onsuccess = () => resolve(all.result.length);
			};
		});
	});
	expect(missionCount).toBe(0);
});
test('Bulk Sweep falls back when camera permission is denied', async ({ page }) => {
	await mockBulkApi(page);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', {
			value: {
				getUserMedia: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
			},
		});
	});
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await page.getByRole('button', { name: /start camera/i }).click();
	await expect(page.getByText(/camera permission denied/i)).toBeVisible();
	await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

test('Bulk Sweep keeps narration usable without browser speech recognition', async ({ page }) => {
	await mockBulkApi(page);
	await page.addInitScript(() => {
		delete (window as any).SpeechRecognition;
		delete (window as any).webkitSpeechRecognition;
		Object.defineProperty(navigator, 'mediaDevices', {
			value: { getUserMedia: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
		});
	});
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await page.getByRole('button', { name: /narrate/i }).click();
	await expect(page.getByText('Microphone unavailable. You can type notes instead.', { exact: true })).toBeVisible();
	await expect(page.getByText('type notes', { exact: true })).toBeVisible();
});

test('Bulk Sweep resumes completed observation chunks without resending them', async ({ page }) => {
	await mockBulkApi(page);
	let calls = 0;
	await page.route('**/api/tools/vision/bulk-detect', async (route) => {
		calls += 1;
		if (calls === 2) {
			await route.fulfill({ status: 502, json: { detail: 'temporary provider failure' } });
			return;
		}
		await route.fulfill({
			json: {
				candidates: [],
				warnings: [],
				stats: { photo_count: 8, ignored_photo_count: 0, candidate_count: 0, low_confidence_count: 0 },
			},
		});
	});
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await page.locator('input[type="file"]').setInputFiles(
		Array.from({ length: 10 }, (_, index) => ({ name: `photo-${index}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(`photo-${index}`) }))
	);
	await page.getByRole('button', { name: /review transcript/i }).click();
	await page.getByRole('button', { name: /analyze with this transcript/i }).click();
	await expect(page).toHaveURL(/bulk-capture/);
	await expect.poll(() => calls).toBe(2);
	await page.reload();
	await page.getByRole('button', { name: /analyze with this transcript/i }).click();
	await expect(page).toHaveURL(/bulk-capture/);
	await expect.poll(() => calls).toBe(3);
});

test('Bulk review filters, edits, adds manual candidates, and reloads durably', async ({ page }) => {
	await mockBulkApi(page);
	await page.route('**/api/tools/vision/bulk-detect', async (route) => {
		await route.fulfill({ json: {
			candidates: [{ id: 'c-router', name: 'Router', quantity: 1, description: 'Network router', tag_ids: [], manufacturer: null, model_number: null, serial_number: null, purchase_price: null, purchase_from: null, notes: null, custom_fields: {}, confidence: 0, status: 'needs_review', evidence: [{ photoId: 'photo-1', reason: 'Observed' }], sourcePhotoIds: ['photo-1'], uncertaintyReasons: ['needs review'], duplicateCandidateIds: [], duplicateExistingItemId: null, suggestedAction: 'review' }],
			warnings: [], stats: { photo_count: 6, ignored_photo_count: 0, candidate_count: 1, low_confidence_count: 0 },
		} });
	});
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await page.locator('input[type="file"]').setInputFiles(
		Array.from({ length: 6 }, (_, index) => ({ name: `photo-${index + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(`photo-${index + 1}`) }))
	);
	await page.getByRole('button', { name: /review transcript/i }).click();
	await page.getByRole('button', { name: /analyze with this transcript/i }).click();
	await expect(page.getByRole('heading', { name: 'Router' })).toBeVisible();
	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByRole('textbox').nth(1).fill('Living router');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.getByRole('tab', { name: 'attention (1)' }).click();
	await expect(page.getByRole('heading', { name: 'Living router' })).toBeVisible();
	await page.getByPlaceholder('Add missing item').fill('Manual lamp');
	await page.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(page.getByText('Manual lamp')).toBeVisible();
	await page.waitForTimeout(3000);
	const persistedCandidateNames = await page.evaluate(async () => {
		const request = indexedDB.open('hbc-bulk-missions');
		return await new Promise<string[]>((resolve) => {
			request.onsuccess = () => {
				const get = request.result.transaction('candidates', 'readonly').objectStore('candidates').getAll();
				get.onsuccess = () => resolve(get.result.map((candidate) => candidate.name));
			};
		});
	});
	expect(persistedCandidateNames).toEqual(expect.arrayContaining(['Living router', 'Manual lamp']));
	await page.reload();
	await expect(page.getByText('Living router')).toBeVisible();
	await expect(page.getByText('Manual lamp')).toBeVisible();
});

test('Bulk Sweep keeps a 30-photo mission responsive and durable', async ({ page }) => {
	await mockBulkApi(page);
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Living');
	await page.getByRole('button', { name: /Living room/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /bulk sweep/i }).click();
	await page.locator('input[type="file"]').setInputFiles(
		Array.from({ length: 30 }, (_, index) => ({
			name: `large-${index}.jpg`,
			mimeType: 'image/jpeg',
			buffer: Buffer.from(`large-photo-${index}`),
		}))
	);
	await expect(page.getByText('Photos (30)')).toBeVisible();
	await page.reload();
	await expect(page.getByText('Photos (30)')).toBeVisible();
});
