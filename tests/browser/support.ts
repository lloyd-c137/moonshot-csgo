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
            perf: () => { shadersLinked: number; compileMs: number; shaders: string[]; drawCallsPerFrame: number };
            sceneTransition: (relocate: () => void) => void;
            showRoundResult: (outcome: 'golden-disc' | 'last-survivor' | 'draw', mine: boolean) => void;
            raycast: (from: number[], to: number[]) => string | null;
            setLook: (pitch: number, yaw: number) => void;
            dressing: {
                doors: number;
                furniture: number;
                lights: number;
                mirrors: { roomId: string; position: number[]; yaw: number; normal: number[] }[];
            };
            match: {
                state: () => {
                    phase: 'lobby' | 'playing';
                    players: { id: string; name: string; phase?: 'lobby' | 'playing' }[];
                    abilities?: Record<string, boolean | number>;
                    items?: { id: string; available: boolean }[];
                    stealthUntil?: number;
                    roomNow?: number;
                    blackoutAt?: number | null;
                    round?:
                        | { phase: 'playing'; endsAt: number }
                        | { phase: 'ended'; winner: string | null; nextAt: number }
                        | null;
                    restroomMirror: {
                        activeRoom: string | null;
                        cameraEnabled: boolean;
                        reflectionEnabled: boolean;
                        headTextured: boolean;
                    };
                };
                avatarHeadTextured: (id: string) => boolean;
                ceremony: () => { t: number; entrants: number } | null;
                shuttersClosed: () => boolean;
                shutterProbes: () => { id: string; from: number[]; to: number[] }[];
                ceremonyMetrics: () => { entrantActors: number; spotlights: number; seatedSpectators: number };
                cutscene: () => { kind: string; skipped: boolean; camera: boolean } | null;
                setRoundRemaining: (seconds: number) => void;
            };
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
export const loadSimulated = async (page: Page, url = '/') => {
    // Install before navigation so every animation frame of the game loop is virtual. After install() the virtual
    // clock still follows real time; pauseAt() stops it, after which game time only moves through advance().
    await page.clock.install();
    await page.goto(url);
    await enterHome(page);
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    // Pause a little ahead of the page's virtual "now"; retry further ahead if real time overtook the target.
    for (let ahead = 1_000; ; ahead *= 4) {
        try {
            await page.clock.pauseAt((await page.evaluate(() => Date.now())) + ahead);
            break;
        } catch (error) {
            if (ahead > 60_000 || !String(error).includes('Cannot fast-forward to the past')) throw error;
        }
    }
};

export const enterHome = async (page: Page) => {
    const startButton = page.locator('#boot-continue');
    if (await startButton.count()) {
        await expect(startButton).toBeVisible({ timeout: 90_000 });
        await startButton.click();
        await expect(page.locator('#boot-loader')).toBeHidden();
    }
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
};

export const enterCampus = async (page: Page) => {
    await enterHome(page);
    await page.getByRole('button', { name: /进入校园|继续游戏/ }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
};

/**
 * Enters play and resets to the spawn pose. Clicking the entry button can itself emit pointer movement (observed in
 * the Chromium headless shell used by CI: yaw 18.7° after entry), so tests must not assume the initial heading.
 */
export const enterAtSpawn = async (page: Page) => {
    await enterCampus(page);
    // Pointer-lock entry can deliver a late movement delta in real time; let it arrive and be consumed first.
    for (let attempt = 0; attempt < 5; attempt++) {
        await page.waitForTimeout(250);
        await page.clock.runFor(100);
        await page.evaluate(() => window.__MOONSHOT__!.recover());
        await page.clock.runFor(200);
        const yaw = (await page.evaluate(() => window.__MOONSHOT__!.cameraAngles()))[1];
        if (Math.abs(yaw) < 0.01) return;
    }
    throw new Error('Could not reset the camera to the spawn heading');
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
