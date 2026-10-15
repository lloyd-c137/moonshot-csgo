import { expect, test } from '@playwright/test';

import { collectErrors, enterCampus, loadSimulated, position, waitForRoom, walk, walkTo } from './support';

// Waypoints (X, Z metres) from the offline navigation grid with a 0.30 m clearance radius.
const DOOR_APPROACH_TO_S308: [number, number][] = [
    [20.38, -13.22],
    [19.23, -14.38],
    [18.83, -14.38],
    [18.43, -13.97],
    [17.93, -12.07]
];
const S308_TO_S309: [number, number][] = [
    [18.43, -14.02],
    [18.98, -14.57],
    [18.78, -17.47],
    [15.58, -20.67],
    [15.08, -20.67],
    [14.53, -20.22],
    [14.43, -20.13],
    [13.63, -19.07]
];

test('walk from the east entry through the corridor into S308 and S309', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterCampus(page);

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
    await expect(page.locator('#current-location')).toContainText('S308');

    for (const waypoint of S308_TO_S309) expect(await walkTo(page, waypoint)).toBeLessThanOrEqual(0.3);
    expect(await waitForRoom(page, 'S309'), `at ${await position(page)}`).toBe(true);
    await expect(page.locator('#current-location')).toContainText('S309');
    expect(errors).toEqual([]);
});
