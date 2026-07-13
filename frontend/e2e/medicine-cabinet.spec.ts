import { expect, test } from '@playwright/test';

test('medicine cabinet shows expiry filters and detail notice retry', async ({ page }) => {
	await page.addInitScript(() => window.localStorage.setItem('hbc_token', 'e2e-token'));
	await page.route('**/api/medicines*', async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				json: {
					items: [
						{
							homebox_item_id: 'item-1',
							name: 'Expired medicine',
							active_substances: ['EXAMPLE'],
							short_purpose: null,
							expiry_date: '2020-01',
							expiry_state: 'expired',
							days_until_expiry: -1,
							location_id: null,
							location_path: null,
							cip13: null,
							cis: '1',
							package_photo_url: null,
							official_notice_url: 'https://example.test/notice',
							notice_attachment_url: null,
							remaining_level: 'unknown',
						},
					],
					page: 1,
					pageSize: 50,
					total: 1,
				},
			});
			return;
		}
		await route.fulfill({ json: { ok: true, checksum: 'abc' } });
	});
	await page.route('**/api/medicines/item-1', async (route) => {
		await route.fulfill({
			json: {
				homebox_item_id: 'item-1',
				name: 'Expired medicine',
				active_substances: ['EXAMPLE'],
				short_purpose: null,
				expiry_date: '2020-01',
				expiry_state: 'expired',
				days_until_expiry: -1,
				location_id: null,
				location_path: null,
				cip13: null,
				cis: '1',
				package_photo_url: null,
				official_notice_url: 'https://example.test/notice',
				notice_attachment_url: null,
				remaining_level: 'unknown',
			},
		});
	});
	await page.goto('/medicines');
	await expect(page.getByRole('button', { name: /Expired \(1\)/ })).toBeVisible();
	await page.getByText('Expired medicine').click();
	await expect(page).toHaveURL(/\/medicines\/item-1$/);
	await expect(page.getByText('Retry notice snapshot')).toBeVisible();
});
