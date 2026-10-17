import { expect, test } from '@playwright/test';

import { advance, collectErrors, enterAtSpawn, enterCampus, hold, loadSimulated, position, walk } from './support';

const horizontal = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('reduced-flash damage cues fade away instead of leaving a persistent screen tint', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    await page.evaluate(() => {
        document.querySelector<HTMLElement>('#app-ui')!.dataset.reducedFlashes = 'true';
        document.querySelector('#damage')!.classList.add('show');
        document.querySelector('#damage-dir')!.classList.add('show');
    });
    const feedback = await page.evaluate(() => {
        const damage = document.querySelector<HTMLElement>('#damage')!;
        const direction = document.querySelector<HTMLElement>('#damage-dir')!;
        return {
            durations: [damage, direction].map((element) => element.getAnimations()[0]?.effect?.getTiming().duration),
            peaks: [damage, direction].map((element) => getComputedStyle(element).getPropertyValue('--damage-peak').trim())
        };
    });
    expect(feedback.durations).toEqual([280, 280]);
    expect(feedback.peaks).toEqual(['0.26', '0.34']);
    await page.evaluate(() => {
        document.querySelector('#damage')!.getAnimations()[0].finish();
        document.querySelector('#damage-dir')!.getAnimations()[0].finish();
    });
    expect(await page.locator('#damage').evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
    expect(await page.locator('#damage-dir').evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
});

test('final-arena relocation callback runs behind the transition curtain', async ({ page }) => {
    await loadSimulated(page);
    await page.evaluate(() => {
        window.__MOONSHOT__!.sceneTransition(() => {
            document.documentElement.dataset.relocationMaskOpacity = getComputedStyle(
                document.querySelector('#arena-transition')!
            ).opacity;
            document.documentElement.dataset.relocated = 'true';
        });
    });
    await advance(page, 180);
    await expect.poll(() => page.locator('html').getAttribute('data-relocated')).toBe('true');
    const coveredOpacity = Number(await page.locator('html').getAttribute('data-relocation-mask-opacity'));
    expect(coveredOpacity).toBeGreaterThanOrEqual(0.95);
    await advance(page, 220);
    await expect(page.locator('#arena-transition')).not.toHaveAttribute('data-phase', /.+/);
    expect(await page.locator('#arena-transition').evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
});

test('enter the real FF-01 scene, move, sprint, look, jump, pause, resume and recover', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    const initial = await page.evaluate(() => ({
        position: window.__MOONSHOT__!.position(),
        colliders: window.__MOONSHOT__!.collisionCount,
        barriers: window.__MOONSHOT__!.barrierWalls
    }));
    expect(initial.colliders).toBe(13);
    expect(initial.barriers).toBeGreaterThan(1000);
    const dressing = await page.evaluate(() => window.__MOONSHOT__!.dressing);
    expect(dressing.doors).toBeGreaterThan(100);
    expect(dressing.lights).toBeGreaterThan(500);
    expect(initial.position[0]).toBeCloseTo(-8.7, 1);
    expect(initial.position[1]).toBeGreaterThan(0.75);
    expect(initial.position[1]).toBeLessThan(1.05);
    expect(initial.position[2]).toBeCloseTo(46.3, 1);

    await enterAtSpawn(page);
    await page.evaluate(() => window.__MOONSHOT__!.match.setTeacherGrace(60_000));
    await advance(page, 500);
    await expect(page.locator('#location-code')).toContainText('南入口门厅');
    await expect(page.locator('#location-name')).toHaveText('ENTRANCE-SOUTH');
    // No exploration log: no 新发现 tag and no discovery toast.
    await expect(page.locator('#location .new-tag')).toHaveCount(0);
    await expect(page.locator('#progress-label')).toHaveCount(0);

    // F inspects the disc in hand; it plays out and returns to the ready pose.
    await page.keyboard.press('f');
    expect(await page.evaluate(() => window.__MOONSHOT__!.match.state().inspecting)).toBe(true);
    await advance(page, 2600);
    expect(await page.evaluate(() => window.__MOONSHOT__!.match.state().inspecting)).toBe(false);

    // Holding the throw button past a flick aims: the view zooms in gradually to the sniper scope.
    const fov = () => page.evaluate(() => window.__MOONSHOT__!.fov());
    const normalFov = await fov();
    await page.mouse.down();
    await advance(page, 150);
    expect(await page.evaluate(() => window.__MOONSHOT__!.match.state().aim)).toBe(0);
    await advance(page, 450);
    const halfway = await fov();
    expect(halfway).toBeLessThan(normalFov);
    await expect(page.locator('#scope')).toHaveAttribute('data-ready', 'false');
    await advance(page, 600);
    expect(await fov()).toBeLessThan(halfway);
    expect(await fov()).toBeCloseTo(normalFov * 0.36, 0);
    await expect(page.locator('#scope')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#scope-state')).toContainText('狙击就绪');
    // Right-click stands down without throwing; the view zooms back out.
    const throwsBefore = (await page.evaluate(() => window.__MOONSHOT__!.match.state())).throws;
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await page.mouse.up();
    await advance(page, 500);
    expect(await fov()).toBeCloseTo(normalFov, 0);
    expect((await page.evaluate(() => window.__MOONSHOT__!.match.state())).throws).toBe(throwsBefore);

    // 纪老师: just stepping into his circle means standing still for 4 s, with a warning (no throw needed).
    await page.evaluate(() => window.__MOONSHOT__!.match.setTeacherGrace(0));
    const teacher = await page.evaluate(() => window.__MOONSHOT__!.match.teacher());
    const facing = (teacher.yaw * Math.PI) / 180;
    await page.evaluate(
        ([x, z, yaw]) => {
            window.__MOONSHOT__!.teleport(x, 0.92, z);
            window.__MOONSHOT__!.setLook(0, yaw);
        },
        [teacher.x - Math.sin(facing) * 3, teacher.z - Math.cos(facing) * 3, teacher.yaw + 180]
    );
    await advance(page, 300);
    expect((await page.evaluate(() => window.__MOONSHOT__!.match.state())).detained).toBe(true);
    await advance(page, 100);
    await expect(page.locator('#detention')).toBeVisible();
    await expect(page.locator('#detention')).toContainText('室内不准打飞盘');
    const caughtAt = await position(page);
    await hold(page, ['KeyW'], 1500);
    expect(horizontal(await position(page), caughtAt)).toBeLessThan(0.2);
    expect(await page.evaluate(() => window.__MOONSHOT__!.stuckShown())).toBe(false);
    await expect(page.locator('#unstuck')).toBeHidden();
    await advance(page, 2900);
    await expect(page.locator('#detention')).toBeHidden();
    await page.evaluate(() => window.__MOONSHOT__!.match.setTeacherGrace(60_000));
    await hold(page, ['KeyW'], 600);
    expect(horizontal(await position(page), caughtAt)).toBeGreaterThan(0.5);
    await page.evaluate(() => window.__MOONSHOT__!.teleport(-8.7, 0.92, 46.3));
    await advance(page, 300);

    await page.keyboard.press('m');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-map', 'open');
    await page.keyboard.press('m');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-map', 'closed');

    const start = await position(page);
    await hold(page, ['w'], 500);
    const walked = await position(page);
    const walkDistance = horizontal(walked, start);
    expect(walkDistance).toBeGreaterThan(0.8);
    await advance(page, 350);
    expect(horizontal(await position(page), walked)).toBeLessThan(1);

    const sprintStart = await position(page);
    await hold(page, ['Shift', 'w'], 500);
    expect(horizontal(await position(page), sprintStart)).toBeGreaterThan(walkDistance * 1.25);

    const lookBefore = await page.evaluate(() => window.__MOONSHOT__!.cameraAngles());
    await page.locator('#application-canvas').dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        movementX: 120,
        movementY: 0
    });
    await advance(page, 100);
    const lookAfter = await page.evaluate(() => window.__MOONSHOT__!.cameraAngles());
    expect(Math.abs(lookAfter[1] - lookBefore[1])).toBeGreaterThan(1);

    await advance(page, 500);
    const floorY = (await position(page))[1];
    await hold(page, ['Space'], 220);
    expect((await position(page))[1] - floorY).toBeGreaterThan(0.2);
    await advance(page, 1_500);
    const landedY = (await position(page))[1];
    expect(landedY).toBeGreaterThan(0.72);
    expect(landedY).toBeLessThan(1.1);

    await page.keyboard.press('Escape');
    await expect(page.locator('#app-ui')).toHaveAttribute('data-screen', 'paused');
    await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.locator('#camera-motion').selectOption('off');
    expect((await page.evaluate(() => window.__MOONSHOT__!.match.state())).cameraMotionScale).toBe(0);
    await page.locator('#effects-quality').selectOption('low');
    await page.locator('#reduced-flashes').check();
    await page.locator('#master-volume').fill('0.45');
    await expect
        .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('moonshot-open-world.settings.v1') ?? '{}')))
        .toMatchObject({ cameraMotion: 'off', effectsQuality: 'low', reducedFlashes: true, masterVolume: 0.45 });
    await enterCampus(page);

    // R teleports to the middle of the 莲花球场.
    await page.keyboard.press('r');
    await advance(page, 100);
    await expect(page.locator('#toast')).toContainText('莲花球场');
    await advance(page, 600);
    await expect(page.locator('#location-code')).toContainText('莲花球场');
    expect(errors).toEqual([]);
});

