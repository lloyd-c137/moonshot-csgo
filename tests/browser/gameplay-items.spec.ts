import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterCampus, loadSimulated } from './support';

test('offline practice picks up every room item and both NPC abilities', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page, '/?offline=1&noIntro=1&noLobby=1');
    await enterCampus(page);

    const pickup = async (x: number, z: number, ability: string) => {
        await page.evaluate(([px, pz]) => window.__MOONSHOT__!.teleport(px, 0.92, pz), [x, z]);
        await advance(page, 250);
        await page.keyboard.press('e');
        await advance(page, 100);
        await expect.poll(() => page.evaluate((key) => window.__MOONSHOT__!.match.state().abilities?.[key], ability)).toBe(true);
    };

    await pickup(-64.68, -8.64, 'revive');
    await pickup(-44.24, 25.54, 'frc');
    await page.keyboard.press('z');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().abilities?.frcSelected)).toBe(true);
    await pickup(-42.92, 10.58, 'eye');
    await pickup(-8.39, 23.48, 'stealth');
    await page.keyboard.press('x');
    await advance(page, 100);
    await expect.poll(() => page.evaluate(() => {
        const state = window.__MOONSHOT__!.match.state();
        return Number(state.abilities?.stealthUntil) > state.roomNow!;
    })).toBe(true);
    await expect(page.locator('#ability-status')).toContainText('隐身');
    await pickup(18.03, -12.29, 'coach');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().abilities?.ammoCapacity)).toBe(5);
    await pickup(-35.59, 51.76, 'creation');

    await page.evaluate(() => window.__MOONSHOT__!.teleport(-8, 0.92, 45));
    await advance(page, 100);
    await page.screenshot({ path: 'test-results/gameplay-items.png', fullPage: false });
    expect(errors).toEqual([]);
});
