import { expect, test } from '@playwright/test';

import { enterAtSpawn, loadSimulated } from './support';

test('round-result cards render distinct victory, defeat and draw hierarchy', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    const cases = [
        {
            outcome: 'golden-disc' as const,
            mine: true,
            kicker: '金飞盘守擂',
            title: '你赢得了本局！',
            color: 'rgb(255, 194, 26)',
            capture: 'round-result-golden-win.png'
        },
        {
            outcome: 'last-survivor' as const,
            mine: true,
            kicker: '最终幸存者',
            title: '你赢得了本局！',
            color: 'rgb(139, 226, 168)',
            capture: 'round-result-survivor-win.png'
        },
        {
            outcome: 'golden-disc' as const,
            mine: false,
            kicker: '金飞盘守擂',
            title: '视觉验证玩家 赢得本局',
            color: 'rgb(255, 129, 115)',
            capture: 'round-result-loss.png'
        },
        {
            outcome: 'draw' as const,
            mine: false,
            kicker: '本局平局',
            title: '没有胜者',
            color: 'rgb(205, 213, 223)',
            capture: 'round-result-draw.png'
        }
    ];

    const card = page.locator('#round-end');
    for (const result of cases) {
        await page.evaluate(() => {
            document.querySelector<HTMLElement>('#round-end')!.hidden = true;
        });
        await page.evaluate(
            ({ outcome, mine }) => window.__MOONSHOT__!.showRoundResult(outcome, mine),
            result
        );
        await expect(card).toBeVisible();
        await expect(page.locator('#round-end-kicker')).toHaveText(result.kicker);
        await expect(page.locator('#round-end-title')).toHaveText(result.title);
        expect(await page.locator('#round-end-title').evaluate((element) => getComputedStyle(element).color)).toBe(
            result.color
        );
        await page.evaluate(() =>
            document.querySelector<HTMLElement>('#round-end')!.getAnimations().forEach((animation) => animation.finish())
        );
        await page.screenshot({ path: `test-results/${result.capture}` });
    }
});
