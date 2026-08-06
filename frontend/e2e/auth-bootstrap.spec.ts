import { expect, test } from '@playwright/test';
import { establishAuthenticatedOrigin, installBulkApiMocks } from './support/phase1Persistence';

test('preloaded localStorage authenticates direct protected-route bootstrap', async ({ page }) => {
	const telemetry = await installBulkApiMocks(page);
	const auth = await establishAuthenticatedOrigin(page);
	await page.goto('/location', { waitUntil: 'domcontentloaded' });
	await expect(page).toHaveURL(/\/location$/);
	await expect(page).toHaveTitle('Select Location - Homebox Companion');
	await expect(page.getByPlaceholder('Search all locations...')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('hbc_token'))).toBe(auth.token);
	expect(telemetry.requests.find((request) => request.path === '/groups')?.authorization).toBe(
		`Bearer ${auth.token}`
	);
	expect(
		telemetry.requests.find((request) => request.path === '/locations/tree')?.authorization
	).toBe(`Bearer ${auth.token}`);
	expect(telemetry.requests.filter((request) => request.path === '/refresh')).toHaveLength(0);
});

test('missing storage redirects a direct protected-route visit to login', async ({ page }) => {
	await installBulkApiMocks(page);
	await page.goto('/robots.txt');
	await page.evaluate(() => {
		localStorage.clear();
		sessionStorage.clear();
	});
	await page.goto('/location');
	await expect(page).toHaveURL(/\/$/);
	await expect(page).toHaveTitle('Login - Homebox Companion');
	await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
