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
    await expect(page).toHaveTitle('Moonshot Open World · FF-01');
    await expect(page.locator('#load-status')).toHaveText('校园与碰撞已准备', { timeout: 60_000 });
    expect(assets['/assets/campus/MAC_Campus_FF01.glb']).toBe(200);
    expect(assets['/assets/campus/rooms.json']).toBe(200);
    expect(assets['/ammo/ammo.wasm.wasm']).toBe(200);

    await page.getByRole('button', { name: 'Enter Campus' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'playing');
    await page.keyboard.press('Escape');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'paused');
    expect(runtimeErrors).toEqual([]);
});
