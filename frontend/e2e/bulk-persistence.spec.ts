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
});
