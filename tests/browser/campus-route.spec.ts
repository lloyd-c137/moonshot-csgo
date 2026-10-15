import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const walk = async (page: Page, key: string, milliseconds: number) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(milliseconds);
    await page.keyboard.up(key);
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

    await walk(page, 'a', 10_000);
    const wallStop = await page.evaluate(() => window.__MOONSHOT__!.position());
    expect(wallStop[0]).toBeGreaterThan(20.8);
    expect(wallStop[0]).toBeLessThan(21.8);

    await walk(page, 'w', 2_500);
    const doorwayApproach = await page.evaluate(() => window.__MOONSHOT__!.position());
    expect(doorwayApproach[0]).toBeGreaterThan(20.8);
    expect(doorwayApproach[2]).toBeLessThan(-10.2);

    await page.keyboard.down('a');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.roomId()), { timeout: 12_000 }).toBe('S308');
    await page.keyboard.up('a');
    await expect(page.locator('#current-location')).toContainText('S308');

    await walk(page, 'd', 3_000);
    await walk(page, 'w', 4_000);
    await walk(page, 'a', 4_000);
    await page.keyboard.down('a');
    await page.keyboard.down('s');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.roomId()), { timeout: 10_000 }).toBe('S309');
    await page.keyboard.up('a');
    await page.keyboard.up('s');
    await expect(page.locator('#current-location')).toContainText('S309');
    expect(runtimeErrors).toEqual([]);
});
