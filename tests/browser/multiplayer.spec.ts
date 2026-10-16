import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { collectErrors } from './support';

// Two players join the local shared-world room (wrangler dev), see each other, and one eliminates the other with a
// frisbee; the server scores it and respawns the target. Runs in real time (the room's clock is real).
const SERVER = 'ws://127.0.0.1:8787/ws';

const join = async (browser: Browser, name: string) => {
    const page = await (await browser.newContext()).newPage();
    const errors = collectErrors(page);
    await page.goto(`/?server=${encodeURIComponent(SERVER)}`);
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    await page.locator('#nickname').fill(name);
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect
        .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net), { timeout: 20_000 })
        .toBe('online');
    return { page, errors };
};

const state = (page: Page) => page.evaluate(() => window.__MOONSHOT__!.match.state());

test('two players share the campus; a frisbee hit eliminates and the server respawns', async ({ browser }) => {
    const a = await join(browser, '甲');
    const b = await join(browser, '乙');
    await expect.poll(async () => (await state(a.page)).players.map((p) => p.name).sort()).toEqual(['乙', '甲']);
    const idB = (await state(b.page)).id;

    // Stand 6 m apart in the straight corridor north of M104.
    await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-46.3, 0.92, 39.6));
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    // Past the joiner's spawn protection, and long enough for A to see B's new position.
    await a.page.waitForTimeout(1_800);

    // First hit: damaged, not out.
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.3, 39.6))).toBe(true);
    await expect
        .poll(async () => [(await state(b.page)).hp, (await state(a.page)).hitsClaimed], { timeout: 5_000 })
        .toEqual([1, 1]);
    expect((await state(b.page)).alive).toBe(true);
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'hit');
    // Second hit (after the throw cooldown): eliminated and broadcast to everyone.
    await a.page.waitForTimeout(700);
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    await a.page.waitForTimeout(400);
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.3, 39.6))).toBe(true);
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 5_000 }).toBe(false);
    await expect(b.page.locator('#eliminated')).toBeVisible();
    await expect(a.page.locator('#broadcast')).toContainText('甲 淘汰了 乙');
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'kill');
    const scores = (await state(a.page)).players;
    expect(scores.find((p) => p.name === '甲')).toMatchObject({ score: 4, kills: 1, deaths: 0 });
    expect(scores.find((p) => p.id === idB)).toMatchObject({ score: 0, kills: 0, deaths: 1 });
    await expect(a.page.locator('#leaderboard-rows li').first()).toContainText('甲');
    // The leader carries the 淘汰王 title on the board.
    await expect(a.page.locator('#leaderboard-rows li').first().locator('.title')).toHaveText('淘汰王');

    // Respawned by the server after the timeout, somewhere else, and visible again to the thrower.
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 6_000 }).toBe(true);
    const [x, , z] = await b.page.evaluate(() => window.__MOONSHOT__!.position());
    expect(Math.hypot(x + 40.3, z - 39.6)).toBeGreaterThan(3);
    await expect(b.page.locator('#eliminated')).toBeHidden();

    // Leaving is seen by the other player.
    await b.page.context().close();
    await expect.poll(async () => (await state(a.page)).players.length, { timeout: 10_000 }).toBe(1);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
});
