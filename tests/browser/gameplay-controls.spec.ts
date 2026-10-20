import { expect, test } from '@playwright/test';

import { GOLD_DROP_SURFACES } from '../../src/config/goldDropSurfaces.ts';
import { ACTIONS } from '../../src/input/actions.ts';

import { advance, enterAtSpawn, enterCampus, loadSimulated } from './support';

test('crouch changes the actual capsule, preserves the feet and restores the standing camera', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    const before = await page.evaluate(() => ({ position: window.__MOONSHOT__!.position(), crouch: window.__MOONSHOT__!.crouch() }));
    await page.keyboard.down('c');
    await advance(page, 240);
    const low = await page.evaluate(() => ({ position: window.__MOONSHOT__!.position(), crouch: window.__MOONSHOT__!.crouch() }));
    expect(low.crouch.active).toBe(true);
    expect(low.crouch.capsuleHeight).toBeCloseTo(1.2, 3);
    expect(low.position[1]).toBeCloseTo(before.position[1] - 0.3, 1);
    expect(low.crouch.cameraY).toBeCloseTo(0.43, 1);
    await page.screenshot({ path: 'test-results/gameplay-controls-crouched.png' });

    await page.keyboard.up('c');
    await advance(page, 240);
    const standing = await page.evaluate(() => ({ position: window.__MOONSHOT__!.position(), crouch: window.__MOONSHOT__!.crouch() }));
    expect(standing.crouch.active).toBe(false);
    expect(standing.crouch.capsuleHeight).toBeCloseTo(1.8, 3);
    expect(standing.position[1]).toBeCloseTo(before.position[1], 1);
    expect(standing.crouch.cameraY).toBeCloseTo(0.66, 1);
});

test('crouch fits below a real Ammo ceiling and only stands after the obstruction is removed', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    await page.evaluate(() => window.__MOONSHOT__!.crouchCeilingFixture(true));
    await page.keyboard.down('c');
    await advance(page, 240);
    const crouched = await page.evaluate(() => window.__MOONSHOT__!.crouch());
    expect(crouched.active).toBe(true);
    expect(crouched.capsuleHeight).toBeCloseTo(1.2, 3);
    await page.keyboard.up('c');
    await advance(page, 240);
    expect((await page.evaluate(() => window.__MOONSHOT__!.crouch())).active).toBe(true);
    await page.evaluate(() => window.__MOONSHOT__!.crouchCeilingFixture(false));
    await advance(page, 240);
    const restored = await page.evaluate(() => window.__MOONSHOT__!.crouch());
    expect(restored.active).toBe(false);
    expect(restored.capsuleHeight).toBeCloseTo(1.8, 3);
});

test('an elevated golden-drop anchor is physically supported in the loaded arena', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    const levelTargets = [5.5, 8.5, 11.5, 14.5];
    for (const target of levelTargets) {
        const anchor = GOLD_DROP_SURFACES.find(([, y]) => Math.abs(y - target) < 0.08);
        expect(anchor, `generated support sample near Y=${target}`).toBeTruthy();
        await page.evaluate(([x, y, z]) => window.__MOONSHOT__!.teleport(x, y, z), anchor!);
        await advance(page, 500);
        const evidence = await page.evaluate(() => {
            const p = window.__MOONSHOT__!.position();
            return {
                position: p,
                support: window.__MOONSHOT__!.raycast([p[0], p[1] - 0.65, p[2]], [p[0], p[1] - 1.1, p[2]])
            };
        });
        expect(evidence.position[1], `settled at level ${target}`).toBeCloseTo(anchor![1], 0);
        expect(evidence.support, `Ammo ray found support at level ${target}`).toBeTruthy();
        if (target === levelTargets[0]) await page.screenshot({ path: 'test-results/gold-drop-upper-bowl.png' });
    }
});

