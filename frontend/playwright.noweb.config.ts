import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	expect: {
		timeout: 8_000,
	},
	fullyParallel: false,
	reporter: [['list']],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'mobile-chromium',
			use: {
				...devices['Pixel 7'],
			},
		},
	],
});
