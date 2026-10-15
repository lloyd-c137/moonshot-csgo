import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const keysForDirection = async (page: Page, dx: number, dz: number) => {
    const yaw = await page.evaluate(() => (window.__MOONSHOT__!.cameraAngles()[1] * Math.PI) / 180);
    const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const forward = -(dx * Math.sin(yaw) + dz * Math.cos(yaw));
    const keys: string[] = [];
    if (localX > 0.05) keys.push('d');
    if (localX < -0.05) keys.push('a');
    if (forward > 0.05) keys.push('w');
    if (forward < -0.05) keys.push('s');
    return keys;
};

const walk = async (page: Page, dx: number, dz: number, milliseconds: number) => {
    const keys = await keysForDirection(page, dx, dz);
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(milliseconds);
    for (const key of keys) await page.keyboard.up(key);
};

test('walk from the east entry through the corridor into S308 and S309', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
    });

    await page.goto('/');
    await expect(page.locator('#load-status')).toHaveText('校园与碰撞已准备', { timeout: 60_000 });
    await page.getByRole('button', { name: 'Enter Campus' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'playing');

    console.log(
        'entry facing and west inputs',
        await page.evaluate(() => window.__MOONSHOT__!.cameraAngles()),
        await keysForDirection(page, -1, 0)
    );
    await walk(page, -1, 0, 10_000);
    const wallStop = await page.evaluate(() => window.__MOONSHOT__!.position());
    console.log('after west walk', wallStop);
    expect(wallStop[0]).toBeGreaterThan(20.8);
    expect(wallStop[0]).toBeLessThan(21.8);

    await walk(page, 0, -1, 2_500);
    const doorwayApproach = await page.evaluate(() => window.__MOONSHOT__!.position());
    expect(doorwayApproach[0]).toBeGreaterThan(20.8);
    expect(doorwayApproach[2]).toBeLessThan(-10.2);

    const westKeys = await keysForDirection(page, -1, 0);
    for (const key of westKeys) await page.keyboard.down(key);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.roomId()), { timeout: 12_000 }).toBe('S308');
    for (const key of westKeys) await page.keyboard.up(key);
    await expect(page.locator('#current-location')).toContainText('S308');

    await walk(page, 1, 0, 3_000);
    await walk(page, 0, -1, 4_000);
    await walk(page, -1, 0, 4_000);
    const southwestKeys = await keysForDirection(page, -1, 1);
    for (const key of southwestKeys) await page.keyboard.down(key);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.roomId()), { timeout: 10_000 }).toBe('S309');
    for (const key of southwestKeys) await page.keyboard.up(key);
    await expect(page.locator('#current-location')).toContainText('S309');
    expect(runtimeErrors).toEqual([]);
});
