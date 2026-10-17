import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { collectErrors } from './support';

// Two players join the local shared-world room (wrangler dev) by typing a new username and password (one-step
// sign-in registers them). They see each other, chat, and one eliminates the other with frisbees; the server
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

/** Types a username and password and presses 进入校园: unknown names are registered on the spot. */
const enter = async (page: Page, name: string, password: string) => {
    await page.locator('#auth-name').fill(name);
    await page.locator('#auth-password').fill(password);
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect(page.locator('#operator')).toHaveAttribute('data-mode', 'signed');
    await expect(page.locator('#account-name')).toHaveText(name);
    await expect
        .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net), { timeout: 20_000 })
        .toBe('online');
};

const state = (page: Page) => page.evaluate(() => window.__MOONSHOT__!.match.state());

test('lifetime board shows eliminations and loss-only win-rate indices, including no recorded history', async ({
    page
}) => {
    const base = { deaths: 3, hits: 99, score: 999 };
    await page.route('**/api/leaderboard', (route) =>
        route.fulfill({
            json: {
                king: null,
                online: 0,
                top: [
                    { ...base, name: 'HalfWins', kills: 8, wins: 1, rounds: 2, losses: 1 },
                    { ...base, name: 'NoWins', kills: 7, wins: 0, rounds: 3, losses: 3 },
                    { ...base, name: 'NoHistory', kills: 6, wins: 0, rounds: 0, losses: 0 }
                ]
            }
        })
    );
    await page.goto(`/?server=${encodeURIComponent(SERVER)}`);
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    await page.getByRole('tab', { name: '排行榜' }).click();
    await expect(page.locator('.board-table th')).toHaveText(['#', '玩家', '淘汰数', '胜率指数']);
    await expect(page.locator('#board-rows tr').nth(0).locator('td')).toHaveText(['1', 'HalfWins', '8', '95.0%']);
    await expect(page.locator('#board-rows tr').nth(1).locator('td')).toHaveText(['2', 'NoWins', '7', '85.7%']);
    await expect(page.locator('#board-rows tr').nth(2).locator('td')).toHaveText(['3', 'NoHistory', '6', '100.0%']);
    await page.screenshot({ path: 'test-results/lifetime-leaderboard.png' });
});

