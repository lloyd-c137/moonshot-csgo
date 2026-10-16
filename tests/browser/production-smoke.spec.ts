import { expect, test } from '@playwright/test';

test('production preview loads FF-01, physics and pointer-lock entry flow', async ({ page }) => {
    const runtimeErrors: string[] = [];
    const assets: Record<string, number> = {};
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('response', (response) => {
        if (response.url().includes('/assets/campus/') || response.url().includes('/ammo/')) {
            assets[new URL(response.url()).pathname] = response.status();
        }
    });

    await page.goto('/');
    await expect(page).toHaveTitle('Moonshot Frisbee Games');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await expect(page.locator('.stages li[data-state="done"]')).toHaveCount(4);
    expect(assets['/assets/campus/MAC_Campus_FF01.glb']).toBe(200);
    expect(assets['/assets/campus/rooms.json']).toBe(200);
    expect(assets['/ammo/ammo.wasm.wasm']).toBe(200);
    for (const name of ['world.json', 'ceiling-mask.png', 'minimap.png']) {
        expect(assets[`/assets/campus/derived/${name}`]).toBe(200);
    }

    await page.getByRole('button', { name: '进入校园' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'paused');
    expect(runtimeErrors).toEqual([]);
});
