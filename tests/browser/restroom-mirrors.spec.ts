import { expect, test } from '@playwright/test';

import { enterCampus, enterHome } from './support';

test('every polygonal restroom has a mirror and the nearby facing mirror renders the player rig', async ({ page }) => {
    await page.goto('/');
    await enterHome(page);

    const mirrors = await page.evaluate(() => window.__MOONSHOT__!.dressing.mirrors);
    expect(mirrors).toHaveLength(14);
    expect(mirrors.map(({ roomId }) => roomId)).toContain('WC-04');
    const facts = await page.locator('.match-facts').innerText();
    expect(facts).not.toContain('身体两次');
    expect(facts).not.toContain('复活');

    await enterCampus(page);
    const mirror = mirrors.find(({ roomId }) => roomId === 'WC-04')!;
    const [x, , z] = mirror.position;
    const [nx, , nz] = mirror.normal;
    await page.evaluate(
        ({ x, z, nx, nz }) => {
            window.__MOONSHOT__!.teleport(x + nx * 1.15, 0.92, z + nz * 1.15);
            window.__MOONSHOT__!.setLook(0, (Math.atan2(nx, nz) * 180) / Math.PI);
        },
        { x, z, nx, nz }
    );
    await expect
        .poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().restroomMirror.activeRoom))
        .toBe('WC-04');
    const state = await page.evaluate(() => window.__MOONSHOT__!.match.state().restroomMirror);
    expect(state.cameraEnabled).toBe(true);
    expect(state.reflectionEnabled).toBe(true);
    await page.screenshot({ path: '/tmp/moonshot-restroom-mirror.png' });
});
