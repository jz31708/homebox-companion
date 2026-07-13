import { expect, test } from '@playwright/test';

const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function mockMedicineApi(page: import('@playwright/test').Page) {
	await page.addInitScript((expiry) => {
		window.localStorage.setItem('hbc_token', 'e2e-token');
		window.localStorage.setItem('hbc_token_expires', expiry);
	}, expiresAt);
	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace('/api', '');
		if (path === '/config') {
			await route.fulfill({
				json: {
					is_demo_mode: false,
					demo_mode_explicit: false,
					homebox_url: 'http://homebox.test',
					llm_model: 'test-model',
					update_check_enabled: false,
					image_quality: 'medium',
					log_level: 'INFO',
					capture_max_images: 12,
					capture_max_file_size_mb: 10,
					print_enabled: false,
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
				json: [
					{
						id: 'med-box-1',
						name: 'Medicine cabinet',
						description: '',
						itemCount: 0,
						children: [],
					},
				],
			});
			return;
		}
		if (path === '/tags') {
			await route.fulfill({ json: [] });
			return;
		}
		if (path === '/medicines/lookup') {
			await route.fulfill({
				json: {
					lookupSource: 'bdpm-local',
					warnings: [],
					reference: {
						cip13: '3400941999031',
						cis: '61223605',
						name: 'DESLORATADINE BIOGARAN 5 mg, comprime pellicule',
						pharmaceutical_form: 'comprime pellicule',
						presentation: 'Box',
						active_substances: ['DESLORATADINE'],
						official_page_url:
							'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait',
						notice_url: 'https://base-donnees-publique.mouv.fr/medicament/61223605/extrait',
						rcp_url: null,
						source_name: 'Base de Données Publique des Médicaments',
					},
				},
			});
			return;
		}
		if (path === '/medicines' && route.request().method() === 'POST') {
			await route.fulfill({
				json: {
					itemId: 'created-med-1',
					created: true,
					photoUploaded: false,
					noticeAttached: false,
					warnings: [],
				},
			});
			return;
		}
		if (path === '/medicines' && route.request().method() === 'GET') {
			await route.fulfill({
				json: {
					items: [
						{
							homebox_item_id: 'created-med-1',
							name: 'Expired medicine',
							active_substances: ['EXAMPLE'],
							short_purpose: null,
							expiry_date: '2020-01',
							expiry_state: 'expired',
							days_until_expiry: -1,
							location_id: 'med-box-1',
							location_path: null,
							cip13: '3400941999031',
							cis: '61223605',
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
		if (path === '/medicines/created-med-1') {
			await route.fulfill({
				json: {
					homebox_item_id: 'created-med-1',
					name: 'Expired medicine',
					active_substances: ['EXAMPLE'],
					short_purpose: null,
					expiry_date: '2020-01',
					expiry_state: 'expired',
					days_until_expiry: -1,
					location_id: 'med-box-1',
					location_path: null,
					cip13: '3400941999031',
					cis: '61223605',
					package_photo_url: null,
					official_notice_url: 'https://example.test/notice',
					notice_attachment_url: null,
					remaining_level: 'unknown',
				},
			});
			return;
		}
		await route.fulfill({
			status: 404,
			json: { detail: `Unhandled ${route.request().method()} ${path}` },
		});
	});
}

test('medicine capture saves an expired box and keeps the location for the next scan', async ({
	page,
}) => {
	await mockMedicineApi(page);
	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('Medicine');
	await page.getByRole('button', { name: /Medicine cabinet/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /medicine intake/i }).click();
	await page.getByLabel('Expiry, if visible').fill('2020-01');
	await page.getByRole('button', { name: /type code/i }).click();
	await page.getByPlaceholder('Correct barcode or CIP13').fill('3400941999031');
	await page.getByRole('button', { name: /add to inbox/i }).click();
	await page.getByRole('button', { name: /review medicine candidate/i }).click();
	await expect(page.getByRole('heading', { name: 'Review medicine' })).toBeVisible();
	await page.getByRole('button', { name: /save medicine/i }).click();
	await expect(page).toHaveURL(/\/medicine-capture$/);
	await expect(page.getByText('Medicine cabinet')).toBeVisible();
});
