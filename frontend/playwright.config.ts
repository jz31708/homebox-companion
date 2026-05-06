import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	timeout: 30_000,
	expect: {
		timeout: 8_000,
	},
	fullyParallel: true,
	reporter: [['list'], ['html', { open: 'never' }]],
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
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
