import { expect, test } from '@playwright/test';

type PerformanceSample = {
    durationMs: number;
    frames: number;
    medianFrameMs: number;
    p95FrameMs: number;
    medianDrawCalls: number;
    p95DrawCalls: number;
    maxDrawCalls: number;
    userAgent: string;
    hardwareConcurrency: number;
    deviceMemoryGiB: number | null;
    viewport: number[];
    devicePixelRatio: number;
    webglRenderer: string;
};

test('solo idle and fixed-dummy impact performance sample (opt-in)', async ({ page }, testInfo) => {
    test.skip(process.env.COMBAT_PERF !== '1', 'Run explicitly with COMBAT_PERF=1; sample is machine-specific.');
    await page.goto('/?offline=1&audioLab=1');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'ready', { timeout: 90_000 });
    await expect(page.locator('.audio-lab-toggle')).toBeVisible();
    await page.getByRole('button', { name: /进入校园/ }).click();
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'play');
    await page.waitForTimeout(1_000);

    const sample = async (durationMs: number) =>
        page.evaluate(
            (sampleDurationMs) =>
                new Promise<PerformanceSample>((resolve) => {
                    const frameTimes: number[] = [];
                    const drawCalls: number[] = [];
                    const startedAt = performance.now();
                    let previous = startedAt;
                    const frame = (now: number) => {
                        frameTimes.push(now - previous);
                        previous = now;
                        drawCalls.push(window.__MOONSHOT__!.perf().drawCallsPerFrame);
                        if (now - startedAt >= sampleDurationMs) {
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
                                deviceMemoryGiB:
                                    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
                                viewport: [innerWidth, innerHeight],
                                devicePixelRatio,
                                webglRenderer: rendererInfo
                                    ? gl!.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
                                    : 'not exposed'
                            });
                            return;
                        }
                        requestAnimationFrame(frame);
                    };
                    requestAnimationFrame(frame);
                }),
            durationMs
        );
    const idle = await sample(2_000);

    await page.keyboard.press('p');
    await expect(page.locator('.audio-lab')).toBeVisible();
    await page.locator('[data-scenario="body"]').click();
    await expect(page.locator('#popup')).toHaveText('人偶 · 身体命中（1/2）');
    await page.locator('[data-action="resume"]').click();
    await expect.poll(() => page.evaluate(() => window.__MOONSHOT__!.match.state().practiceDummy?.hp)).toBe(1);
    await page.screenshot({ path: 'test-results/performance-body-hit.png' });
    const bodyImpact = await sample(2_000);

    await page.keyboard.press('p');
    await expect(page.locator('.audio-lab')).toBeVisible();
    await page.locator('[data-scenario="head"]').click();
    await expect(page.locator('#popup')).toHaveText('人偶 · 爆头淘汰');
    await page.locator('[data-action="resume"]').click();
    await page.screenshot({ path: 'test-results/performance-headshot.png' });
    const headshot = await sample(2_000);

    expect(idle.frames).toBeGreaterThan(30);
    expect(idle.maxDrawCalls).toBeGreaterThan(0);
    expect(bodyImpact.frames).toBeGreaterThan(30);
    expect(bodyImpact.maxDrawCalls).toBeGreaterThan(idle.p95DrawCalls);
    expect(headshot.frames).toBeGreaterThan(30);
    expect(headshot.maxDrawCalls).toBeGreaterThan(bodyImpact.p95DrawCalls);
    const report = {
        scenario: 'offline stationary campus, body hit and headshot elimination',
        idle,
        bodyImpact,
        headshot
    };
    await testInfo.attach('rendered-scene-performance-sample.json', {
        body: Buffer.from(JSON.stringify(report, null, 2)),
        contentType: 'application/json'
    });
    console.log(`RENDERED_SCENE_PERFORMANCE_SAMPLE ${JSON.stringify(report)}`);
});
