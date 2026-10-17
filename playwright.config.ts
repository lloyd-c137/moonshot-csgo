import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    // These full-scene tests share a virtual clock and contend for software WebGL; serialize for repeatable routes.
    workers: 1,
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
    webServer: [
        {
            command: 'npm run dev -- --host 127.0.0.1 --port 5174',
            url: 'http://127.0.0.1:5174',
            reuseExistingServer: !process.env.CI,
            timeout: 30_000
        },
        {
            // Local shared-world room (Cloudflare workerd via wrangler) for the multiplayer spec.
            command: 'npm run server:dev',
            url: 'http://127.0.0.1:8787/health',
            reuseExistingServer: !process.env.CI,
            timeout: 90_000
        }
    ],
    reporter: 'line'
});
