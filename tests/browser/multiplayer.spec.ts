import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { collectErrors } from './support';

// Two players join the local shared-world room (wrangler dev): one registers an account, the other plays as a guest.
// They see each other, chat, and one eliminates the other with frisbees (a headshot, then a body hit); the server
// scores it, records lifetime stats for the account, and respawns the target. Runs in real time.
const SERVER = 'ws://127.0.0.1:8787/ws';
const API = 'http://127.0.0.1:8787';
// The room only answers pages from allowed origins.
const ORIGIN = { origin: 'http://127.0.0.1:5174' };

const open = async (browser: Browser) => {
    const page = await (await browser.newContext()).newPage();
    const errors = collectErrors(page);
    await page.goto(`/?server=${encodeURIComponent(SERVER)}`);
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    return { page, errors };
};

const enter = async (page: Page) => {
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect
        .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net), { timeout: 20_000 })
        .toBe('online');
};

const state = (page: Page) => page.evaluate(() => window.__MOONSHOT__!.match.state());

test('accounts, chat, headshots and eliminations in the shared campus', async ({ browser, request }) => {
    const stamp = Date.now().toString(36).slice(-6);
    const nameA = `甲${stamp}`;
    // A fresh local room has no 淘汰王 yet; a reused dev server may already have a record holder.
    const kingBefore = (await (await request.get(`${API}/api/king`, { headers: ORIGIN })).json()).king;

    // A registers (username + password only) and is signed in on the title screen.
    const a = await open(browser);
    await a.page.locator('.operator-tabs button[data-mode="register"]').click();
    await a.page.locator('#auth-name').fill(nameA);
    await a.page.locator('#auth-password').fill('secret-123');
    await a.page.locator('#auth-submit').click();
    await expect(a.page.locator('#operator')).toHaveAttribute('data-mode', 'signed');
    await expect(a.page.locator('#account-name')).toHaveText(nameA);
    // Registering the same name again is refused.
    const again = await request.post(`${API}/api/register`, {
        data: { name: nameA, password: 'whatever1' },
        headers: ORIGIN
    });
    expect(again.status()).toBe(400);
    expect((await again.json()).error).toContain('已被注册');
    await enter(a.page);

    // B is a guest with a nickname.
    const b = await open(browser);
    await b.page.locator('#nickname').fill('乙');
    await enter(b.page);
    await expect
        .poll(async () => (await state(a.page)).players.map((p) => p.name).sort())
        .toEqual(['乙', nameA].sort());
    const idB = (await state(b.page)).id;

    // World chat reaches everyone in real time.
    await a.page.evaluate(() => window.__MOONSHOT__!.match.chat('大家好'));
    await expect(b.page.locator('#chat-log')).toContainText('大家好');
    await expect(b.page.locator('#chat-log')).toContainText(nameA);

    // Stand 6 m apart in the straight corridor north of M104.
    await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-46.3, 0.92, 39.6));
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    await a.page.waitForTimeout(1_800);

    // First hit to the head: damaged, not out; the thrower gets the head marker, the target's view is knocked up.
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.6, 39.6))).toBe(true);
    await expect
        .poll(async () => [(await state(b.page)).hp, (await state(a.page)).hitsClaimed], { timeout: 5_000 })
        .toEqual([1, 1]);
    expect((await state(b.page)).alive).toBe(true);
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'head');
    await expect(b.page.locator('#popup')).toHaveText('被爆头');

    // Second hit (after the throw cooldown): eliminated and broadcast to everyone.
    await a.page.waitForTimeout(700);
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    await a.page.waitForTimeout(400);
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.2, 39.6))).toBe(true);
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 5_000 }).toBe(false);
    await expect(b.page.locator('#eliminated')).toBeVisible();
    await expect(a.page.locator('#broadcast')).toContainText(`${nameA} 淘汰了 乙`);
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'kill');
    const scores = (await state(a.page)).players;
    expect(scores.find((p) => p.name === nameA)).toMatchObject({ score: 4, kills: 1, deaths: 0 });
    expect(scores.find((p) => p.id === idB)).toMatchObject({ score: 0, kills: 0, deaths: 1 });
    await expect(a.page.locator('#leaderboard-rows li').first()).toContainText(nameA);

    // The account's lifetime stats were saved on the server.
    const token = await a.page.evaluate(() => localStorage.getItem('moonshot.session'));
    const me = await (
        await request.get(`${API}/api/me`, { headers: { ...ORIGIN, authorization: `Bearer ${token}` } })
    ).json();
    expect(me.account).toMatchObject({ name: nameA, kills: 1, hits: 2 });

    if (!kingBefore) {
        // First elimination on a fresh server: A is crowned 淘汰王, announced in chat and shown on the board.
        await expect(a.page.locator('#king-line')).toContainText(nameA);
        await expect(a.page.locator('#leaderboard-rows li').first().locator('.title')).toHaveText('淘汰王');
        await expect(b.page.locator('#chat-log')).toContainText('新的淘汰王诞生');
        const king = (await (await request.get(`${API}/api/king`, { headers: ORIGIN })).json()).king;
        expect(king).toMatchObject({ name: nameA, kills: 1 });
    }

    // Respawned by the server after the timeout, somewhere else.
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
