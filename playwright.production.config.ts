import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    testMatch: 'production-smoke.spec.ts',
    timeout: 120_000,
    // Rendering is on here: CI's software WebGL takes seconds per frame with the full scene and post-processing.
    expect: { timeout: 30_000 },
    use: {
        baseURL: 'http://127.0.0.1:4174',
        browserName: 'chromium',
        headless: true,
        launchOptions: process.env.CI ? undefined : { channel: 'chrome' }
    },
    webServer: {
        command: 'npm run start -- --host 127.0.0.1 --port 4174',
        url: 'http://127.0.0.1:4174',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000
    },
    reporter: 'line'
});
