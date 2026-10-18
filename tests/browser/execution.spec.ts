import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { enterHome } from './support';

const openPlayer = async (page: Page, name: string) => {
    await page.goto('/?server=' + encodeURIComponent('ws://127.0.0.1:8787/ws'));
    await enterHome(page);
    await page.locator('#auth-name').fill(name);
    await page.locator('#auth-password').fill('local-execution-test-42');
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net)).toBe('online');
};

test('two networked players share the global Boomerang film and the target spectates after one settlement', async ({
    browser,
    page
}) => {
    const second = await browser.newPage({ baseURL: 'http://127.0.0.1:5174' });
    const suffix = Date.now().toString(36);
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
        await page.keyboard.up('v');
        await expect.poll(() => second.evaluate(() => window.__MOONSHOT__!.match.state().globalFinisher?.id)).not.toBeNull();
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
        expect(renderedA.attackerAnimation.name).toBe('Finisher_Boomerang_Attacker');
        expect(renderedA.targetAnimation.name).toBe('Finisher_Boomerang_Victim');
        expect(renderedB.attackerAnimation.name).toBe('Finisher_Boomerang_Attacker');
        expect(renderedB.targetAnimation.name).toBe('Finisher_Boomerang_Victim');
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
