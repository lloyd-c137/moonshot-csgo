import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Development-only debug hook installed by src/main.ts.
declare global {
    // Global augmentation requires interface merging.
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Window {
        __MOONSHOT__?: {
            position: () => number[];
            cameraAngles: () => number[];
            recover: () => void;
            collisionCount: number;
            barrierWalls: number;
            spawn: number[];
            roomId: () => string | null;
            teleport: (x: number, y: number, z: number) => void;
            recoveries: () => number;
            setRendering: (enabled: boolean) => void;
        };
    }
}

export const collectErrors = (page: Page) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
};

/**
 * Loads the campus and switches the page to simulated time: the game loop then advances only through
 * `advance()`, and frames are simulated without drawing. Movement assertions become independent of the test
 * machine's GPU speed (CI renders with software WebGL at about 1 FPS, where wall-clock waits simulate ~0.1 s per
 * second). Rendering itself is covered by the production smoke test.
 */
export const loadSimulated = async (page: Page) => {
    await page.goto('/');
    await expect(page.locator('#load-status')).toHaveText('校园与碰撞已准备', { timeout: 90_000 });
    await page.clock.install();
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
};

export const enterCampus = async (page: Page) => {
    await page.getByRole('button', { name: /Enter Campus|Resume/ }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#game-menu')).toHaveAttribute('data-mode', 'playing');
};

/** Advances simulated game time. */
export const advance = (page: Page, milliseconds: number) => page.clock.runFor(milliseconds);

export const position = (page: Page) => page.evaluate(() => window.__MOONSHOT__!.position());
export const roomId = (page: Page) => page.evaluate(() => window.__MOONSHOT__!.roomId());

/** Keys that move the player along a world X/Z direction given the current camera yaw. */
export const keysForDirection = async (page: Page, dx: number, dz: number) => {
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

/** Holds movement keys for a span of simulated time. */
export const hold = async (page: Page, keys: string[], milliseconds: number) => {
    for (const key of keys) await page.keyboard.down(key);
    await advance(page, milliseconds);
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
};

export const walk = async (page: Page, dx: number, dz: number, milliseconds: number) =>
    hold(page, await keysForDirection(page, dx, dz), milliseconds);

/** Walks along a direction until `done` holds, checking every 250 ms of simulated time. */
export const walkUntil = async (
    page: Page,
    dx: number,
    dz: number,
    done: () => Promise<boolean>,
    limitMilliseconds: number
) => {
    const keys = await keysForDirection(page, dx, dz);
    for (const key of keys) await page.keyboard.down(key);
    let elapsed = 0;
    let reached = await done();
    while (!reached && elapsed < limitMilliseconds) {
        await advance(page, 250);
        elapsed += 250;
        reached = await done();
    }
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
    return { reached, elapsed };
};

/**
 * Steers toward a world X/Z point, re-aiming every 150 ms of simulated time, until within `tolerance` metres.
 * Waypoints come from the offline navigation grid (`npm run audit:nav`), so the route follows real clearance.
 */
export const walkTo = async (page: Page, [x, z]: [number, number], tolerance = 0.3, limitMilliseconds = 8_000) => {
    let held: string[] = [];
    let elapsed = 0;
    let distance = Infinity;
    while (elapsed <= limitMilliseconds) {
        const [px, , pz] = await position(page);
        distance = Math.hypot(x - px, z - pz);
        if (distance <= tolerance) break;
        const keys = await keysForDirection(page, (x - px) / distance, (z - pz) / distance);
        for (const key of held.filter((key) => !keys.includes(key))) await page.keyboard.up(key);
        for (const key of keys.filter((key) => !held.includes(key))) await page.keyboard.down(key);
        held = keys;
        await advance(page, 150);
        elapsed += 150;
    }
    for (const key of held) await page.keyboard.up(key);
    await advance(page, 300);
    return distance;
};

/** Advances simulated time until the room tracker reports `id` (it samples every 0.15 s with a 0.2 s dwell). */
export const waitForRoom = async (page: Page, id: string, limitMilliseconds = 3_000) => {
    for (let elapsed = 0; elapsed <= limitMilliseconds; elapsed += 250) {
        if ((await roomId(page)) === id) return true;
        await advance(page, 250);
    }
    return false;
};
