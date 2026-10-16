// Sun, ambient, post-processing and the pooled interior lights. Uses the engine's upstream CameraFrame script;
// pooled omni lights follow the player so hundreds of fixtures cost a fixed light budget.
import type { AppBase } from 'playcanvas';
import { Color, Entity, Vec3 } from 'playcanvas';
import { CameraFrame } from 'playcanvas/scripts/esm/camera-frame.mjs';

import { createSkyDome } from './sky';

export const LIGHT_POOL_SIZE = 14;
const POOL_REFRESH_SECONDS = 0.25;

export const setupAtmosphere = (app: AppBase, camera: Entity) => {
    // Interior-first lighting: neutral ambient plus pooled fixtures. A sky environment map was tried and tinted every
    // interior surface blue through image-based lighting, so the sky is an unlit dome seen above the open-air arena, courtyards and entrances.
    app.scene.ambientLight = new Color(0.55, 0.54, 0.52);
    app.scene.exposure = 1.1;
    camera.camera!.clearColor = new Color(0.56, 0.72, 0.9);
    createSkyDome(app, camera);

    const sun = new Entity('sun');
    sun.addComponent('light', {
        type: 'directional',
        color: new Color(1, 0.95, 0.86),
        intensity: 0.55,
        castShadows: false
    });
    sun.setEulerAngles(55, 140, 0);
    app.root.addChild(sun);

    if (!camera.script) camera.addComponent('script');
    const frame = camera.script!.create(CameraFrame) as CameraFrame | null;
    if (frame) {
        frame.rendering.toneMapping = 'aces';
        // The frame renders into its own target, so the canvas antialias does not apply: without MSAA, fine
        // repeating detail (ceiling grid, plank seams, court lines, mullions) aliases into moiré at a distance.
        frame.rendering.samples = 4;
        // SSAO is left off: in testing it blacked out whole distant wall faces (both 'combine' and 'lighting').
        frame.bloom.enabled = true;
        frame.bloom.intensity = 0.004;
        frame.vignette.enabled = true;
        frame.vignette.intensity = 0.25;
    }
    return { sun };
};

/**
 * A fixed pool of omni lights, re-assigned a few times per second to the light fixtures nearest the player.
 * Fixtures are [x, z, ceilingHeight, kind] (kind 0 room, 1 corridor).
 */
export const createLightPool = (app: AppBase, fixtures: [number, number, number, number][]) => {
    const pool = Array.from({ length: LIGHT_POOL_SIZE }, (_, index) => {
        const light = new Entity(`pooled-light-${index}`);
        light.addComponent('light', {
            type: 'omni',
            color: new Color(1, 0.94, 0.84),
            intensity: 0,
            range: 7,
            castShadows: false
        });
        app.root.addChild(light);
        return light;
    });
    let elapsed = POOL_REFRESH_SECONDS;
    const position = new Vec3();
    const update = (deltaTime: number, player: Vec3) => {
        elapsed += deltaTime;
        if (elapsed < POOL_REFRESH_SECONDS) return;
        elapsed = 0;
        const nearest = fixtures
            .map((fixture) => ({ fixture, distance: Math.hypot(fixture[0] - player.x, fixture[1] - player.z) }))
            .filter((entry) => entry.distance < 24)
            .sort((a, b) => a.distance - b.distance)
            .slice(0, LIGHT_POOL_SIZE);
        pool.forEach((light, index) => {
            const entry = nearest[index];
            if (!entry) {
                light.light!.intensity = 0;
                return;
            }
            const [x, z, height, kind] = entry.fixture;
            position.set(x, height - 0.35, z);
            light.setPosition(position);
            light.light!.range = kind === 1 ? 8 : 7;
            light.light!.intensity = 1.4;
        });
    };
    return { update, pool };
};