test('special locations are pinned on the map and the S103 monitor requires a focused click', async ({ page }) => {
    await loadSimulated(page);
    await enterAtSpawn(page);
    const locations = await page.evaluate(() => window.__MOONSHOT__!.match.markers().specialLocations);
    expect(locations.map(({ id }) => id)).toEqual(['breaker', 'monitor', 'pe-office']);

    await page.evaluate(() => {
        window.__MOONSHOT__!.teleport(-43.6, 0.92, 11.169);
    });
    await advance(page, 500);
    await page.evaluate(() => {
        const [x, y, z] = window.__MOONSHOT__!.match.cameraPosition();
        const dx = -41.875 - x;
        const dy = 1.2 - y;
        const dz = 11.169 - z;
        const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
        const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
        window.__MOONSHOT__!.setLook(pitch, yaw);
    });
    await advance(page, 100);
    await expect(page.locator('#location-code')).toHaveText('S103');
    await expect(page.locator('#radar')).toBeHidden();
    expect(await page.evaluate(() => window.__MOONSHOT__!.match.monitorFocused())).toBe(true);
    await expect(page.locator('#interaction')).toContainText('点击电脑');
    await page.mouse.click(640, 360);
    await advance(page, 100);
    await expect(page.locator('#radar')).toBeVisible();
    await expect(page.locator('#radar')).toContainText('监控画面');
});

