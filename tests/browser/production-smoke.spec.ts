import { expect, test } from '@playwright/test';

test('production preview loads FF-01, physics and pointer-lock entry flow', async ({ page }) => {
    const runtimeErrors: string[] = [];
    const assets: Record<string, number> = {};
    await page.addInitScript(() => {
        const decoded: number[] = [];
        Object.assign(window, { __decodedCombatAudio: decoded });
        const decode = AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData = function (data: ArrayBuffer) {
            Object.assign(window, { __gameAudioContext: this });
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
            response.url().includes('/assets/pickups/') ||
            response.url().includes('/assets/ui/moonshot-loading.webp') ||
            response.url().includes('/ammo/') ||
            response.url().includes('/assets/audio/')
        ) {
            assets[new URL(response.url()).pathname] = response.status();
        }
    });

    // Music never holds up loading: with the title theme stalled the game still becomes ready.
    let releaseHomepageAudio!: () => void;
    const homepageAudioGate = new Promise<void>((resolve) => {
        releaseHomepageAudio = resolve;
    });
    await page.route('**/assets/audio/homepage-theme.mp3', async (route) => {
        await homepageAudioGate;
        await route.continue();
    });
    await page.goto('/');
    await expect(page.locator('#boot-loader')).toBeVisible();
    await expect
        .poll(() => page.locator('#boot-loader').evaluate((loader) => getComputedStyle(loader).backgroundImage))
        .toContain('moonshot-loading.webp');
    await expect
        .poll(() =>
            page.evaluate(() => {
                const progress = document.querySelector('#boot-progress')?.getBoundingClientRect();
                return !!progress && progress.bottom >= window.innerHeight - 40;
            })
        )
        .toBe(true);
    await expect(page).toHaveTitle('Moonshot Frisbee Games');
    await expect(page.locator('#enter-button')).toBeDisabled();
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'loading', { timeout: 90_000 });
    await expect(page.locator('.stages li[data-state="done"]')).toHaveCount(6);
    await expect(page.locator('#boot-loader')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#boot-continue')).toBeVisible();
    await expect(page.locator('#app-ui')).toHaveAttribute('inert', '');
    await expect(page.locator('#enter-button')).toContainText('ENTER THE ARENA');
    // The big models arrive as their gzip copies.
    expect(assets['/assets/campus/MAC_Campus_FF01.glb.gz']).toBe(200);
    expect(assets['/assets/campus/MAC_Campus_FF01.glb']).toBeUndefined();
    expect(assets['/assets/campus/rooms.json']).toBe(200);
    expect(assets['/assets/ui/moonshot-loading.webp']).toBe(200);
    releaseHomepageAudio();
    await expect.poll(() => assets['/assets/audio/homepage-theme.mp3']).toBe(200);
    expect(assets['/ammo/ammo.wasm.wasm']).toBe(200);
    for (const name of ['revive-medkit.glb', 'eye-monitor.glb', 'stealth-crystal.glb', 'creation-gear.glb']) {
        expect(assets[`/assets/pickups/${name}`]).toBe(200);
    }
    for (const name of ['world.json', 'ceiling-mask.png', 'minimap.png']) {
        expect(assets[`/assets/campus/derived/${name}`]).toBe(200);
    }

    await page.getByRole('button', { name: /进入游戏/ }).click();
    // The title theme (prefetched in the background) is decoded once it starts playing.
    await expect
        .poll(() =>
            page.evaluate(() =>
                (window as unknown as { __decodedCombatAudio: number[] }).__decodedCombatAudio.some(
                    (duration) => duration > 171 && duration < 173
                )
            )
        )
        .toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __gameAudioContext?: AudioContext }).__gameAudioContext?.state)).toBe('running');
    await expect(page.locator('#boot-loader')).toBeHidden();
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready');
    await expect(page.locator('.title-top .brand-mark')).toHaveCount(0);
    await expect(page.locator('.title-top .brand')).toContainText('MOONSHOTFRISBEE GAMES');
    await expect
        .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()))
        .toBe('#00d7ff');
    await expect
        .poll(() =>
            page.evaluate(() => {
                const icons = document.createElement('span');
                icons.className = 'ammo-icons';
                const icon = document.createElement('i');
                icon.dataset.full = 'true';
                icons.append(icon);
                document.body.append(icons);
                const style = getComputedStyle(icon);
                const result = { fill: style.backgroundColor, edge: style.borderTopColor, glow: style.boxShadow };
                icons.remove();
                return result;
            })
        )
        .toEqual({ fill: 'rgb(0, 215, 255)', edge: 'rgb(114, 242, 255)', glow: expect.stringContaining('0, 215, 255') });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const ping = document.createElement('div');
                ping.className = 'xray-ping';
                document.body.append(ping);
                const colour = getComputedStyle(ping).borderTopColor;
                ping.remove();
                return colour;
            })
        )
        .toBe('rgb(0, 215, 255)');
    await expect
        .poll(() =>
            page.locator('#enter-button').evaluate((button) => {
                const channels = getComputedStyle(button).backgroundColor.match(/\d+/g)?.map(Number);
                return !!channels && channels[2] > channels[1] && channels[2] > channels[0];
            })
        )
        .toBe(true);
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
    await page.screenshot({ path: 'test-results/hud-electric-blue.png' });
    for (const [file, duration] of [
        ['body-hit-v10.wav', 0.54299],
        ['kill-v12.wav', 0.74299],
        ['headshot-v16.wav', 1.05299],
        ['gold-kill-06-01.wav', 0.93],
        ['buzzer.mp3', 1.1755]
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
