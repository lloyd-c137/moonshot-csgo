import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    // The production smoke test runs against the production preview (playwright.production.config.ts).
    testIgnore: 'production-smoke.spec.ts',
    timeout: 120_000,
    expect: { timeout: 20_000 },
    use: {
        baseURL: 'http://127.0.0.1:5174',
        browserName: 'chromium',
        headless: true,
        launchOptions: process.env.CI ? undefined : { channel: 'chrome' }
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 5174',
        url: 'http://127.0.0.1:5174',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
    },
    reporter: 'line'
});
