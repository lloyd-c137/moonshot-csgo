import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

const serverPort = Number(process.env.MOONSHOT_TEST_SERVER_PORT ?? 8787);
const appPort = Number(process.env.MOONSHOT_TEST_VITE_PORT ?? 5174);
for (const [name, port] of [['MOONSHOT_TEST_SERVER_PORT', serverPort], ['MOONSHOT_TEST_VITE_PORT', appPort]] as const)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid ${name}`);
process.env.MOONSHOT_TEST_ROOM_PORT = String(serverPort);
// Give every browser run a fresh local Durable Object store.
const testRoomState = mkdtempSync(join(tmpdir(), 'moonshot-playwright-'));
process.once('exit', () => rmSync(testRoomState, { recursive: true, force: true }));

export default defineConfig({
    testDir: './tests/browser',
    // These full-scene tests share a virtual clock and contend for software WebGL; serialize for repeatable routes.
    workers: 1,
    // The production smoke test runs against the production preview (playwright.production.config.ts).
    testIgnore: 'production-smoke.spec.ts',
    timeout: 120_000,
    expect: { timeout: 20_000 },
    use: {
        baseURL: `http://127.0.0.1:${appPort}`,
        browserName: 'chromium',
        headless: true,
        launchOptions: process.env.CI ? undefined : { channel: 'chrome' }
    },
    webServer: [
        {
            command: `npm run dev -- --host 127.0.0.1 --port ${appPort} --strictPort`,
            url: `http://127.0.0.1:${appPort}`,
            reuseExistingServer: false,
            timeout: 30_000
        },
        {
            // Local shared-world room (Cloudflare workerd via wrangler) for the multiplayer spec.
            command: `npx wrangler dev --config server/wrangler.toml --port ${serverPort} --persist-to "${testRoomState}" --var ALLOWED_ORIGINS:localhost,127.0.0.1 --var START_AMMO:9 --var COMBAT_TEST:1`,
            url: `http://127.0.0.1:${serverPort}/health`,
            reuseExistingServer: false,
            timeout: 90_000
        }
    ],
    reporter: 'line'
});
