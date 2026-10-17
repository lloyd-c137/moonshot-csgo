// Sun, ambient, post-processing and the pooled interior lights. Uses the engine's upstream CameraFrame script;
// pooled omni lights follow the player so hundreds of fixtures cost a fixed light budget.
import type { AppBase, StandardMaterial } from 'playcanvas';
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
    const sky = createSkyDome(app, camera);

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
    /** Night: the sky darkens to a deep blue (emissive tint over the sky texture). */
    const setNight = (night: boolean) => {
        const material = sky.render!.meshInstances[0].material as StandardMaterial;
        material.emissive.set(...((night ? [0.08, 0.1, 0.18] : [1, 1, 1]) as [number, number, number]));
        material.update();
        camera.camera!.clearColor = night ? new Color(0.02, 0.03, 0.06) : new Color(0.56, 0.72, 0.9);
    };
    return { sun, setNight };
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
    let dark = false;
    let darkness = 0;
    let darknessFrom = 0;
    let darknessElapsed = 0;
    const fixtureMaterials = new Map<StandardMaterial, number>();
    const lightTargets = new Array<number>(pool.length).fill(0);
    const mixedAmbient = new Color(0.55, 0.54, 0.52);
    for (const render of app.root.findComponents('render')) {
        for (const instance of render.meshInstances) {
            const m = instance.material as StandardMaterial;
            if (m.name === 'light-panel' || /^M104-(led|rgb)/.test(m.name))
                fixtureMaterials.set(m, m.emissiveIntensity);
        }
    }
    const position = new Vec3();
    const update = (deltaTime: number, player: Vec3) => {
        const previousDarkness = darkness;
        if (darkness < 1 && dark || darkness > 0 && !dark) {
            darknessElapsed = Math.min(0.65, darknessElapsed + deltaTime);
            darkness = darknessFrom + ((dark ? 1 : 0) - darknessFrom) * (darknessElapsed / 0.65);
        }
        if (Math.abs(previousDarkness - darkness) > 0.001) {
            mixedAmbient.set(
                0.55 + (0.07 - 0.55) * darkness,
                0.54 + (0.08 - 0.54) * darkness,
                0.52 + (0.12 - 0.52) * darkness
            );
            app.scene.ambientLight = mixedAmbient;
            app.scene.exposure = 1.1 + (0.9 - 1.1) * darkness;
            for (const [material, intensity] of fixtureMaterials) {
                material.emissiveIntensity = intensity * (1 - darkness);
                material.update();
            }
        }
        pool.forEach((light, index) => {
            const current = light.light!.intensity;
            const target = lightTargets[index] * (1 - darkness);
            const next = current + (target - current) * Math.min(1, deltaTime * 10);
            light.light!.intensity = Math.abs(target - next) < 0.01 ? target : next;
        });
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
                lightTargets[index] = 0;
                return;
            }
            const [x, z, height, kind] = entry.fixture;
            position.set(x, height - 0.35, z);
            light.setPosition(position);
            light.light!.range = kind === 1 ? 8 : 7;
            lightTargets[index] = 1.4;
        });
    };
    /** Lights out (the blackout before the round's end) or back on. */
    const setDark = (value: boolean) => {
        if (value === dark) return;
        dark = value;
        darknessFrom = darkness;
        darknessElapsed = 0;
        elapsed = POOL_REFRESH_SECONDS; // re-apply on the next update
    };
    return { update, pool, setDark };
};
