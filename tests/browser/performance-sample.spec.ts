import { expect, test } from '@playwright/test';

test('solo rendered-scene frame and draw-call sample (opt-in)', async ({ page }, testInfo) => {
    test.skip(process.env.COMBAT_PERF !== '1', 'Run explicitly with COMBAT_PERF=1; sample is machine-specific.');
    await page.goto('/?offline=1');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await page.getByRole('button', { name: /进入校园/ }).click();
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
    await page.waitForTimeout(1_000);

    const sample = await page.evaluate(
        () =>
            new Promise((resolve) => {
                const frameTimes: number[] = [];
                const drawCalls: number[] = [];
                const startedAt = performance.now();
                let previous = startedAt;
                const frame = (now: number) => {
                    frameTimes.push(now - previous);
                    previous = now;
                    drawCalls.push(window.__MOONSHOT__!.perf().drawCallsPerFrame);
                    if (now - startedAt >= 5_000) {
                        const sorted = [...frameTimes].sort((a, b) => a - b);
                        const drawSorted = [...drawCalls].sort((a, b) => a - b);
                        const percentile = (values: number[], fraction: number) =>
                            values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
                        const canvas = document.querySelector<HTMLCanvasElement>('#application-canvas')!;
                        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
                        const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
                        resolve({
                            durationMs: Math.round(now - startedAt),
                            frames: frameTimes.length,
                            medianFrameMs: percentile(sorted, 0.5),
                            p95FrameMs: percentile(sorted, 0.95),
                            medianDrawCalls: percentile(drawSorted, 0.5),
                            p95DrawCalls: percentile(drawSorted, 0.95),
                            maxDrawCalls: Math.max(...drawCalls),
                            userAgent: navigator.userAgent,
                            hardwareConcurrency: navigator.hardwareConcurrency,
                            deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
                            viewport: [innerWidth, innerHeight],
                            devicePixelRatio,
                            webglRenderer: rendererInfo ? gl!.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : 'not exposed'
                        });
                        return;
                    }
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            })
    );
    expect(sample.frames).toBeGreaterThan(30);
    expect(sample.maxDrawCalls).toBeGreaterThan(0);
    await testInfo.attach('solo-rendered-scene-sample.json', {
        body: Buffer.from(JSON.stringify(sample, null, 2)),
        contentType: 'application/json'
    });
    console.log(`SOLO_RENDERED_SCENE_SAMPLE ${JSON.stringify(sample)}`);
});
