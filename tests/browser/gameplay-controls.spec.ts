import { expect, test } from '@playwright/test';

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

test('FPS HUD reports a real frame rate while the tab is visible', async ({ page }) => {
    await page.goto('/');
    await enterCampus(page);
    await expect(page.locator('.fps-hud')).toBeVisible();
    await expect(page.locator('.fps-hud b')).toHaveText(/^\d+$/, { timeout: 5_000 });
    await expect(page.locator('.fps-hud span')).toContainText(/FPS · \d+ ms/);
    const hudBox = await page.locator('.fps-hud').boundingBox();
    const mapBox = await page.locator('#minimap').boundingBox();
    expect(hudBox && mapBox && (hudBox.x + hudBox.width <= mapBox.x || mapBox.x + mapBox.width <= hudBox.x)).toBe(true);
    await page.screenshot({ path: 'test-results/gameplay-controls-fps.png' });
});

test('FPS preference and crouch keybinding update immediately and persist', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    await page.keyboard.press('Escape');
    const videoTab = page.getByRole('tab', { name: '画面与操作' });
    await videoTab.click();
    await page.locator('#show-fps').uncheck();
    await expect(page.locator('.fps-hud')).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('moonshot-open-world.settings.v1') ?? '{}').showFps)).toBe(false);

    await page.getByRole('tab', { name: '按键' }).click();
    await page.getByRole('button', { name: '蹲下，当前 C，点击修改' }).click();
    await page.keyboard.press('x');
    await expect(page.getByRole('button', { name: '蹲下，当前 X，点击修改' })).toBeVisible();
    await expect(page.locator('.controls [data-action="crouch"]').first()).toHaveText('X');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('moonshot-open-world.settings.v1') ?? '{}').keyBindings.crouch)).toBe('KeyX');
    await page.screenshot({ path: 'test-results/gameplay-controls-keybindings.png' });
});
