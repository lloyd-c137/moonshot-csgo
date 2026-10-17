import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterCampus, loadSimulated } from './support';

test('offline practice replaces the active skill, keeps Michael talent, and renders both NPCs', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page, '/?offline=1&noIntro=1&noLobby=1');
    await enterCampus(page);

    const pickup = async (x: number, z: number, ability: string) => {
        await page.evaluate(([px, pz]) => window.__MOONSHOT__!.teleport(px, 0.92, pz), [x, z]);
        await page.keyboard.press('e');
        await advance(page, 100);
        await expect.poll(() => page.evaluate((key) => window.__MOONSHOT__!.match.state().abilities?.[key], ability)).toBe(true);
    };

    await pickup(-64.68, -8.64, 'revive');
    await pickup(-44.24, 25.54, 'frc');
    await expect.poll(() => page.evaluate(() => {
        const state = window.__MOONSHOT__!.match.state();
        return [state.abilities?.revive, state.abilities?.frc, state.items?.find((item) => item.id === 'item-revive')?.available];
    })).toEqual([false, true, true]);
    await page.keyboard.press('z');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().abilities?.frcSelected)).toBe(true);
    await pickup(-42.92, 10.58, 'eye');
    await expect.poll(() => page.evaluate(() => {
        const state = window.__MOONSHOT__!.match.state();
        return [state.abilities?.frc, state.abilities?.eye, state.abilities?.frcSelected];
    })).toEqual([false, true, false]);
    await pickup(-8.39, 23.48, 'stealth');
    await page.keyboard.press('x');
    await advance(page, 100);
    await expect.poll(() => page.evaluate(() => {
        const state = window.__MOONSHOT__!.match.state();
        return Number(state.abilities?.stealthUntil) > state.roomNow!;
    })).toBe(true);
    await expect(page.locator('#ability-status')).toContainText('隐身');
    // Interact synchronously after teleport so 纪老师's first watch-tick at S308 does not start detention first.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(18.03, 0.92, -12.29));
    await page.keyboard.press('e');
    await advance(page, 100);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().abilities?.ammoCapacity)).toBe(5);
    await pickup(-35.59, 51.76, 'creation');
    await expect.poll(() => page.evaluate(() => {
        const abilities = window.__MOONSHOT__!.match.state().abilities;
        return [abilities?.revive, abilities?.frc, abilities?.eye, abilities?.stealth, abilities?.creation, abilities?.coach];
    })).toEqual([false, false, false, false, true, true]);
    await expect.poll(() => page.evaluate(() => {
        const names = [...document.querySelectorAll('.name-tag')].map((tag) => tag.textContent ?? '');
        return [names.some((name) => name.includes('Mark')), names.some((name) => name.includes('Michael 教练'))];
    })).toEqual([true, true]);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().items?.find((item) => item.id === 'item-stealth')?.available)).toBe(true);

    await page.evaluate(() => {
        window.__MOONSHOT__!.teleport(-37.5, 0.92, 48.5);
        window.__MOONSHOT__!.setLook(0, 33);
    });
    await advance(page, 100);
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(true));
    await page.waitForTimeout(150);
    await page.screenshot({ path: 'test-results/gameplay-items.png', fullPage: false });
    expect(errors).toEqual([]);
});
