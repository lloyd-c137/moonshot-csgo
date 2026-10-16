import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterAtSpawn, loadSimulated, position, waitForRoom, walk, walkTo } from './support';

// Waypoints (X, Z metres) from the offline navigation grid (furniture included) with a 0.30 m clearance radius.
const DOOR_APPROACH_TO_S308: [number, number][] = [
    [20.38, -13.22],
    [19.23, -14.38],
    [18.83, -14.38],
    [18.43, -13.97],
    [16.98, -12.47]
];
const S308_TO_S309: [number, number][] = [
    [17.13, -12.72],
    [18.98, -14.57],
    [18.78, -17.47],
    [15.58, -20.67],
    [15.08, -20.67],
    [14.53, -20.22],
    [14.43, -20.13],
    [14.53, -18.47],
    [14.98, -18.02],
    [15.63, -16.88],
    [15.63, -16.38],
    [15.48, -16.22]
];

test('walk from the east entry through the corridor into S308 and S309', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterAtSpawn(page);
    // This route starts from the east entrance lobby (the spawn is now the south entrance).
    await page.evaluate(() => {
        window.__MOONSHOT__!.teleport(50.85, 0.92, -2.86);
        window.__MOONSHOT__!.setLook(0, 0);
    });
    await advance(page, 300);

    // West along the entry corridor until the source wall stops the capsule.
    await walk(page, -1, 0, 10_000);
    const wallStop = await position(page);
    expect(wallStop[0]).toBeGreaterThan(20.8);
    expect(wallStop[0]).toBeLessThan(21.8);

    await walk(page, 0, -1, 2_500);
    const doorwayApproach = await position(page);
    expect(doorwayApproach[0]).toBeGreaterThan(20.8);
    expect(doorwayApproach[2]).toBeLessThan(-10.2);

    for (const waypoint of DOOR_APPROACH_TO_S308) expect(await walkTo(page, waypoint)).toBeLessThanOrEqual(0.3);
    expect(await waitForRoom(page, 'S308'), `at ${await position(page)}`).toBe(true);
    await expect(page.locator('#location-code')).toContainText('S308');

    for (const waypoint of S308_TO_S309) expect(await walkTo(page, waypoint)).toBeLessThanOrEqual(0.3);
    expect(await waitForRoom(page, 'S309'), `at ${await position(page)}`).toBe(true);
    await expect(page.locator('#location-code')).toContainText('S309');
    const discovered = await page.evaluate(() => window.__MOONSHOT__!.discovered());
    for (const id of ['ENTRANCE-EAST', 'S308', 'S309']) expect(discovered).toContain(id);
    expect(errors).toEqual([]);
});
