import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterAtSpawn, enterCampus, hold, loadSimulated, position, walk } from './support';

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
    const dressing = await page.evaluate(() => window.__MOONSHOT__!.dressing);
    expect(dressing.doors).toBeGreaterThan(100);
    expect(dressing.lights).toBeGreaterThan(500);
    expect(initial.position[0]).toBeCloseTo(50.85, 1);
    expect(initial.position[1]).toBeGreaterThan(0.75);
    expect(initial.position[1]).toBeLessThan(1.05);
    expect(initial.position[2]).toBeCloseTo(-2.86, 1);

    await enterAtSpawn(page);
    await advance(page, 500);
    await expect(page.locator('#location-code')).toContainText('东入口门厅');
    await expect(page.locator('#location-name')).toHaveText('ENTRANCE-EAST');
    // The spawn lobby is the first discovery: plate tag, toast and tally all report it.
    expect(await page.evaluate(() => window.__MOONSHOT__!.discovered())).toEqual(['ENTRANCE-EAST']);
    await expect(page.locator('#location')).toHaveAttribute('data-new', 'true');
    await expect(page.locator('#toast')).toContainText('东入口门厅');
    await expect(page.locator('#tally')).toHaveText('已发现 1 / 166');

    await page.keyboard.press('m');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-map', 'open');
    await page.keyboard.press('m');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-map', 'closed');

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
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'paused');
    await expect(page.locator('#progress-label')).toHaveText('已发现 1 / 166 处地点');
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
    await enterAtSpawn(page);

    // The east entrance has no source wall: the slab ends at x≈67.5. The authored barrier stops the capsule there.
    await walk(page, 1, 0, 15_000);
    const atEntrance = await position(page);
    expect(atEntrance[0]).toBeGreaterThan(65);
    expect(atEntrance[0]).toBeLessThan(67.5);
    expect(atEntrance[1]).toBeGreaterThan(0.75);

    // Top seat row (3.11 m) is higher than the 2.8 m wall 0.32 m behind it; pushing west must not cross the wall.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(-30.7, 4.3, -0.4));
    await advance(page, 500);
    const onSeat = await position(page);
    expect(onSeat[1]).toBeGreaterThan(3.8);
    await walk(page, -1, 0, 4_000);
    expect((await position(page))[0]).toBeGreaterThan(-31.2);

    // The presented 3.6 m walls collide above the 2.8 m source height, and the arena perimeter wall stands to 10 m.
    const hits = await page.evaluate(() => ({
        wallLow: window.__MOONSHOT__!.raycast([22.5, 1.5, -3], [19.5, 1.5, -3]),
        wallHigh: window.__MOONSHOT__!.raycast([22.5, 3.3, -3], [19.5, 3.3, -3]),
        aboveWall: window.__MOONSHOT__!.raycast([22.5, 3.75, -3], [19.5, 3.75, -3]),
        arenaWall: window.__MOONSHOT__!.raycast([-8, 8, -3], [-45, 8, -3])
    }));
    expect(hits.wallLow).toBe('Walls');
    expect(hits.wallHigh).toBe('Walls');
    expect(hits.aboveWall).not.toBe('Walls');
    expect(hits.arenaWall).toBe('GameplayAuthored_ArenaWallCollider');

    // Anything that still leaves the level is returned to the safe spawn automatically.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(80, 1, 0));
    await advance(page, 2_000);
    expect(await page.evaluate(() => window.__MOONSHOT__!.recoveries())).toBe(1);
    expect(horizontal(await position(page), [50.85, 0, -2.86])).toBeLessThan(0.2);
    await expect(page.locator('#toast')).toContainText('已回到东入口');
    expect(errors).toEqual([]);
});
