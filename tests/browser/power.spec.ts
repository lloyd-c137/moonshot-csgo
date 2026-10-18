import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { BREAKER_ROUTE } from '../../src/config/breakerRoute';
import { GUARD_ROUTE } from '../../src/config/guardRoute';
import { POWER_TRAVEL_MS, POWER_RESTORE_MS, POWER_RETURN_MS } from '../../src/gameplay/power';

import { advance, collectErrors, enterAtSpawn, enterHome, hold, loadSimulated, position } from './support';

test('walk through the source power-room entrance, pull once, see blackout and guard repair/return', async ({
    page
}) => {
    await page.addInitScript(() => {
        const target = window as Window & {
            __powerDownCueStarts?: number;
            __blackoutThemeStarts?: number;
            __blackoutThemeLoops?: boolean;
            __matchMusicDurations?: number[];
            __matchMusicSources?: AudioBufferSourceNode[];
            __blackoutThemeFades?: number[];
        };
        const originalStart = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when?: number, offset?: number, duration?: number) {
            if (this.buffer && Math.abs(this.buffer.duration - 1.1755) < 0.0001)
                target.__powerDownCueStarts = (target.__powerDownCueStarts ?? 0) + 1;
            if (this.buffer && this.buffer.duration > 204.5 && this.buffer.duration < 205.1) {
                target.__blackoutThemeStarts = (target.__blackoutThemeStarts ?? 0) + 1;
                target.__blackoutThemeLoops = this.loop;
            }
            if (this.buffer && this.buffer.duration > 200 && this.buffer.duration < 220) {
                (target.__matchMusicDurations ??= []).push(this.buffer.duration);
                (target.__matchMusicSources ??= []).push(this);
            }
            return originalStart.call(this, when, offset, duration);
        };
        const originalRamp = AudioParam.prototype.linearRampToValueAtTime;
        AudioParam.prototype.linearRampToValueAtTime = function (value: number, endTime: number) {
            if (
                value === 0 ||
                Math.abs(value - 0.18) < 0.0001 ||
                Math.abs(value - 0.2) < 0.0001 ||
                Math.abs(value - 0.22) < 0.0001
            )
                (target.__blackoutThemeFades ??= []).push(value);
            return originalRamp.call(this, value, endTime);
        };
    });
    const errors = collectErrors(page);
    let buzzerLoaded = false;
    let themeLoaded = false;
    let tickingAwayLoaded = false;
    let dieForYouLoaded = false;
    page.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (path === '/assets/audio/buzzer.mp3') buzzerLoaded = response.ok();
        if (path === '/assets/audio/blackout-theme.mp3') themeLoaded = response.ok();
        if (path === '/assets/audio/ticking-away.mp3') tickingAwayLoaded = response.ok();
        if (path === '/assets/audio/die-for-you.mp3') dieForYouLoaded = response.ok();
    });
    await loadSimulated(page);
    await enterAtSpawn(page);
    await expect.poll(() => tickingAwayLoaded).toBe(true);
    await expect.poll(() => dieForYouLoaded).toBe(true);
    await expect
        .poll(() => page.evaluate(() => (window as Window & { __matchMusicDurations?: number[] }).__matchMusicDurations))
        .toHaveLength(1);
    const firstTrack = await page.evaluate(() => {
        const target = window as Window & { __matchMusicSources?: AudioBufferSourceNode[] };
        const source = target.__matchMusicSources?.[0];
        if (!source?.onended) return false;
        source.onended.call(source, new Event('ended'));
        return true;
    });
    expect(firstTrack).toBe(true);
    await expect
        .poll(() => page.evaluate(() => (window as Window & { __matchMusicDurations?: number[] }).__matchMusicDurations))
        .toHaveLength(2);
    const playlistDurations = await page.evaluate(
        () => (window as Window & { __matchMusicDurations?: number[] }).__matchMusicDurations
    );
    expect(playlistDurations?.[0]).toBeGreaterThan(204);
    expect(playlistDurations?.[0]).toBeLessThan(207);
    expect(playlistDurations?.[1]).toBeGreaterThan(211);
    expect(playlistDurations?.[1]).toBeLessThan(215);
    await expect
        .poll(() => page.evaluate(() => (window as Window & { __blackoutThemeFades?: number[] }).__blackoutThemeFades))
        .toContain(0.18);
    await expect.poll(() => buzzerLoaded).toBe(true);
    // Probe the actual Ammo colliders along the full path, not only the offline raster.
    const obstructions = await page.evaluate((route) => {
        const bad: string[] = [];
        const debug = window.__MOONSHOT__!;
        for (let i = 1; i < route.length; i++) {
            const [a, b] = [route[i - 1], route[i]];
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const nx = (-(b[1] - a[1]) / length) * 0.28,
                nz = ((b[0] - a[0]) / length) * 0.28;
            for (const sign of [-1, 0, 1])
                for (const height of [0.35, 1.1, 1.7]) {
                    const hit = debug.raycast(
                        [a[0] + nx * sign, height, a[1] + nz * sign],
                        [b[0] + nx * sign, height, b[1] + nz * sign]
                    );
                    if (hit) bad.push(`leg ${i}: ${hit}`);
                }
        }
        return bad;
    }, BREAKER_ROUTE);
    expect(obstructions).toEqual([]);
    await page.evaluate(() => {
        window.__MOONSHOT__!.teleport(-55.2, 0.92, -12.5);
        window.__MOONSHOT__!.setLook(0, -90);
    });
    await advance(page, 300);
    await hold(page, ['w'], 700);
    const p = await position(page);
    expect(p[0]).toBeGreaterThan(-54.4);
    // Entered via real movement; then place precisely at the interaction point to avoid tuning-dependent overshoot.
    const destination = BREAKER_ROUTE[BREAKER_ROUTE.length - 1];
    await page.evaluate(([x, z]) => {
        window.__MOONSHOT__!.teleport(x, 0.92, z);
        window.__MOONSHOT__!.setLook(0, 0);
    }, destination);
    await advance(page, 150);
    await expect(page.locator('#interaction')).toContainText('E 拉闸');
    await page.keyboard.press('e');
    await advance(page, 100);
    const power = await page.evaluate(() => window.__MOONSHOT__!.match.state().power);
    expect(power.dark).toBe(true);
    expect(power.phase).toBe('outbound');
    await expect
        .poll(() => page.evaluate(() => (window as Window & { __blackoutThemeFades?: number[] }).__blackoutThemeFades))
        .toContain(0);
    await expect.poll(() => page.evaluate(() => (window as Window & { __powerDownCueStarts?: number }).__powerDownCueStarts)).toBe(1);
    await expect.poll(() => themeLoaded).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as Window & { __blackoutThemeStarts?: number }).__blackoutThemeStarts)).toBe(1);
    expect(await page.evaluate(() => (window as Window & { __blackoutThemeLoops?: boolean }).__blackoutThemeLoops)).toBe(true);
    await expect
        .poll(() => page.evaluate(() => (window as Window & { __blackoutThemeFades?: number[] }).__blackoutThemeFades))
        .toContain(0.22);
    const lighting = () => page.evaluate(() => window.__MOONSHOT__!.lighting());
    const transition = await lighting();
    expect(transition.skyNight).toBeGreaterThan(0);
    expect(transition.skyNight).toBeLessThan(1);
    expect(transition.pooled.some((v) => v > 0)).toBe(true);
    expect(transition.panels.some((v) => v > 0)).toBe(true);
    await advance(page, 900);
    const off = await lighting();
    expect(off.skyNight).toBe(1);
    expect(off.pooled.every((v) => v === 0), JSON.stringify(off.pooled)).toBe(true);
    expect(off.panels.length).toBeGreaterThan(0);
    expect(off.panels.every((v) => v === 0)).toBe(true);
    await page.keyboard.press('e');
    await advance(page, 100);
    expect((await page.evaluate(() => window.__MOONSHOT__!.match.state().power)).pulledAt).toBe(power.pulledAt);
    const advanceTo = async (offset: number) => {
        const remaining = power.pulledAt! + offset - (await page.evaluate(() => Date.now()));
        if (remaining > 0) await advance(page, remaining);
    };
    await advanceTo(POWER_TRAVEL_MS + 100);
    let state = await page.evaluate(() => window.__MOONSHOT__!.match.state().power);
    expect(state.phase).toBe('repairing');
    expect(state.dark).toBe(true);
    expect(Math.hypot(state.guard.x - destination[0], state.guard.z - destination[1])).toBeLessThan(0.01);
    await advanceTo(POWER_RESTORE_MS + 100);
    state = await page.evaluate(() => window.__MOONSHOT__!.match.state().power);
    expect(state.phase).toBe('returning');
    expect(state.dark).toBe(false);
    await expect
        .poll(() => page.evaluate(() => (window as Window & { __blackoutThemeFades?: number[] }).__blackoutThemeFades))
        .toContain(0);
    const on = await lighting();
    expect(on.pooled.some((v) => v > 0)).toBe(true);
    expect(on.panels.every((v) => v > 0)).toBe(true);
    await advanceTo(POWER_RETURN_MS + 100);
    state = await page.evaluate(() => window.__MOONSHOT__!.match.state().power);
    expect(state.phase).toBe('complete');
    expect((await lighting()).skyNight).toBe(0);
    expect([state.guard.x, state.guard.z]).toEqual(GUARD_ROUTE[0]);
    await page.keyboard.press('e');
    await advance(page, 100);
    expect((await page.evaluate(() => window.__MOONSHOT__!.match.state().power)).pulledAt).toBe(power.pulledAt);
    expect(errors).toEqual([]);
});

