import { expect, test } from '@playwright/test';

test('production preview loads FF-01, physics and pointer-lock entry flow', async ({ page }) => {
    const runtimeErrors: string[] = [];
    const assets: Record<string, number> = {};
    await page.addInitScript(() => {
        const decoded: number[] = [];
        Object.assign(window, { __decodedCombatAudio: decoded });
        const decode = AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
            return decode.call(this, data).then((buffer) => {
                decoded.push(buffer.duration);
                return buffer;
            });
        };
    });
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
    });
    page.on('response', (response) => {
        if (
            response.url().includes('/assets/campus/') ||
            response.url().includes('/ammo/') ||
            response.url().includes('/assets/audio/')
        ) {
            assets[new URL(response.url()).pathname] = response.status();
        }
    });

    await page.goto('/');
    await expect(page).toHaveTitle('Moonshot Frisbee Games');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await expect(page.locator('.stages li[data-state="done"]')).toHaveCount(5);
    expect(assets['/assets/campus/MAC_Campus_FF01.glb']).toBe(200);
    expect(assets['/assets/campus/rooms.json']).toBe(200);
    expect(assets['/ammo/ammo.wasm.wasm']).toBe(200);
    for (const name of ['world.json', 'ceiling-mask.png', 'minimap.png']) {
        expect(assets[`/assets/campus/derived/${name}`]).toBe(200);
    }

    await page.getByRole('button', { name: '进入校园' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
    for (const [file, duration] of [
        ['body-hit-v10.wav', 0.54299],
        ['kill-v12.wav', 0.74299],
        ['headshot-v16.wav', 1.05299],
        ['gold-kill-06-01.wav', 0.93],
        ['throw-whoosh-05.wav', 1.26]
    ] as const) {
        await expect.poll(() => assets[`/assets/audio/${file}`]).toBe(200);
        await expect
            .poll(() =>
                page.evaluate(
                    (expected) =>
                        (window as unknown as { __decodedCombatAudio: number[] }).__decodedCombatAudio.some(
                            (value) => Math.abs(value - expected) < 0.0001
                        ),
                    duration
                )
            )
            .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'paused');
    expect(runtimeErrors).toEqual([]);
});