test('the original latency indicator remains bottom-left and no FPS overlay is shown', async ({ page }) => {
    await page.goto('/');
    await enterCampus(page);
    const latencyBox = await page.locator('#latency').boundingBox();
    const viewport = page.viewportSize();
    expect(latencyBox && viewport).toBeTruthy();
    expect(latencyBox!.x).toBeLessThan(viewport!.width / 2);
    expect(latencyBox!.y).toBeGreaterThan(viewport!.height / 2);
    await expect(page.locator('.fps-hud')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/gameplay-controls-latency.png' });
});

test('carrying the golden disc hides ordinary ammo status and restores it after dropping', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    const ammoBlock = page.locator('.ammo-block');
    await expect(ammoBlock).toBeVisible();
    await page.locator('#app-ui').evaluate((element) => { (element as HTMLElement).dataset.gold = 'mine'; });
    await expect(ammoBlock).toBeHidden();
    await page.locator('#app-ui').evaluate((element) => { (element as HTMLElement).dataset.gold = 'lying'; });
    await expect(ammoBlock).toBeVisible();
});

test('the remapped controller input source still moves the player', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    const before = await page.evaluate(() => window.__MOONSHOT__!.position());
    await page.keyboard.down('w');
    await advance(page, 500);
    await page.keyboard.up('w');
    const after = await page.evaluate(() => window.__MOONSHOT__!.position());
    expect(after[2]).toBeLessThan(before[2] - 0.5);

    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '按键' }).click();
    await page.getByRole('button', { name: '前进，当前 W，点击修改' }).click();
    await page.keyboard.press('ArrowUp');
    await page.getByRole('tab', { name: '游戏' }).click();
    await page.getByRole('button', { name: '继续游戏' }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('application-canvas');
    const remapStart = await page.evaluate(() => window.__MOONSHOT__!.position());
    await page.keyboard.down('ArrowUp');
    await advance(page, 500);
    await page.keyboard.up('ArrowUp');
    const remapEnd = await page.evaluate(() => window.__MOONSHOT__!.position());
    expect(remapEnd[2]).toBeLessThan(remapStart[2] - 0.5);
});

test('one jump press releases cleanly and does not make the player auto-bounce', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    await advance(page, 500);
    const groundY = (await page.evaluate(() => window.__MOONSHOT__!.position()))[1];

    await page.keyboard.down('Space');
    await advance(page, 100);
    await page.keyboard.up('Space');
    await advance(page, 1_000);
    const lateHeights: number[] = [];
    for (let i = 0; i < 12; i++) {
        await advance(page, 100);
        lateHeights.push((await page.evaluate(() => window.__MOONSHOT__!.position()))[1]);
    }

    expect(Math.max(...lateHeights)).toBeLessThan(groundY + 0.15);
    expect(Math.min(...lateHeights)).toBeGreaterThan(groundY - 0.15);
});

test('crouch keybinding updates immediately and persists', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '按键' }).click();
    await page.getByRole('button', { name: '蹲下，当前 C，点击修改' }).click();
    await page.keyboard.press('x');
    await expect(page.getByRole('button', { name: '蹲下，当前 X，点击修改' })).toBeVisible();
    await expect(page.locator('.controls [data-action="crouch"]').first()).toHaveText('X');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('moonshot-open-world.settings.v1') ?? '{}').keyBindings.crouch)).toBe('KeyX');
    await page.screenshot({ path: 'test-results/gameplay-controls-keybindings.png' });
});

test('settings expose and resolve the complete gameplay binding matrix with live hints', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '按键' }).click();
    await expect(page.locator('#keybindings .keybinding-row')).toHaveCount(ACTIONS.length);

    await page.getByRole('button', { name: '地图，当前 M，点击修改' }).click();
    await page.keyboard.press('q');
    await expect(page.getByRole('button', { name: '地图，当前 Q，点击修改' })).toBeVisible();
    await expect(page.locator('[data-action="map"]').first()).toHaveText('Q');

    await page.getByRole('button', { name: '地图，当前 Q，点击修改' }).click();
    await page.keyboard.press('c');
    await expect(page.locator('#keybinding-status')).toContainText('C 已用于蹲下');
    await page.getByRole('button', { name: '交换按键' }).click();
    await expect(page.getByRole('button', { name: '地图，当前 C，点击修改' })).toBeVisible();
    await expect(page.getByRole('button', { name: '蹲下，当前 Q，点击修改' })).toBeVisible();

    await page.getByRole('button', { name: '恢复全部默认按键' }).click();
    await expect(page.getByRole('button', { name: '地图，当前 M，点击修改' })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('moonshot-open-world.settings.v1') ?? '{}').keyBindings.map)).toBe('KeyM');
    await page.screenshot({ path: 'test-results/gameplay-controls-keybindings-matrix.png' });
});