test('open entrances and the top seat row do not lead out of the level; a fall is recovered', async ({ page }) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterAtSpawn(page);

    // The east entrance has no source wall: the slab ends at x≈67.5. The authored barrier stops the capsule there.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(50.85, 0.92, -2.86));
    await walk(page, 1, 0, 15_000);
    const atEntrance = await position(page);
    expect(atEntrance[0]).toBeGreaterThan(65);
    expect(atEntrance[0]).toBeLessThan(67.5);
    expect(atEntrance[1]).toBeGreaterThan(0.75);

    // Top seat row (3.11 m) is higher than the 2.8 m wall 0.32 m behind it; pushing west must not cross the wall.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(-30.7, 4.3, -0.4));
    await advance(page, 500);
    const onSeat = await position(page);
    expect(onSeat[1]).toBeGreaterThan(3.8);
    await walk(page, -1, 0, 4_000);
    expect((await position(page))[0]).toBeGreaterThan(-31.2);

    // The presented 3.6 m walls collide above the 2.8 m source height, and the arena perimeter wall stands to 10 m.
    const hits = await page.evaluate(() => ({
        wallLow: window.__MOONSHOT__!.raycast([22.5, 1.5, -3], [19.5, 1.5, -3]),
        wallHigh: window.__MOONSHOT__!.raycast([22.5, 3.3, -3], [19.5, 3.3, -3]),
        aboveWall: window.__MOONSHOT__!.raycast([22.5, 3.75, -3], [19.5, 3.75, -3]),
        arenaWall: window.__MOONSHOT__!.raycast([-8, 8, -3], [-45, 8, -3])
    }));
    expect(hits.wallLow).toBe('Walls');
    expect(hits.wallHigh).toBe('Walls');
    expect(hits.aboveWall).not.toBe('Walls');
    expect(hits.arenaWall).toBe('GameplayAuthored_ArenaWallCollider');

    // Anything that still leaves the level is returned to the safe spawn automatically.
    await page.evaluate(() => window.__MOONSHOT__!.teleport(80, 1, 0));
    await advance(page, 2_000);
    expect(await page.evaluate(() => window.__MOONSHOT__!.recoveries())).toBe(1);
    expect(horizontal(await position(page), [-8.7, 0, 46.3])).toBeLessThan(0.2);
    await expect(page.locator('#toast')).toContainText('已回到南入口');
    expect(errors).toEqual([]);
});

test('pushing into a wall for a while offers the unstuck escape, which returns to the south entrance', async ({
    page
}) => {
    const errors = collectErrors(page);
    await loadSimulated(page);
    await enterAtSpawn(page);
    // Walk east into the authored barrier at the open east entrance and keep pushing.
    await page.evaluate(() => {
        window.__MOONSHOT__!.teleport(65.5, 0.92, -2.86);
        window.__MOONSHOT__!.setLook(0, -90);
    });
    await advance(page, 300);
    await page.keyboard.down('w');
    await advance(page, 3_000);
    const pushed = await position(page);
    await page.keyboard.up('w');
    expect(await page.evaluate(() => window.__MOONSHOT__!.stuckShown()), `at ${pushed}`).toBe(true);
    await expect(page.locator('#unstuck')).toBeVisible();
    await page.keyboard.press('g');
    await advance(page, 200);
    expect(horizontal(await position(page), [-8.7, 0, 46.3])).toBeLessThan(0.2);
    await expect(page.locator('#unstuck')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('已脱离卡死');
    expect(errors).toEqual([]);
});
