import { expect, test } from '@playwright/test';

test('enter the real FF-01 scene, move, jump, pause, resume and recover', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
    });

    await page.goto('/');
    await expect(page.locator('#load-status')).toHaveText('校园与碰撞已准备', { timeout: 60_000 });
    const initial = await page.evaluate(() => ({
        position: window.__MOONSHOT__!.position(),
        colliders: window.__MOONSHOT__!.collisionCount
    }));
    expect(initial.colliders).toBe(13);
    expect(initial.position[0]).toBeCloseTo(50.85, 1);
    expect(initial.position[1]).toBeGreaterThan(0.75);
    expect(initial.position[1]).toBeLessThan(1.05);
    expect(initial.position[2]).toBeCloseTo(-2.86, 1);

    await page.getByRole('button', { name: 'Enter Campus' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'playing');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'playing');

    const start = await page.evaluate(() => window.__MOONSHOT__!.position());
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    const walked = await page.evaluate(() => window.__MOONSHOT__!.position());
    const walkDistance = Math.hypot(walked[0] - start[0], walked[2] - start[2]);
    expect(walkDistance).toBeGreaterThan(0.8);

    const sprintStart = await page.evaluate(() => window.__MOONSHOT__!.position());
    await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
    const sprintEnd = await page.evaluate(() => window.__MOONSHOT__!.position());
    const sprintDistance = Math.hypot(sprintEnd[0] - sprintStart[0], sprintEnd[2] - sprintStart[2]);
    expect(sprintDistance).toBeGreaterThan(walkDistance * 1.2);

    const lookBefore = await page.evaluate(() => window.__MOONSHOT__!.cameraAngles());
    await page.locator('#application-canvas').dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        movementX: 120,
        movementY: 0
    });
    await page.waitForTimeout(100);
    const lookAfter = await page.evaluate(() => window.__MOONSHOT__!.cameraAngles());
    expect(Math.abs(lookAfter[1] - lookBefore[1])).toBeGreaterThan(1);

    const floorY = await page.evaluate(() => window.__MOONSHOT__!.position()[1]);
    await page.keyboard.down('Space');
    await page.waitForTimeout(220);
    await page.keyboard.up('Space');
    const jumpY = await page.evaluate(() => window.__MOONSHOT__!.position()[1]);
    expect(jumpY - floorY).toBeGreaterThan(0.2);
    await page.waitForTimeout(1_500);
    const landedY = await page.evaluate(() => window.__MOONSHOT__!.position()[1]);
    expect(landedY).toBeGreaterThan(0.72);
    expect(landedY).toBeLessThan(1.1);

    await page.keyboard.press('Escape');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'paused');
    await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');

    await page.keyboard.press('r');
    await expect
        .poll(async () => {
            const position = await page.evaluate(() => window.__MOONSHOT__!.position());
            return Math.hypot(position[0] - initial.position[0], position[2] - initial.position[2]);
        })
        .toBeLessThan(0.2);
    expect(runtimeErrors).toEqual([]);
});
