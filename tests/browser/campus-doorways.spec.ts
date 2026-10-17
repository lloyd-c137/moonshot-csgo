import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterAtSpawn, hold, loadSimulated, position } from './support';

type Doorway = { room: string; center: [number, number]; yaw: number; width: number; depth: number };

test('every authored doorway is walkable in both directions', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterAtSpawn(page);
    // This route checks authored apertures; don't let the unrelated teacher AI detain the walker mid-route.
    await page.evaluate(() => window.__MOONSHOT__!.match.setTeacherGrace(120_000));
    const doorways = await page.evaluate(
        async () => (await (await fetch('/assets/campus/derived/world.json')).json()).doorways as Doorway[]
    );
    expect(doorways.length).toBe(14);
    const failures: string[] = [];
    for (const doorway of doorways) {
        const n = [-Math.sin(doorway.yaw), Math.cos(doorway.yaw)];
        const offset = doorway.depth / 2 + 0.9;
        for (const side of [1, -1]) {
            const start = [doorway.center[0] + side * n[0] * offset, doorway.center[1] + side * n[1] * offset];
            const dx = -side * n[0];
            const dz = -side * n[1];
            // Face exactly along the crossing (forward = -Z rotated by yaw) and walk forward.
            const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
            await page.evaluate(
                ([x, z, look]) => {
                    window.__MOONSHOT__!.teleport(x, 0.92, z);
                    window.__MOONSHOT__!.setLook(0, look);
                },
                [start[0], start[1], yaw]
            );
            await advance(page, 400);
            await hold(page, ['w'], 1_800);
            const [x, , z] = await position(page);
            const past = (x - doorway.center[0]) * dx + (z - doorway.center[1]) * dz;
            if (past < doorway.depth / 2 + 0.5) failures.push(`${doorway.room} side ${side}: ${past.toFixed(2)} m`);
        }
    }
    expect(failures).toEqual([]);
    expect(errors).toEqual([]);
});
