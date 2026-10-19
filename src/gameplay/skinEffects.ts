// Skin effects: each skin's flight trail and elimination effect, built from the shared particle pool (effects.ts),
// so they cost no new meshes or shaders. Trails are called at the disc trail cadence (~60 ms of flight); kill
// effects play on top of the usual elimination burst.
import { skinById } from '../config/skins';
import type { Skin } from '../config/skins';

import type { Effects } from './effects';
import type { V3 } from './frisbee';

type Rgb = [number, number, number];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const mix = (a: readonly number[], b: readonly number[], t: number): Rgb => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
];
const around = (radius: number): V3 => {
    const a = Math.random() * Math.PI * 2;
    return [Math.cos(a) * radius, 0, Math.sin(a) * radius];
};
const offset = (at: V3, d: V3): V3 => [at[0] + d[0], at[1] + d[1], at[2] + d[2]];

export const createSkinEffects = (effects: Effects) => {
    let tick = 0;
    const trail = (skin: Skin, at: V3, speed: number) => {
        tick++;
        const [main, accent] = skin.colours;
        const size = Math.max(0.04, Math.min(0.09, 0.04 + speed * 0.002));
        switch (skin.trail) {
            case 'glow':
                effects.mote(at, mix(main, [1, 1, 1], 0.3), [0, 0, 0], size, 0.28);
                break;
            case 'spark':
                effects.mote(at, mix(main, [1, 1, 1], 0.2), [0, 0, 0], size * 0.8, 0.22);
                if (tick % 2 === 0) effects.mote(at, accent as Rgb, [rand(-1.5, 1.5), rand(0.5, 2), rand(-1.5, 1.5)], 0.02, 0.35, 9);
                break;
            case 'pearl':
                effects.mote(at, mix(main, accent, Math.random()), [0, rand(0.1, 0.4), 0], size * 1.1, 0.5);
                break;
            case 'smoke':
                effects.mote(at, main as Rgb, [0, rand(0.2, 0.5), 0], size * 1.6, 0.55);
                if (tick % 3 === 0) effects.mote(at, accent as Rgb, [0, 0, 0], size * 0.6, 0.25);
                break;
            case 'thread':
                effects.mote(at, main as Rgb, [0, 0, 0], size * 0.55, 0.6);
                break;
            case 'chrome':
                effects.mote(at, mix(main, [1, 1, 1], 0.4), [0, 0, 0], size * 0.8, 0.3);
                if (tick % 4 === 0) effects.ring(at, main as Rgb, 0.12, 0.4, 1.4);
                break;
            case 'frost':
                effects.mote(at, main as Rgb, [0, 0, 0], size, 0.3);
                effects.mote(offset(at, around(0.12)), accent as Rgb, [rand(-0.2, 0.2), -0.4, rand(-0.2, 0.2)], 0.025, 0.8, 1.5);
                break;
            case 'neon': {
                const side = tick % 2 === 0 ? 1 : -1;
                effects.mote(offset(at, [0, 0.03 * side, 0]), (side > 0 ? main : accent) as Rgb, [0, 0, 0], size * 0.9, 0.42);
                break;
            }
            case 'ember':
                effects.mote(at, mix(main, accent, Math.random() * 0.5), [0, 0, 0], size, 0.3);
                effects.mote(at, accent as Rgb, [rand(-0.6, 0.6), rand(0.8, 1.8), rand(-0.6, 0.6)], rand(0.02, 0.035), rand(0.5, 0.9), -1.2);
                break;
            case 'glitter':
                effects.mote(at, main as Rgb, [0, 0, 0], size * 0.8, 0.3);
                for (let i = 0; i < 2; i++)
                    effects.mote(offset(at, around(rand(0.03, 0.15))), mix(main, accent, Math.random()), [0, -0.3, 0], 0.018, rand(0.4, 0.8), 0.8);
                break;
        }
    };

    const kill = (skin: Skin, at: V3) => {
        const [main, accent] = skin.colours;
        const density = Math.max(0.35, effects.intensity());
        const n = (count: number) => Math.max(4, Math.round(count * density));
        switch (skin.kill) {
            case 'ring':
                effects.ring(at, main as Rgb, 0.25, 0.6, 3);
                break;
            case 'sparks':
                for (let i = 0; i < n(26); i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = rand(6, 12);
                    effects.mote(at, i % 3 ? (accent as Rgb) : [1, 1, 1], [Math.cos(a) * s, rand(1, 6), Math.sin(a) * s], 0.025, rand(0.3, 0.6), 14);
                }
                effects.ring(at, main as Rgb, 0.2, 0.4, 2.4);
                break;
            case 'spiral':
                for (let i = 0; i < n(28); i++) {
                    const a = (i / 28) * Math.PI * 4;
                    const r = 0.5 + i * 0.03;
                    effects.mote(at, mix(main, accent, i / 28), [Math.cos(a) * r * 3, 1.2 + i * 0.12, Math.sin(a) * r * 3], 0.05, 0.9);
                }
                effects.ring(at, accent as Rgb, 0.2, 0.7, 2.8);
                break;
            case 'shards':
                for (let i = 0; i < n(18); i++) {
                    const a = Math.random() * Math.PI * 2;
                    effects.mote(at, i % 2 ? (main as Rgb) : (accent as Rgb), [Math.cos(a) * rand(3, 7), rand(2, 7), Math.sin(a) * rand(3, 7)], rand(0.05, 0.09), rand(0.6, 1), 12);
                }
                effects.ring(at, main as Rgb, 0.3, 0.5, 3.4);
                break;
            case 'lines':
                for (let k = 0; k < 3; k++) effects.ring(at, k === 1 ? (accent as Rgb) : (main as Rgb), 0.15 + k * 0.08, 0.6 + k * 0.25, 2.4 + k);
                for (let i = 0; i < n(12); i++) {
                    const a = (i / 12) * Math.PI * 2;
                    effects.mote(at, main as Rgb, [Math.cos(a) * 6, 0.4, Math.sin(a) * 6], 0.025, 0.5);
                }
                break;
            case 'chrome':
                for (let k = 0; k < 4; k++) effects.ring(offset(at, [0, k * 0.25, 0]), k % 2 ? (accent as Rgb) : (main as Rgb), 0.18, 0.55 + k * 0.1, 2 + k * 0.4);
                break;
            case 'shatter':
                for (let i = 0; i < n(30); i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = rand(3, 8);
                    effects.mote(at, i % 4 ? (main as Rgb) : (accent as Rgb), [Math.cos(a) * s, rand(1, 6), Math.sin(a) * s], rand(0.03, 0.07), rand(0.6, 1.1), 10);
                }
                effects.ring(at, accent as Rgb, 0.3, 0.45, 3.6);
                effects.ring(at, main as Rgb, 0.2, 0.9, 2);
                break;
            case 'glitch':
                for (let k = 0; k < 6; k++) {
                    const colour = (k % 2 ? accent : main) as Rgb;
                    effects.ring(offset(at, [rand(-0.25, 0.25), rand(-0.2, 0.6), rand(-0.25, 0.25)]), colour, rand(0.1, 0.25), rand(0.25, 0.6), rand(1.6, 3));
                }
                for (let i = 0; i < n(20); i++) {
                    const colour = (i % 2 ? accent : main) as Rgb;
                    effects.mote(offset(at, [rand(-0.6, 0.6), rand(-0.2, 1.2), rand(-0.6, 0.6)]), colour, [rand(-4, 4), 0, rand(-4, 4)], 0.04, rand(0.15, 0.4));
                }
                break;
            case 'eruption':
                for (let i = 0; i < n(36); i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = rand(0.5, 3);
                    effects.mote(at, mix(main, accent, Math.random()), [Math.cos(a) * s, rand(5, 11), Math.sin(a) * s], rand(0.04, 0.08), rand(0.8, 1.4), 9);
                }
                effects.ring(offset(at, [0, -0.6, 0]), main as Rgb, 0.4, 0.8, 3.2);
                break;
            case 'coins':
                for (let i = 0; i < n(30); i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = rand(2, 6);
                    effects.mote(at, i % 3 ? (main as Rgb) : (accent as Rgb), [Math.cos(a) * s, rand(4, 9), Math.sin(a) * s], rand(0.05, 0.08), rand(0.9, 1.4), 11);
                }
                effects.ring(at, accent as Rgb, 0.35, 0.6, 3.4);
                effects.ring(at, main as Rgb, 0.2, 1, 2.2);
                break;
        }
    };

    return {
        /** One sample of a skinned disc's flight trail; false when the skin is unknown (draw the default tracer). */
        trail(skinId: string | null | undefined, at: V3, speed: number) {
            const skin = skinById(skinId);
            if (!skin) return false;
            trail(skin, at, speed);
            return true;
        },
        /** A skinned disc's elimination effect at the victim. */
        kill(skinId: string | null | undefined, at: V3) {
            const skin = skinById(skinId);
            if (skin) kill(skin, at);
        }
    };
};

export type SkinEffects = ReturnType<typeof createSkinEffects>;
