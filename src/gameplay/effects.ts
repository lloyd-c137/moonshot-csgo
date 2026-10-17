// Hit effects in the world: a burst of shards in the thrower's colour plus a white flash, and an expanding ring on
// eliminations. Pooled mesh instances animated each frame (no particle system, no textures, no allocations per hit).
import type { AppBase } from 'playcanvas';
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial } from 'playcanvas';

import { box, place, torus } from '../render/shapes';
import type { Shape } from '../render/shapes';

import { hueColour } from './discs';
import type { V3 } from './frisbee';

type Particle = {
    entity: Entity;
    material: StandardMaterial;
    life: number;
    age: number;
    v: V3;
    spin: V3;
    size: number;
    ring: boolean;
    /** Downward acceleration (m/s²); motes float with 0 or negative. */
    gravity: number;
    /** Rings: how far they grow over their life (m). */
    grow: number;
};

const POOL = 192;

const meshOf = (app: AppBase, shape: Shape) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    return mesh;
};

export const createEffects = (app: AppBase) => {
    const shard = meshOf(app, box(1, 1, 1));
    const ringMesh = meshOf(app, place(torus(1, 0.06, 40, 6), {}));
    const particles: Particle[] = [];
    const free: Particle[] = [];
    let density = 0.65;
    let qualityDensity = 0.65;
    let labIntensity: number | null = null;
    let reducedFlashes = false;
    let tracerTick = 0;
    const make = (ring: boolean) => {
        const material = new StandardMaterial();
        material.useLighting = false;
        material.emissive = new Color(1, 1, 1);
        material.diffuse = new Color(0, 0, 0);
        material.blendType = BLEND_ADDITIVE;
        material.depthWrite = false;
        material.cull = CULLFACE_NONE;
        material.update();
        const entity = new Entity('hit-fx');
        entity.addComponent('render', {
            meshInstances: [new MeshInstance(ring ? ringMesh : shard, material)],
            castShadows: false
        });
        entity.enabled = false;
        app.root.addChild(entity);
        return {
            entity,
            material,
            life: 0,
            age: 0,
            v: [0, 0, 0] as V3,
            spin: [0, 0, 0] as V3,
            size: 0,
            ring,
            gravity: 9.8,
            grow: 1.3
        };
    };
    for (let i = 0; i < POOL; i++) free.push(make(i % 8 === 0));

    const take = (ring: boolean) => {
        const index = free.findIndex((p) => p.ring === ring);
        if (index >= 0) return free.splice(index, 1)[0];
        // Pool exhausted: recycle the oldest live particle of that kind.
        const oldest = particles.find((p) => p.ring === ring);
        if (!oldest) return null;
        particles.splice(particles.indexOf(oldest), 1);
        return oldest;
    };

    const emit = (
        at: V3,
        colour: [number, number, number],
        v: V3,
        size: number,
        life: number,
        ring = false,
        gravity = 9.8,
        grow = 1.3
    ) => {
        const p = take(ring);
        if (!p) return;
        p.gravity = gravity;
        p.grow = grow;
        p.material.emissive.set(...colour);
        p.material.update();
        p.entity.setPosition(...at);
        p.entity.setLocalScale(size, size, size);
        p.entity.enabled = true;
        p.v = v;
        p.spin = [Math.random() * 720, Math.random() * 720, Math.random() * 720];
        p.size = size;
        p.age = 0;
        p.life = life;
        particles.push(p);
    };

    return {
        /**
         * A hit at `at`: a hot white core flash, a fast shock ring, a spray of shards in the thrower's colour and
         * bright sparks that arc and fall. Head hits add a gold crown of sparks; eliminations a bigger double ring and
         * a burst of light thrown upward.
         */
        burst(at: V3, hue: number, kind: 'hit' | 'head' | 'out') {
            const colour = kind === 'head' ? ([1, 0.82, 0.25] as [number, number, number]) : hueColour(hue);
            const count = Math.max(4, Math.round((kind === 'out' ? 34 : kind === 'head' ? 26 : 18) * density));
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const up = Math.random() * 0.9 + 0.2;
                const speed = 3 + Math.random() * (kind === 'out' ? 7 : 5);
                emit(
                    at,
                    i % 3 === 0 ? [1, 1, 1] : colour,
                    [Math.cos(a) * speed, up * speed, Math.sin(a) * speed],
                    0.035 + Math.random() * 0.05,
                    0.45 + Math.random() * 0.35
                );
            }
            // Thin, fast sparks.
            for (let i = 0; i < Math.round((kind === 'hit' ? 8 : 14) * density); i++) {
                const a = Math.random() * Math.PI * 2;
                const speed = 8 + Math.random() * 6;
                emit(
                    at,
                    [1, 0.95, 0.8],
                    [Math.cos(a) * speed, 2 + Math.random() * 4, Math.sin(a) * speed],
                    0.02,
                    0.3,
                    false,
                    14
                );
            }
            // Core flash: big and short, then a softer afterglow.
            if (!reducedFlashes) emit(at, [1, 1, 1], [0, 0, 0], kind === 'hit' ? 0.32 : 0.45, 0.09, false, 0);
            emit(at, colour, [0, 0, 0], kind === 'hit' ? 0.22 : 0.32, 0.25, false, 0);
            // Shock ring on every hit; eliminations get a second, slower one.
            emit(at, [1, 1, 1], [0, 0, 0], 0.12, 0.22, true, 0, kind === 'hit' ? 1.4 : 2);
            if (kind !== 'hit') emit(at, colour, [0, 0, 0], 0.2, kind === 'out' ? 0.6 : 0.4, true, 0, 2.6);
            if (kind === 'head') {
                for (let i = 0; i < Math.round(12 * density); i++) {
                    const a = (i / 12) * Math.PI * 2;
                    emit(at, [1, 0.85, 0.3], [Math.cos(a) * 3, 5, Math.sin(a) * 3], 0.04, 0.55, false, 6);
                }
            }
            if (kind === 'out') {
                for (let i = 0; i < Math.round(10 * density); i++) {
                    emit(
                        at,
                        colour,
                        [(Math.random() - 0.5) * 1.2, 7 + Math.random() * 5, (Math.random() - 0.5) * 1.2],
                        0.06,
                        0.7,
                        false,
                        4
                    );
                }
            }
        },
        /** A floating mote (sparkles around the golden disc and similar): no gravity unless given. */
        mote(at: V3, colour: [number, number, number], v: V3, size: number, life: number, gravity = 0) {
            emit(at, colour, v, size, life, false, gravity);
        },
        /** An expanding ring (pickups, catches). */
        ring(at: V3, colour: [number, number, number], size: number, life: number, grow: number) {
            emit(at, colour, [0, 0, 0], size, life, true, 0, grow);
        },
        /** One glowing mote of a sniper disc's tracer (call each frame along its path). */
        tracer(at: V3, hue: number, speed = 16) {
            tracerTick++;
            if (density < 0.5 && tracerTick % 2 !== 0) return;
            // hue < 0: the golden disc's trail.
            const [r, g, b] = hue < 0 ? [1, 0.75, 0.2] : hueColour(hue);
            const size = Math.max(0.045, Math.min(0.1, 0.045 + speed * 0.002));
            emit(at, [0.6 + r * 0.4, 0.6 + g * 0.4, 0.6 + b * 0.4], [0, 0, 0], size, 0.24);
        },
        /** A sniper headshot: a tall gold flash and a wide ring on top of the elimination burst. */
        snipe(at: V3) {
            if (!reducedFlashes) emit(at, [1, 0.85, 0.3], [0, 0, 0], 0.45, 0.18);
            emit(at, [1, 0.82, 0.25], [0, 0, 0], 0.35, 0.7, true);
            for (let i = 0; i < Math.round(10 * density); i++) {
                const a = (i / 10) * Math.PI * 2;
                emit(at, [1, 0.9, 0.5], [Math.cos(a) * 7, 1.5 + Math.random() * 2, Math.sin(a) * 7], 0.05, 0.5);
            }
        },
        setQuality(quality: 'low' | 'medium' | 'high') {
            qualityDensity = quality === 'low' ? 0.35 : quality === 'medium' ? 0.65 : 1;
            density = labIntensity ?? qualityDensity;
        },
        /** Temporary developer-only override for repeatable visual comparisons. */
        setLabIntensity(value: number | null) {
            labIntensity = value === null ? null : Math.max(0, Math.min(1.5, value));
            density = labIntensity ?? qualityDensity;
        },
        intensity: () => density,
        setReducedFlashes(value: boolean) {
            reducedFlashes = value;
        },
        /** Ends every live particle at once. */
        clear() {
            for (const p of particles) {
                p.entity.enabled = false;
                free.push(p);
            }
            particles.length = 0;
        },
        update(deltaTime: number) {
            for (let index = particles.length - 1; index >= 0; index--) {
                const p = particles[index];
                p.age += deltaTime;
                const t = p.age / p.life;
                if (t >= 1) {
                    p.entity.enabled = false;
                    particles.splice(index, 1);
                    free.push(p);
                    continue;
                }
                if (p.ring) {
                    // Ring grows outward and thins.
                    const s = p.size + t * p.grow;
                    p.entity.setLocalScale(s, s * 0.6, s);
                } else {
                    p.v[1] -= p.gravity * deltaTime;
                    const pos = p.entity.getPosition();
                    p.entity.setPosition(
                        pos.x + p.v[0] * deltaTime,
                        pos.y + p.v[1] * deltaTime,
                        pos.z + p.v[2] * deltaTime
                    );
                    const s = p.size * (1 - t);
                    p.entity.setLocalScale(s, s, s);
                    p.entity.setLocalEulerAngles(p.spin[0] * p.age, p.spin[1] * p.age, p.spin[2] * p.age);
                }
                // Additive: fade by brightness.
                p.material.emissiveIntensity = 1 - t;
                p.material.update();
            }
        }
    };
};

export type Effects = ReturnType<typeof createEffects>;
