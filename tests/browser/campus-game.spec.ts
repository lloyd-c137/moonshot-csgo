import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterCampus, hold, loadSimulated, position } from './support';

const horizontal = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('enter the real FF-01 scene, move, sprint, look, jump, pause, resume and recover', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    const initial = await page.evaluate(() => ({
        position: window.__MOONSHOT__!.position(),
        colliders: window.__MOONSHOT__!.collisionCount,
        barriers: window.__MOONSHOT__!.barrierWalls
    }));
    expect(initial.colliders).toBe(13);
    expect(initial.barriers).toBeGreaterThan(1000);
    expect(initial.position[0]).toBeCloseTo(50.85, 1);
    expect(initial.position[1]).toBeGreaterThan(0.75);
    expect(initial.position[1]).toBeLessThan(1.05);
    expect(initial.position[2]).toBeCloseTo(-2.86, 1);

    await enterCampus(page);
    await advance(page, 500);
    await expect(page.locator('#current-location')).toHaveText('东入口门厅 · ENTRANCE-EAST');

    const start = await position(page);
    await hold(page, ['w'], 500);
    const walked = await position(page);
    const walkDistance = horizontal(walked, start);
    expect(walkDistance).toBeGreaterThan(0.8);
    await advance(page, 350);
    expect(horizontal(await position(page), walked)).toBeLessThan(1);

    const sprintStart = await position(page);
    await hold(page, ['Shift', 'w'], 500);
    expect(horizontal(await position(page), sprintStart)).toBeGreaterThan(walkDistance * 1.25);

    const lookBefore = await page.evaluate(() => window.__MOONSHOT__!.cameraAngles());
    await page.locator('#application-canvas').dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        movementX: 120,
        movementY: 0
    });
    await advance(page, 100);
    const lookAfter = await page.evaluate(() => window.__MOONSHOT__!.cameraAngles());
    expect(Math.abs(lookAfter[1] - lookBefore[1])).toBeGreaterThan(1);

    await advance(page, 500);
    const floorY = (await position(page))[1];
    await hold(page, ['Space'], 220);
    expect((await position(page))[1] - floorY).toBeGreaterThan(0.2);
    await advance(page, 1_500);
    const landedY = (await position(page))[1];
    expect(landedY).toBeGreaterThan(0.72);
    expect(landedY).toBeLessThan(1.1);

    await page.keyboard.press('Escape');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'paused');
    await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
    await enterCampus(page);

    await page.keyboard.press('r');
    await advance(page, 100);
    expect(horizontal(await position(page), initial.position)).toBeLessThan(0.2);
    expect(errors).toEqual([]);
});

test('open entrances and the top seat row do not lead out of the level; a fall is recovered', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterCampus(page);

    // The east entrance has no source wall: the slab ends at x≈67.5. The authored barrier stops the capsule there.
    await hold(page, ['d'], 15_000);
    const atEntrance = await position(page);
    expect(atEntrance[0]).toBeGreaterThan(65);
    expect(atEntrance[0]).toBeLessThan(67.5);
    expect(atEntrance[1]).toBeGreaterThan(0.75);

    // Top seat row (3.11 m) is higher than the 2.8 m wall 0.32 m behind it; pushing west must not cross the wall.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(-30.7, 4.3, -0.4));
    await advance(page, 500);
    const onSeat = await position(page);
    expect(onSeat[1]).toBeGreaterThan(3.8);
    await hold(page, ['a'], 4_000);
    expect((await position(page))[0]).toBeGreaterThan(-31.2);

    // Anything that still leaves the level is returned to the safe spawn automatically.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(80, 1, 0));
    await advance(page, 2_000);
    expect(await page.evaluate(() => window.__MOONSHOT__!.recoveries())).toBe(1);
    expect(horizontal(await position(page), [50.85, 0, -2.86])).toBeLessThan(0.2);
    await expect(page.locator('#game-toast')).toBeVisible();
    expect(errors).toEqual([]);
});
