import { expect, test, type Page } from '@playwright/test';

const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function mockCompanionApi(page: Page) {
	let createdMedicinePayload: unknown = null;

	await page.addInitScript((expiry) => {
		window.localStorage.setItem('hbc_token', 'e2e-token');
		window.localStorage.setItem('hbc_token_expires', expiry);
		window.localStorage.setItem('hbc_user_email', 'e2e@example.com');
	}, expiresAt);

	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace('/api', '');
		const method = route.request().method();

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
				json: {
					version: 'e2e',
					latest_version: null,
					update_available: false,
				},
			});
			return;
		}

		if (path === '/locations' && method === 'GET') {
			await route.fulfill({
				json: [
					{
						id: 'med-box-1',
						name: 'medicament boite 1',
						description: '',
						itemCount: 0,
						children: [],
					},
				],
			});
			return;
		}

		if (path === '/locations/tree') {
			await route.fulfill({
				json: [
					{
						id: 'med-box-1',
						name: 'medicament boite 1',
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

		if (path === '/tools/vision/medicine-lookup' && method === 'POST') {
			await expect(route.request().postDataJSON()).toMatchObject({
				barcodeText: '3400941999031',
				expiryDate: '2027-08',
				openedDate: '2026-05-06',
			});
			await route.fulfill({
				json: {
					warnings: [],
					candidate: {
						id: 'med_3400941999031',
						name: 'DESLORATADINE BIOGARAN 5 mg, comprime pellicule',
						quantity: 1,
						description:
							'Medicine identified from a scanned package code. Review the fields before saving.',
						notes: null,
						activeIngredient: 'DESLORATADINE',
						strength: null,
						form: 'comprime pellicule',
						packageSize: null,
						expiryDate: '2027-08',
						openedDate: '2026-05-06',
						remainingDoses: null,
						remainingDoseLabel: 'unknown',
						storage: null,
						cip13: '3400941999031',
						cis: '61223605',
						generalUse:
							'Not medical advice; verify in the official notice: DESLORATADINE BIOGARAN soulage les symptomes associes a la rhinite allergique.',
						officialPageUrl:
							'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait',
						noticeUrl:
							'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait#tab-notice',
						rcpUrl:
							'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait#tab-rcp',
						confidence: 0.9,
						uncertaintyReasons: [
							'Scanned code was used without label photos; verify the medicine name before saving.',
						],
						databaseMatch: {
							source: 'api-medicaments-fr',
							query: '3400941999031',
							cis: '61223605',
							cip13: '3400941999031',
							denomination: 'DESLORATADINE BIOGARAN 5 mg, comprime pellicule',
							form: 'comprime pellicule',
							activeSubstances: ['DESLORATADINE'],
							generalUse:
								'Not medical advice; verify in the official notice: DESLORATADINE BIOGARAN soulage les symptomes associes a la rhinite allergique.',
							officialPageUrl:
								'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait',
							noticeUrl:
								'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait#tab-notice',
							rcpUrl:
								'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait#tab-rcp',
							confidence: 0.9,
							raw: {},
						},
						sourcePhotoIds: [],
						custom_fields: null,
					},
				},
			});
			return;
		}

		if (path === '/items' && method === 'POST') {
			createdMedicinePayload = route.request().postDataJSON();
			await route.fulfill({
				json: {
					created: [{ id: 'created-med-1', name: 'DESLORATADINE BIOGARAN 5 mg, comprime pellicule' }],
					errors: [],
					message: 'Created 1 item',
				},
			});
			return;
		}

		await route.fulfill({
			status: 404,
			json: { detail: `Unhandled e2e API route: ${method} ${path}` },
		});
	});

	return {
		getCreatedMedicinePayload: () => createdMedicinePayload,
	};
}

test('medicine barcode intake can submit and continue scanning at the same location', async ({
	page,
}) => {
	const api = await mockCompanionApi(page);

	await page.goto('/location');
	await page.getByPlaceholder('Search all locations...').fill('medicament');
	await page.getByRole('button', { name: /medicament boite 1/i }).click();
	await page.getByRole('button', { name: /continue to capture/i }).click();
	await page.getByRole('button', { name: /medicine intake/i }).click();

	await expect(page).toHaveURL(/\/medicine-capture$/);
	await expect(page.getByRole('heading', { name: 'Medicine Intake' })).toBeVisible();

	await page.getByLabel('Expiry').fill('2027-08');
	await page.getByLabel('Opened').fill('2026-05-06');
	await page.getByRole('button', { name: /type code/i }).click();
	await page.getByPlaceholder('Correct barcode or CIP13').fill('3400941999031');
	await page.getByRole('button', { name: /lookup code/i }).click();

	await expect(page).toHaveURL(/\/medicine-review$/);
	await expect(page.getByLabel('Name')).toHaveValue(/DESLORATADINE BIOGARAN/);
	await expect(page.getByLabel('General use')).toHaveValue(
		/Not medical advice; verify in the official notice/
	);
	await expect(page.getByLabel('Expiry')).toHaveValue('2027-08');
	await expect(page.getByLabel('Opened')).toHaveValue('2026-05-06');
	await expect(page.getByPlaceholder('Official medicine page URL')).toHaveValue(/61223605\/extrait/);
	await page.screenshot({ path: 'test-results/medicine-review.png', fullPage: true });

	await page.getByRole('button', { name: /submit medicine/i }).click();

	await expect(page).toHaveURL(/\/medicine-capture$/);
	await expect(page.getByRole('heading', { name: 'Medicine Intake' })).toBeVisible();
	await expect(page.getByText('medicament boite 1')).toBeVisible();
	await expect(page.getByText('Photos (0)')).toBeVisible();
	await expect(page.getByPlaceholder('Correct barcode or CIP13')).toHaveCount(0);

	const payload = api.getCreatedMedicinePayload() as {
		location_id?: string;
		items?: Array<{ custom_fields?: Record<string, string> }>;
	};
	expect(payload.location_id).toBe('med-box-1');
	expect(payload.items?.[0]).toMatchObject({
		name: 'DESLORATADINE BIOGARAN 5 mg, comprime pellicule',
		quantity: 1,
		description: 'Medicine identified from a scanned package code. Review the fields before saving.',
		notes: null,
	});
	expect(payload.items?.[0]?.custom_fields).toMatchObject({
		'Active ingredient': 'DESLORATADINE',
		'Medicine form': 'comprime pellicule',
		'Expiry date': '2027-08',
		'Opened date': '2026-05-06',
		'Remaining level': 'unknown',
		CIP13: '3400941999031',
		CIS: '61223605',
		'General use (verify notice)':
			'Not medical advice; verify in the official notice: DESLORATADINE BIOGARAN soulage les symptomes associes a la rhinite allergique.',
		'Official medicine page':
			'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait',
		'Official notice':
			'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait#tab-notice',
		'Official RCP':
			'https://base-donnees-publique.medicaments.gouv.fr/medicament/61223605/extrait#tab-rcp',
	});
});
