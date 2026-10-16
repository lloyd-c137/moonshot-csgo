import { expect, test } from '@playwright/test';

import './support';

test('offline target stays visible after entry, uses selected defaults and respawns in place', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        const played: { duration: number; gain: number; offset: number; length: number; sampleRate: number }[] = [];
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
                length: duration ?? 0,
                sampleRate: this.buffer?.sampleRate ?? 44100
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
    await page.keyboard.press('p');
    await page.locator('[data-golden]').check();
    await page.locator('[data-action="resume"]').click();
    await shoot(1.6, 0);
    await expect(page.locator('#popup')).toHaveText('人偶 · 金飞盘击杀');
    const played = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __combatPlayed: {
                        duration: number;
                        gain: number;
                        offset: number;
                        length: number;
                        sampleRate: number;
                    }[];
                }
            ).__combatPlayed
    );
    for (const duration of [0.54299, 0.74299, 1.05299, 0.93, 1.26]) {
        const clip = played.find((entry) => Math.abs(entry.duration - duration) < 0.0001);
        expect(clip, `default clip duration ${duration}`).toBeDefined();
        expect(clip!.gain).toBeCloseTo(0.35, 5);
        expect(clip!.offset).toBe(0);
        // decodeAudioData resamples to the output device (44.1/48 kHz), with at most one frame of rounding.
        expect(Math.abs(clip!.length - duration)).toBeLessThanOrEqual(1 / clip!.sampleRate + 1e-9);
    }
    await page.screenshot({ path: 'test-results/audio-lab-visible-target.png' });
    expect(errors).toEqual([]);
});

test('gold-kill and whoosh candidates preview and follow real practice throws', async ({ page }) => {
    // CI has no private video files. Authorized production WAVs stand in for two local candidates here.
    await page.route('**/.audio-lab-local/manifest.json', (route) =>
        route.fulfill({
            json: {
                clips: [
                    {
                        id: 'gold-fixture',
                        label: '06 split fixture',
                        url: 'clips/gold.wav',
                        duration: 0.74299,
                        mixed: true,
                        cues: ['goldKill']
                    },
                    {
                        id: 'whoosh-fixture',
                        label: 'Whoosh fixture',
                        url: 'clips/whoosh.wav',
                        duration: 0.54299,
                        mixed: true,
                        cues: ['throw']
                    }
                ]
            }
        })
    );
    await page.route('**/.audio-lab-local/clips/gold.wav', (route) =>
        route.fulfill({ path: 'public/assets/audio/kill-v12.wav', contentType: 'audio/wav' })
    );
    await page.route('**/.audio-lab-local/clips/whoosh.wav', (route) =>
        route.fulfill({ path: 'public/assets/audio/body-hit-v10.wav', contentType: 'audio/wav' })
    );
    await page.addInitScript(() => {
        const durations: number[] = [];
        Object.assign(window, { __candidateDurations: durations });
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
            durations.push(this.buffer?.duration ?? 0);
            start.call(this, when, offset, duration);
        };
    });
    const played = () =>
        page.evaluate(() => (window as unknown as { __candidateDurations: number[] }).__candidateDurations);
    await page.goto('/?audioLab=1&offline=1');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.keyboard.press('p');
    await expect(page.locator('.audio-lab section')).toHaveCount(6);
    await expect(page.locator('section[data-cue="goldKill"] option')).toHaveCount(2);
    await expect(page.locator('section[data-cue="throw"] option')).toHaveCount(2);
    await expect(page.locator('section[data-cue="hit"] option')).toHaveCount(1);
    await page.locator('section[data-cue="goldKill"] select').selectOption('gold-fixture');
    await expect(page.locator('.audio-lab-status')).toContainText('已应用');
    await expect(page.locator('[data-golden]')).toBeChecked();
    await page.locator('section[data-cue="goldKill"] [data-preview]').click();
    await expect.poll(async () => (await played()).some((v) => Math.abs(v - 0.74299) < 0.0001)).toBe(true);
    await page.locator('section[data-cue="throw"] select').selectOption('whoosh-fixture');
    await expect(page.locator('.audio-lab-status')).toContainText('飞盘破空');
    await page.locator('section[data-cue="throw"] [data-preview]').click();
    await expect.poll(async () => (await played()).some((v) => Math.abs(v - 0.54299) < 0.0001)).toBe(true);
    await page.locator('[data-golden]').check();
    await page.locator('[data-action="range"]').click();
    await expect(page.locator('.name-tag').filter({ hasText: '固定测试人偶' })).toBeVisible();
    await page.waitForTimeout(600);
    const before = (await played()).length;
    expect(await page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-8.7, 1.6, 42.3))).toBe(true);
    await expect(page.locator('#popup')).toHaveText('人偶 · 金飞盘击杀');
    const actual = (await played()).slice(before);
    expect(actual).toHaveLength(2);
    expect(Math.abs(actual[0] - 0.54299)).toBeLessThan(0.0001);
    expect(Math.abs(actual[1] - 0.74299)).toBeLessThan(0.0001);
    await page.keyboard.press('p');
    await page.locator('[data-action="reset"]').click();
    await expect(page.locator('[data-golden]')).not.toBeChecked();
    await expect(page.locator('section[data-cue="goldKill"] select')).toHaveValue('original');
    await expect(page.locator('section[data-cue="throw"] select')).toHaveValue('original');
});
