import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { collectErrors, enterHome } from './support';

const ROOM_PORT = process.env.MOONSHOT_TEST_ROOM_PORT ?? '8787';
const SERVER = `ws://127.0.0.1:${ROOM_PORT}/ws`;
const API = `http://127.0.0.1:${ROOM_PORT}`;
const open = async (browser: Browser, testRoom: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(`/?server=${encodeURIComponent(`${SERVER}?testRoom=${testRoom}`)}&lobby=1`);
    await enterHome(page);
    await page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
    return { page, errors };
};

const enter = async (page: Page, name: string) => {
    await page.locator('#auth-name').fill(name);
    await page.locator('#auth-password').fill('george-test-password');
    await page.getByRole('button', { name: '进入校园' }).click();
    await expect(page.locator('#operator')).toHaveAttribute('data-mode', 'signed');
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().net), { timeout: 20_000 }).toBe('online');
    await page.evaluate(() => window.__MOONSHOT__!.teleport(-8.25, 0.92, 52.9));
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().phase)).toBe('playing');
};

const state = (page: Page) => page.evaluate(() => window.__MOONSHOT__!.match.state());

test('two real clients complete the final authoritative elimination, authenticate at M103, and abort reboot', async ({ browser }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36).slice(-6);
    const a = await open(browser, `abort-${stamp}`);
    const b = await open(browser, `abort-${stamp}`);
    const nameA = `George甲${stamp}`;
    const nameB = `George乙${stamp}`;
    try {
        await enter(a.page, nameA);
        await enter(b.page, nameB);
        await expect(a.page.locator('.george-progress-heading strong')).toHaveText("GEORGE'S PASSWORD");
        await expect(a.page.locator('.george-progress-heading b')).toHaveText('0/10');
        const fixtureStatus = await a.page.evaluate(async ({ api, room }) => {
            const token = localStorage.getItem('moonshot.session');
            const response = await fetch(`${api}/api/__test/george-streak?testRoom=${room}`, {
                method: 'POST', headers: { authorization: `Bearer ${token}` }
            });
            return response.status;
        }, { api: API, room: `abort-${stamp}` });
        expect(fixtureStatus).toBe(200);
        await expect(a.page.locator('.george-progress-heading b')).toHaveText('9/10');
        await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-46.3, 0.92, 39.6));
        await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
        await a.page.waitForTimeout(2_500);
        // The launch is a real PlayCanvas disc. Local headless physics can produce a glancing miss,
        // so retry only the throw (never the server kill/progress) until the authoritative lethal hit lands.
        for (let attempt = 0; attempt < 8 && (await state(b.page)).alive; attempt++) {
            expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.75, 39.6))).toBe(true);
            await a.page.waitForTimeout(1_200);
        }
        await expect.poll(async () => (await state(a.page)).players.find((player) => player.name === nameA)?.kills).toBe(1);
        await expect.poll(async () => (await state(b.page)).alive, { timeout: 5_000 }).toBe(false);
        await expect(a.page.locator('.george-progress-heading b')).toHaveText('10/10');
        await expect(a.page.locator('.george-milestone')).toContainText('OBJECTIVE: M103 MAKERSPACE');
        await a.page.screenshot({ path: 'test-results/george-10-of-10.png' });
        await a.page.keyboard.press('p');
        const revealed = await a.page.locator('.george-code-toggle').textContent();
        const code = revealed?.match(/\b\d{6}\b/)?.[0];
        expect(code).toMatch(/^\d{6}$/);
        await expect(b.page.locator('body')).toContainText('CREDENTIAL BREACH DETECTED');

        await expect.poll(async () => (await state(b.page)).alive, { timeout: 8_000 }).toBe(true);
        await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.9, 0.92, 25.54));
        // Keep the second live player in terminal range, but out of the camera so the server-room evidence is visible.
        await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-38.7, 0.92, 25.54));
        await a.page.evaluate(() => window.__MOONSHOT__!.setLook(0, 90));
        await a.page.evaluate(() => window.__MOONSHOT__!.setRendering(true));
        await a.page.waitForTimeout(350);
        await expect(a.page.locator('.george-terminal-prompt')).toBeVisible();
        await expect(b.page.locator('.george-terminal-prompt')).toBeVisible();
        await a.page.screenshot({ path: 'test-results/george-m103-server-room.png' });
        await a.page.evaluate(() => window.__MOONSHOT__!.setRendering(false));
        await a.page.keyboard.press('e');
        await expect(a.page.getByRole('dialog', { name: 'GEORGE / SERVER CONSOLE' })).toBeVisible();
        await a.page.locator('.george-code-input').fill(code!);
        await a.page.keyboard.press('Enter');
        await expect(a.page.locator('.george-console-status')).toContainText('ACCESS GRANTED');
        await a.page.screenshot({ path: 'test-results/george-terminal-access.png' });
        await a.page.locator('.george-restart').click();
        await expect(a.page.locator('.george-confirm')).toBeVisible();
        await a.page.locator('.george-confirm').click();
        await expect(a.page.locator('.george-reboot')).toContainText('SERVER REBOOT INITIATED');
        await expect(b.page.locator('.george-reboot')).toContainText('SERVER REBOOT INITIATED');
        await expect(a.page.locator('.george-reboot strong')).toHaveText('00:10');
        await expect(b.page.locator('.george-reboot strong')).toHaveText('00:10');
        await a.page.screenshot({ path: 'test-results/george-reboot-countdown.png' });

        // Chromium can blur the backgrounded client while the other page is driven; resume it before the hold.
        await b.page.bringToFront();
        if (await b.page.locator('.screen-pause').isVisible()) await b.page.locator('#resume-button').click();
        await expect(b.page.locator('.george-disarm')).toBeVisible();
        await b.page.keyboard.down('e');
        await b.page.waitForTimeout(2_150);
        await b.page.keyboard.up('e');
        await expect(a.page.locator('body')).toContainText('SERVER REBOOT ABORTED');
        await expect(b.page.locator('body')).toContainText('SERVER REBOOT ABORTED');
        await a.page.screenshot({ path: 'test-results/george-reboot-aborted.png' });
        await expect(a.page.locator('.george-reboot')).toBeHidden();
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    } finally {
        await Promise.all([a.page.context().close(), b.page.context().close()]);
    }
});

