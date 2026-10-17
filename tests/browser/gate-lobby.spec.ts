import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterCampus, hold, loadSimulated, position } from './support';

test('offline lobby starts outside and crossing the pillar turnstile joins the round', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page, '/?offline=1&lobby=1&noIntro=1');
    const initial = await position(page);
    expect(initial[2]).toBeGreaterThan(53.46);
    expect(initial[2]).toBeLessThanOrEqual(57.32);
    await enterCampus(page);

    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().phase)).toBe('lobby');
    const spawn = await position(page);
    expect(spawn[2]).toBeGreaterThan(55);

    // Spawn faces north. The gate line is z=53.46, directly beside the pillar shown in the supplied screenshot.
    await hold(page, ['w'], 1_000);
    await advance(page, 100);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().phase)).toBe('playing');
    expect((await position(page))[2]).toBeLessThan(53.1);
    expect(errors).toEqual([]);
});
