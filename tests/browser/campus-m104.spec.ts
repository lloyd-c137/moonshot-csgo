import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterAtSpawn, hold, loadSimulated, position, waitForRoom, walkTo } from './support';

// GAMEPLAY_AUTHORED M104 interior: both north doors lead in, each half of the room is walkable, and the authored
// furniture (desks, sofas, TV stand) blocks the player.
test('M104 is entered through either door and its furniture collides', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterAtSpawn(page);

    for (const [doorX, inside] of [
        [-47.33, [-49.7, 42.9]],
        [-45.33, [-43.2, 42.5]]
    ] as const) {
        await page.evaluate((x) => {
            window.__MOONSHOT__!.teleport(x, 0.92, 39.6);
            window.__MOONSHOT__!.setLook(0, 180);
        }, doorX);
        await advance(page, 400);
        // Facing south (yaw 180): hold forward through the door, then steer with the camera reset to north.
        await hold(page, ['w'], 1_000);
        const [, , z] = await position(page);
        expect(z, `through the door at x ${doorX}`).toBeGreaterThan(41.6);
        await page.evaluate(() => window.__MOONSHOT__!.setLook(0, 0));
        await advance(page, 200);
        expect(await walkTo(page, [...inside]), `into ${inside.join(', ')}`).toBeLessThanOrEqual(0.3);
        expect(await waitForRoom(page, 'M104')).toBe(true);
    }

    // Walking west into the olive sofas (lounge end) stops in front of them.
    await page.evaluate(() => {
        window.__MOONSHOT__!.teleport(-49.9, 0.92, 43.3);
        window.__MOONSHOT__!.setLook(0, 90);
    });
    await advance(page, 400);
    await walkTo(page, [-51.9, 43.3], 0.2, 2_500);
    const [x] = await position(page);
    expect(x, 'stopped by the sofa').toBeGreaterThan(-50.5);
    expect(errors).toEqual([]);
});
