import { expect, test } from '@playwright/test';

import { enterHome } from './support';

test('v0.26 visual QA: MVP, event cutscenes, final ceremony shutters and crowd wave', async ({ page }, testInfo) => {
    await page.goto('/?audioLab=1&offline=1');
    await enterHome(page);
    await page.getByRole('button', { name: /进入校园/ }).click();
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');

    const lab = page.locator('.audio-lab');
    const openLab = async () => {
        if (!(await lab.isVisible())) await page.locator('.audio-lab-toggle').evaluate((button: HTMLButtonElement) => button.click());
        await expect(lab).toBeVisible();
    };
    const closeLab = async () => {
        if (await lab.isVisible()) await lab.locator('[data-action="resume"]').click();
        await expect(lab).toBeHidden();
    };
    await openLab();
    await lab.locator('[data-result="golden-disc"]').click();
    await closeLab();
    await expect(page.locator('#ceremony')).toHaveAttribute('data-mode', 'mvp');
    await expect(page.locator('#mvp-name')).toContainText('你');
    await expect(page.locator('#mvp-initial')).toBeVisible();
    await page.waitForTimeout(2_800);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/mvp-golden.png' });
    const mvpCard = await page.locator('#mvp-card').boundingBox();
    const mvpName = await page.locator('#mvp-name').boundingBox();
    expect(mvpCard && mvpName && mvpName.x >= mvpCard.x && mvpName.x + mvpName.width <= mvpCard.x + mvpCard.width).toBe(true);
    await openLab();
    await lab.locator('[data-phase="gold-first"]').click();
    await closeLab();
    await expect(page.locator('#cutscene-caption')).toBeVisible();
    await expect(page.locator('#cutscene-caption')).toContainText('金飞盘易主');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/gold-first.png' });
    await page.waitForTimeout(3_800);
    await expect(page.locator('#cutscene-caption')).toBeHidden();

    await openLab();
    await lab.locator('[data-phase="last-two"]').click();
    await closeLab();
    await expect(page.locator('#cutscene-caption')).toContainText('最终二人对决');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/last-two.png' });
    await page.waitForTimeout(3_600);
    await expect(page.locator('#cutscene-caption')).toBeHidden();

    await openLab();
    await lab.locator('[data-phase="blackout"]').click();
    await closeLab();
    await expect(page.locator('#cutscene-caption')).toContainText('终局夜晚');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/blackout.png' });
    await page.keyboard.press('Space');
    await expect(page.locator('#cutscene-caption')).toBeHidden();

    await openLab();
    await lab.locator('[data-phase="reset"]').click();
    await lab.locator('[data-phase="breaker"]').click();
    await closeLab();
    await expect(page.locator('#cutscene-caption')).toContainText('配电室被拉闸');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/breaker.png' });
    await page.keyboard.press('Space');
    await expect(page.locator('#cutscene-caption')).toBeHidden();

    await openLab();
    await lab.locator('[data-phase="reset"]').click();
    await lab.locator('[data-phase="ceremony"]').click();
    await closeLab();
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.ceremony())).not.toBeNull();
    await page.waitForTimeout(6_000);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/final-ceremony-entry.png' });
    const early = await page.evaluate(() => window.__MOONSHOT__!.match.shuttersClosed());
    expect(early).toBe(false);
    await page.waitForTimeout(17_000);
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.shuttersClosed())).toBe(true);
    const probes = await page.evaluate(() => window.__MOONSHOT__!.match.shutterProbes());
    const rayHits = await page.evaluate((items) => items.map((probe) => window.__MOONSHOT__!.raycast(probe.from, probe.to)), probes);
    expect(rayHits.filter((hit) => hit?.includes('CeremonyShutterCollider')).length).toBe(probes.length);
    await page.screenshot({ path: '/tmp/moonshot-v026-visual/final-ceremony-shutters.png' });

    const frameSample = await page.evaluate(async () => {
        const samples: number[] = [];
        let previous = performance.now();
        await new Promise<void>((resolve) => {
            const start = performance.now();
            const frame = (now: number) => {
                samples.push(now - previous);
                previous = now;
                if (now - start >= 2_000) return resolve();
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        });
        const ordered = [...samples].sort((a, b) => a - b);
        const canvas = document.querySelector<HTMLCanvasElement>('#application-canvas')!;
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
        const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
        const scene = window.__MOONSHOT__!.match.ceremonyMetrics();
        return {
            frames: samples.length,
            medianMs: ordered[Math.floor(ordered.length * 0.5)] ?? 0,
            p95Ms: ordered[Math.floor(ordered.length * 0.95)] ?? 0,
            userAgent: navigator.userAgent,
            webglRenderer: debugInfo ? gl!.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'not exposed',
            viewport: [innerWidth, innerHeight],
            scene: { ...scene, totalVisibleActors: scene.entrantActors + scene.seatedSpectators },
            drawCallsPerFrame: window.__MOONSHOT__!.perf().drawCallsPerFrame
        };
    });
    expect(frameSample.scene.entrantActors).toBeGreaterThanOrEqual(5);
    expect(frameSample.scene.seatedSpectators).toBeGreaterThanOrEqual(14);
    expect(frameSample.scene.totalVisibleActors).toBeGreaterThanOrEqual(19);
    expect(frameSample.scene.spotlights).toBe(4);
    expect(frameSample.drawCallsPerFrame).toBeGreaterThan(0);
    await testInfo.attach('v026-ceremony-frame-sample.json', { body: Buffer.from(JSON.stringify(frameSample, null, 2)), contentType: 'application/json' });
    console.log(`V026_CEREMONY_FRAME_SAMPLE ${JSON.stringify(frameSample)}`);
});
