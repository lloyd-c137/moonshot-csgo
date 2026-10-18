import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { enterHome } from './support';

const SERVER = 'ws://127.0.0.1:8787/ws';

const open = async (browser: Browser) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`/?server=${encodeURIComponent(SERVER)}`);
    await enterHome(page);
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    return page;
};

const enterAs = async (page: Page, name: string) => {
    await page.locator('#auth-name').fill(name);
    await page.locator('#auth-password').fill('avatar-test-789');
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect(page.locator('#operator')).toHaveAttribute('data-mode', 'signed');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net)).toBe('online');
};

test('pause menu uploads a persistent avatar and other clients apply it to the rigged head', async ({ browser }) => {
    const suffix = Date.now().toString(36).slice(-8);
    const a = await open(browser);
    const b = await open(browser);
    try {
        await Promise.all([enterAs(a, `AvatarA${suffix}`), enterAs(b, `AvatarB${suffix}`)]);
        const idA = await a.evaluate(
            () => window.__MOONSHOT__!.match.state().players.find((player) => player.name.startsWith('AvatarA'))!.id
        );
        await expect
            .poll(() =>
                b.evaluate((id) => window.__MOONSHOT__!.match.state().players.some((player) => player.id === id), idA)
            )
            .toBe(true);

        await a.keyboard.press('Escape');
        await expect(a.locator('#app-ui')).toHaveAttribute('data-screen', 'paused');
        await expect(a.locator('#avatar-settings')).toBeVisible();
        await expect(a.getByRole('button', { name: '上传头像' })).toBeVisible();

        // A small valid PNG is normalized to the full-head WebP atlas in the browser before upload.
        const png = await a.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#e54b4b';
            context.fillRect(0, 0, 32, 64);
            context.fillStyle = '#315ad9';
            context.fillRect(32, 0, 32, 64);
            const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                    (value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))),
                    'image/png'
                )
            );
            return [...new Uint8Array(await blob.arrayBuffer())];
        });
        await a.locator('#avatar-file').setInputFiles({
            name: 'avatar.png',
            mimeType: 'image/png',
            buffer: Buffer.from(png)
        });
        await expect(a.locator('#avatar-status')).toContainText('已保存', { timeout: 30_000 });
        await expect
            .poll(() => b.evaluate((id) => window.__MOONSHOT__!.match.avatarHeadTextured(id), idA), { timeout: 20_000 })
            .toBe(true);

        const avatarUrl = await a.locator('#avatar-preview').getAttribute('src');
        expect(avatarUrl).toContain('/api/avatars/');
        const imageResponse = await a.evaluate(async (src) => {
            const response = await fetch(src!);
            return {
                status: response.status,
                type: response.headers.get('content-type'),
                bytes: (await response.arrayBuffer()).byteLength
            };
        }, avatarUrl);
        expect(imageResponse).toMatchObject({ status: 200, type: 'image/webp' });
        expect(imageResponse.bytes).toBeGreaterThan(100);
    } finally {
        await Promise.all([a.context().close(), b.context().close()]);
    }
});

test('audio test mode applies a local avatar to the fixed dummy without an account', async ({ page }) => {
    await page.goto('/?offline=1&audioLab=1');
    await enterHome(page);
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy)).not.toBeNull();
    await page.keyboard.press('Escape');
    await expect(page.locator('#avatar-settings')).toBeVisible();

    const png = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#e54b4b';
        context.fillRect(0, 0, 32, 64);
        context.fillStyle = '#315ad9';
        context.fillRect(32, 0, 32, 64);
        const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('PNG encoding failed'))), 'image/png')
        );
        return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.locator('#avatar-file').setInputFiles({
        name: 'dummy.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png)
    });
    await expect(page.locator('#avatar-status')).toContainText('仅保存在当前测试页面', { timeout: 30_000 });
    await expect
        .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.avatarHeadTextured('audio-lab-target')))
        .toBe(true);
});