test('accounts, chat, headshots and eliminations in the shared campus', async ({ browser, request }) => {
    const stamp = Date.now().toString(36).slice(-6);
    const nameA = `甲${stamp}`;
    // A fresh local room has no 淘汰王 yet; a reused dev server may already have a record holder.
    const kingBefore = (await (await request.get(`${API}/api/king`, { headers: ORIGIN })).json()).king;

    const nameB = `乙${stamp}`;
    // There is no guest entry: the title only offers username + password.
    const a = await open(browser);
    await expect(a.page.locator('#nickname')).toHaveCount(0);
    await expect(a.page.locator('.operator-tabs')).toHaveCount(0);
    // Missing password: refused locally, nothing sent.
    await a.page.locator('#auth-name').fill(nameA);
    await a.page.getByRole('button', { name: '进入校园' }).click();
    await expect(a.page.locator('#auth-error')).toHaveText('请输入用户名和密码');
    await enter(a.page, nameA, 'secret-123');
    // The same name with another password is now refused; the right password signs in again.
    const wrong = await request.post(`${API}/api/signin`, {
        data: { name: nameA, password: 'whatever1' },
        headers: ORIGIN
    });
    expect(wrong.status()).toBe(400);
    expect((await wrong.json()).error).toContain('密码不正确');
    const right = await request.post(`${API}/api/signin`, {
        data: { name: nameA, password: 'secret-123' },
        headers: ORIGIN
    });
    expect(await right.json()).toMatchObject({ created: false, account: { name: nameA } });

    const b = await open(browser);
    await enter(b.page, nameB, 'secret-456');
    const idA = (await state(a.page)).id;
    await expect
        .poll(async () => (await state(a.page)).players.map((p) => p.name).sort())
        .toEqual([nameA, nameB].sort());
    const idB = (await state(b.page)).id;

    // A round is running: the clock counts down from 10:00 and the golden disc lies at a spawn point, shown to all.
    const round = (await state(a.page)).round!;
    expect(round.phase).toBe('playing');
    await expect(a.page.locator('#round-clock')).toHaveText(/^(10:00|09:[0-5]\d)$/);
    await expect(b.page.locator('#round-gold')).toContainText(/无人持有|.+持有金飞盘/);
    await expect(a.page.locator('#latency')).toHaveText(/^\d+ ms$/);
    // Discs are ammunition, shown at the bottom (the local test room hands out extra).
    await expect(a.page.locator('#ammo-text')).toContainText('飞盘');

    // World chat reaches everyone in real time.
    await a.page.evaluate(() => window.__MOONSHOT__!.match.chat('大家好'));
    await expect(b.page.locator('#chat-log')).toContainText('大家好');
    await expect(b.page.locator('#chat-log')).toContainText(nameA);

    // Stand 6 m apart in the straight corridor north of M104.
    await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-46.3, 0.92, 39.6));
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    await Promise.all([
        a.page.evaluate(() => window.__MOONSHOT__!.setLook(0, 90)),
        b.page.evaluate(() => window.__MOONSHOT__!.setLook(0, -90))
    ]);
    await a.page.waitForTimeout(1_800);
    // Keep only the observing client rendered so the remote arm animation advances without doubling scene load.
    await b.page.evaluate(() => window.__MOONSHOT__!.setRendering(true));
    await b.page.evaluate(() => window.__MOONSHOT__!.setLook(0, 90));

    // First body hit: damaged, not out.
    const armBeforeThrow = await b.page.evaluate(
        (id) => window.__MOONSHOT__!.match.avatarJointRotation(id, 'upperarm_r'),
        idA
    );
    const damageFlash = b.page.locator('#damage.show').waitFor({ state: 'attached', timeout: 5_000 });
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 0.65, 39.6))).toBe(true);
    await expect
        .poll(() => b.page.evaluate((id) => window.__MOONSHOT__!.match.avatarAction(id), idA), { timeout: 1_000 })
        .toBe('Frisbee_Throw');
    await expect
        .poll(() => b.page.evaluate((id) => window.__MOONSHOT__!.match.avatarJointRotation(id, 'upperarm_r'), idA))
        .not.toEqual(armBeforeThrow);
    await b.page.screenshot({ path: 'test-results/combat-throw-release.png' });
    await expect
        .poll(
            async () => [
                (await state(b.page)).hp,
                (await state(a.page)).hitsClaimed,
                await a.page.evaluate((id) => window.__MOONSHOT__!.match.avatarAction(id), idB)
            ],
            { timeout: 5_000 }
        )
        .toEqual([1, 1, 'Hit_Chest']);
    expect((await state(a.page)).hitsPredicted).toBe(1);
    expect((await state(b.page)).alive).toBe(true);
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'hit');
    await expect(a.page.locator('#hitmarker')).not.toHaveAttribute('data-prediction');
    await damageFlash;
    await b.page.screenshot({ path: 'test-results/combat-victim-damage.png' });
    await a.page.screenshot({ path: 'test-results/combat-body-hit.png' });

    // Second hit (after the throw cooldown): eliminated and broadcast to everyone.
    await a.page.waitForTimeout(700);
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    await a.page.waitForTimeout(400);
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.2, 39.6))).toBe(true);
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 5_000 }).toBe(false);
    await expect(b.page.locator('#eliminated')).toBeVisible();
    await expect(a.page.locator('#broadcast')).toContainText(`${nameA} 淘汰了 ${nameB}`);
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'kill');
    expect(await a.page.evaluate((id) => window.__MOONSHOT__!.match.avatarAction(id), idB)).toBe('Death01');
    await a.page.screenshot({ path: 'test-results/combat-elimination.png' });
    const scores = (await state(a.page)).players;
    expect(scores.find((p) => p.name === nameA)).toMatchObject({ score: 1, kills: 1, deaths: 0 });
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

    // Ordinary throws have lift/drop: use the same verified 6 m passage, not the sniper's 10 m sight line.
    // An actual ordinary head hit must eliminate a full-health player in one hit.
    expect((await state(b.page)).hp).toBe(2);
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
    await a.page.waitForTimeout(1_800);
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.6, 39.6))).toBe(true);
    await expect
        .poll(
            async () => ({
                alive: (await state(b.page)).alive,
                hp: (await state(b.page)).hp,
                hitsClaimed: (await state(a.page)).hitsClaimed,
                position: await b.page.evaluate(() => window.__MOONSHOT__!.position())
            }),
            { timeout: 5_000 }
        )
        .toMatchObject({ alive: false, hp: 0, hitsClaimed: 3 });
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'kill');
    await expect(a.page.locator('#popup')).toContainText('爆头淘汰');
    await expect(b.page.locator('#popup')).toHaveText('被爆头淘汰');
    expect((await state(a.page)).players.find((p) => p.name === nameA)?.kills).toBe(2);

    // A fully aimed sniper headshot remains lethal too.
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 6_000 }).toBe(true);
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-36.3, 0.92, 39.6));
    await a.page.waitForTimeout(1_800);
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-36.3, 1.6, 39.6, undefined, true))).toBe(
        true
    );
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 5_000 }).toBe(false);
    await expect(a.page.locator('#hitmarker')).toHaveAttribute('data-kind', 'snipe');
    await expect(a.page.locator('#broadcast')).toContainText('狙击爆头');
    await expect(b.page.locator('#popup')).toHaveText('被狙击爆头');

    // A walks onto it: taken, equipped, and everyone sees who holds it.
    const gold = (await state(a.page)).gold!;
    expect(gold.holder).toBeNull();
    await a.page.evaluate(([x, z]) => window.__MOONSHOT__!.teleport(x + 0.5, 0.92, z), [gold.at[0], gold.at[2]]);
    await expect
        .poll(async () => (await state(b.page)).gold?.holder, { timeout: 5_000 })
        .toBe((await state(a.page)).id);
    await expect(b.page.locator('#round-gold')).toContainText(`${nameA} 持有金飞盘`);
    await expect(a.page.locator('#round-gold')).toContainText('你持有金飞盘');
    // An elimination with the golden disc gets its own banner.
    await expect.poll(async () => (await state(b.page)).alive, { timeout: 6_000 }).toBe(true);
    await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-36.3, 0.92, 39.6));
    await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-46.3, 0.92, 39.6));
    await a.page.waitForTimeout(1_800);
    expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-36.3, 1.6, 39.6, undefined, true))).toBe(
        true
    );
    await expect(b.page.locator('#gold-kill')).toBeVisible({ timeout: 5_000 });
    await expect(b.page.locator('#gold-kill')).toContainText(nameA);
    expect((await state(a.page)).gold?.holder).toBe((await state(a.page)).id);

    // Leaving is seen by the other player.
    await b.page.context().close();
    await expect.poll(async () => (await state(a.page)).players.length, { timeout: 10_000 }).toBe(1);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
});
