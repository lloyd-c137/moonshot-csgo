import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { enterHome, testAppUrl, testServerUrl } from './support';

const openPlayer = async (page: Page, name: string) => {
    await page.goto('/?server=' + encodeURIComponent(testServerUrl) + '&lobby=1');
    await enterHome(page);
    await page.locator('#auth-name').fill(name);
    await page.locator('#auth-password').fill('local-execution-test-42');
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net)).toBe('online');
    await expect.poll(() => page.evaluate(() => {
        const state = window.__MOONSHOT__!.match.state();
        return state.players.find((player) => player.id === state.id)?.phase;
    })).toBe('lobby');
    await page.evaluate(() => window.__MOONSHOT__!.teleport(-8.25, 0.92, 52.9));
    await expect
        .poll(() => page.evaluate(() => {
            const state = window.__MOONSHOT__!.match.state();
            return state.players.find((player) => player.id === state.id)?.phase;
        }))
        .toBe('playing');
};

test('two networked players share the global Boomerang film and the target spectates after one settlement', async ({
    browser,
    page
}) => {
    const second = await browser.newPage({ baseURL: testAppUrl });
    const suffix = Date.now().toString(36);
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    second.on('pageerror', (error) => runtimeErrors.push(error.message));
    try {
        await openPlayer(page, `execA${suffix}`);
        await openPlayer(second, `execB${suffix}`);

        await page.evaluate(() => {
            window.__MOONSHOT__!.teleport(-44, 0.92, 39.6);
            window.__MOONSHOT__!.setLook(0, 90);
        });
        await second.evaluate(() => {
            window.__MOONSHOT__!.teleport(-45, 0.92, 39.6);
            window.__MOONSHOT__!.setLook(0, 90);
        });
        await page.waitForTimeout(1800);
        await expect(page.locator('#execute-button')).toBeVisible();
        await expect(second.locator('#execute-button')).toBeHidden();

        await page.keyboard.down('v');
        await expect
            .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().globalFinisher?.id))
            .not.toBeNull();
        await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().executions.length)).toBe(1);
        await page.keyboard.up('v');
        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().globalFinisher?.id)).not.toBeNull();
        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().executions.length)).toBe(1);
        expect(runtimeErrors).toEqual([]);
        const a = await page.evaluate(() => window.__MOONSHOT__!.match.state().executions[0]);
        const b = await second.evaluate(() => window.__MOONSHOT__!.match.state().executions[0]);
        expect(a.role).toBe('attacker');
        expect(b.role).toBe('target');
        expect(a.id).toBe(b.id);
        await expect
            .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().executions[0]?.camera))
            .toBe(true);
        await expect
            .poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().executions[0]?.camera))
            .toBe(true);
        const renderedA = await page.evaluate(() => window.__MOONSHOT__!.match.state().executions[0]);
        const renderedB = await second.evaluate(() => window.__MOONSHOT__!.match.state().executions[0]);
        expect(renderedA.camera).toBe(true);
        expect(renderedB.camera).toBe(true);
        expect(renderedA.actorsVisible).toBe(true);
        expect(renderedB.actorsVisible).toBe(true);
        expect(Math.abs(renderedA.progress - renderedB.progress)).toBeLessThan(0.1);
        expect(renderedA.renderedParts).toBeGreaterThan(0);
        expect(renderedB.renderedParts).toBeGreaterThan(0);
        expect(renderedA.attackerAnimation.name).toBe('Finisher_Toss_Attacker');
        expect(renderedA.targetAnimation.name).toBe('Finisher_Toss_Victim');
        expect(renderedB.attackerAnimation.name).toBe('Finisher_Toss_Attacker');
        expect(renderedB.targetAnimation.name).toBe('Finisher_Toss_Victim');
        expect(Math.abs(renderedA.attackerAnimation.time - renderedB.attackerAnimation.time)).toBeLessThan(0.12);
        await page.waitForTimeout(850);
        await Promise.all([
            page.screenshot({ path: 'test-results/execution-attacker.png' }),
            second.screenshot({ path: 'test-results/execution-target.png' })
        ]);

        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().spectating)).toBe(true);
        expect((await page.evaluate(() => window.__MOONSHOT__!.match.state())).alive).toBe(true);
        expect((await page.evaluate(() => window.__MOONSHOT__!.match.state().executions)).length).toBe(0);
        expect(await page.evaluate(() => window.__MOONSHOT__!.match.state().globalFinisher)).toBeNull();
    } finally {
        await second.close();
    }
});