test('two real clients see the simulated shutdown and the initiator receives the George victory', async ({ browser }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36).slice(-6);
    const a = await open(browser, `shutdown-${stamp}`);
    const b = await open(browser, `shutdown-${stamp}`);
    const nameA = `George胜${stamp}`;
    const nameB = `George负${stamp}`;
    try {
        await enter(a.page, nameA);
        await enter(b.page, nameB);
        const fixtureStatus = await a.page.evaluate(async ({ api, room }) => {
            const token = localStorage.getItem('moonshot.session');
            const response = await fetch(`${api}/api/__test/george-streak?testRoom=${room}`, {
                method: 'POST', headers: { authorization: `Bearer ${token}` }
            });
            return response.status;
        }, { api: API, room: `shutdown-${stamp}` });
        expect(fixtureStatus).toBe(200);
        await expect(a.page.locator('.george-progress-heading b')).toHaveText('9/10');
        await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-46.3, 0.92, 39.6));
        await b.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.3, 0.92, 39.6));
        await a.page.waitForTimeout(2_500);
        for (let attempt = 0; attempt < 8 && (await state(b.page)).alive; attempt++) {
            expect(await a.page.evaluate(() => window.__MOONSHOT__!.match.throwAt(-40.3, 1.75, 39.6))).toBe(true);
            await a.page.waitForTimeout(1_200);
        }
        await expect.poll(async () => (await state(a.page)).players.find((player) => player.name === nameA)?.kills).toBe(1);
        await expect.poll(async () => (await state(b.page)).alive, { timeout: 5_000 }).toBe(false);
        await expect(a.page.locator('.george-progress-heading b')).toHaveText('10/10');
        await a.page.keyboard.press('p');
        const revealed = await a.page.locator('.george-code-toggle').textContent();
        const code = revealed?.match(/\b\d{6}\b/)?.[0];
        expect(code).toMatch(/^\d{6}$/);
        await a.page.evaluate(() => window.__MOONSHOT__!.teleport(-40.9, 0.92, 25.54));
        await expect(a.page.locator('.george-terminal-prompt')).toBeVisible();
        await a.page.keyboard.press('e');
        await expect(a.page.getByRole('dialog', { name: 'GEORGE / SERVER CONSOLE' })).toBeVisible();
        await a.page.locator('.george-code-input').fill(code!);
        await a.page.keyboard.press('Enter');
        await expect(a.page.locator('.george-console-status')).toContainText('ACCESS GRANTED');
        await a.page.locator('.george-restart').click();
        await a.page.locator('.george-confirm').click();
        await expect(a.page.locator('.george-reboot')).toContainText('SERVER REBOOT INITIATED');
        await expect(b.page.locator('.george-reboot')).toContainText('SERVER REBOOT INITIATED');
        await a.page.screenshot({ path: 'test-results/george-shutdown-countdown.png' });
        await expect.poll(async () => (await state(a.page)).round?.outcome, { timeout: 45_000 }).toBe('george-reboot');
        await expect(a.page.locator('.george-blackout strong')).toHaveText('VICTORY', { timeout: 10_000 });
        await expect(a.page.locator('.george-blackout span')).toContainText('GEORGE PROTOCOL EXECUTED');
        await expect(b.page.locator('.george-blackout strong')).toHaveText('DEFEAT');
        await expect(b.page.locator('.george-blackout span')).toContainText('MATCH TERMINATED');
        await a.page.screenshot({ path: 'test-results/george-victory.png' });
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    } finally {
        await Promise.all([a.page.context().close(), b.page.context().close()]);
    }
});
