import { expect, test } from '@playwright/test';

import './support';

test('offline target stays visible after entry, uses selected defaults and respawns in place', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        const played: { duration: number; gain: number; offset: number; length: number }[] = [];
        Object.assign(window, { __combatPlayed: played });
        const gains = new WeakMap<AudioNode, GainNode>();
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (destination: AudioNode, output = 0, input = 0) {
            if (this instanceof AudioBufferSourceNode && destination instanceof GainNode) gains.set(this, destination);
            return connect.call(this, destination, output, input);
        } as typeof connect;
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
            played.push({
                duration: this.buffer?.duration ?? 0,
                gain: gains.get(this)?.gain.value ?? -1,
                offset,
                length: duration ?? 0
            });
            start.call(this, when, offset, duration);
        };
    });
    await page.goto('/?audioLab=1&offline=1');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.keyboard.press('p');
    await page.locator('[data-action="range"]').click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    // This was absent after net.connect() cleared all avatars, even while the invisible target could be hit.
    const tag = page.locator('.name-tag').filter({ hasText: '固定测试人偶' });
    await expect(tag).toBeVisible();
    const initial = await page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy);
    const shoot = async (height: number, hp: number) => {
        expect(await page.evaluate((y) => window.__MOONSHOT__!.match.throwAt(-8.7, y, 42.3), height)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy?.hp)).toBe(hp);
    };
    await page.waitForTimeout(600);
    await shoot(0.9, 1);
    await page.waitForTimeout(550);
    await shoot(0.9, 0);
    await expect(tag).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy?.hp)).toBe(2);
    await expect(tag).toBeVisible();
    await shoot(1.6, 0);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy?.hp)).toBe(2);
    await expect(tag).toBeVisible();
    expect((await page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy))?.position).toEqual(
        initial?.position
    );
    const played = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __combatPlayed: { duration: number; gain: number; offset: number; length: number }[];
                }
            ).__combatPlayed
    );
    for (const duration of [0.54299, 0.74299, 1.05299]) {
        const clip = played.find((entry) => Math.abs(entry.duration - duration) < 0.0001);
        expect(clip, `default clip duration ${duration}`).toBeDefined();
        expect(clip!.gain).toBeCloseTo(0.35, 5);
        expect(clip!.offset).toBe(0);
        expect(clip!.length).toBeCloseTo(duration, 5);
    }
    await page.screenshot({ path: 'test-results/audio-lab-visible-target.png' });
    expect(errors).toEqual([]);
});