test('two real clients receive one authoritative outage and the same repair route', async ({ browser, page }) => {
    const second = await browser.newPage({ baseURL: 'http://127.0.0.1:5174' });
    const suffix = Date.now().toString(36);
    const open = async (p: Page, name: string) => {
        await p.goto('/?server=' + encodeURIComponent('ws://127.0.0.1:8787/ws'));
        await enterHome(p);
        await p.evaluate(() => window.__MOONSHOT__!.setRendering(false));
        await p.locator('#auth-name').fill(name);
        await p.locator('#auth-password').fill('local-power-test-42');
        await p.getByRole('button', { name: '进入校园' }).click();
        await expect.poll(() => p.evaluate(() => window.__MOONSHOT__!.match.state().net)).toBe('online');
    };
    try {
        await open(page, 'powerA' + suffix);
        await open(second, 'powerB' + suffix);
        const goal = BREAKER_ROUTE[BREAKER_ROUTE.length - 1];
        await page.evaluate(([x, z]) => window.__MOONSHOT__!.teleport(x, 0.92, z), goal);
        if ((await page.locator('#app-ui').getAttribute('data-screen')) === 'paused')
            await page.getByRole('button', { name: '继续游戏', exact: true }).click();
        await page.waitForTimeout(300);
        await page.keyboard.press('e');
        await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().power.dark)).toBe(true);
        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().power.dark)).toBe(true);
        const a = await page.evaluate(() => window.__MOONSHOT__!.match.state().power);
        const b = await second.evaluate(() => window.__MOONSHOT__!.match.state().power);
        expect(a.pulledAt).toBe(b.pulledAt);
        expect(Math.hypot(a.guard.x - b.guard.x, a.guard.z - b.guard.z)).toBeLessThan(0.6);
        await second.reload();
        await enterHome(second);
        await second.evaluate(() => window.__MOONSHOT__!.setRendering(false));
        await second.getByRole('button', { name: '进入校园' }).click();
        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().net)).toBe('online');
        expect((await second.evaluate(() => window.__MOONSHOT__!.match.state().power)).pulledAt).toBe(a.pulledAt);
        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().power.dark)).toBe(true);
    } finally {
        await second.close();
    }
});
