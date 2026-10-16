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
};

const POOL = 96;

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
        return { entity, material, life: 0, age: 0, v: [0, 0, 0] as V3, spin: [0, 0, 0] as V3, size: 0, ring };
    };
    for (let i = 0; i < POOL; i++) free.push(make(i % 12 === 0));

    const take = (ring: boolean) => {
        const index = free.findIndex((p) => p.ring === ring);
        if (index >= 0) return free.splice(index, 1)[0];
        // Pool exhausted: recycle the oldest live particle of that kind.
        const oldest = particles.find((p) => p.ring === ring);
        if (!oldest) return null;
        particles.splice(particles.indexOf(oldest), 1);
        return oldest;
    };

    const emit = (at: V3, colour: [number, number, number], v: V3, size: number, life: number, ring = false) => {
        const p = take(ring);
        if (!p) return;
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
        /** A hit at `at`: shards in the thrower's colour; bigger, with a ring, when it eliminates; gold for the head. */
        burst(at: V3, hue: number, kind: 'hit' | 'head' | 'out') {
            const colour = kind === 'head' ? ([1, 0.82, 0.25] as [number, number, number]) : hueColour(hue);
            const count = kind === 'out' ? 22 : kind === 'head' ? 16 : 11;
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const up = Math.random() * 0.9 + 0.2;
                const speed = 2.5 + Math.random() * (kind === 'out' ? 5 : 3.5);
                emit(
                    at,
                    i % 4 === 0 ? [1, 1, 1] : colour,
                    [Math.cos(a) * speed, up * speed, Math.sin(a) * speed],
                    0.035 + Math.random() * 0.04,
                    0.45 + Math.random() * 0.3
                );
            }
            // A quick white flash at the impact.
            emit(at, [1, 1, 1], [0, 0, 0], 0.22, 0.12);
            if (kind !== 'hit') emit(at, colour, [0, 0, 0], 0.2, kind === 'out' ? 0.55 : 0.35, true);
        },
        /** One glowing mote of a sniper disc's tracer (call each frame along its path). */
        tracer(at: V3, hue: number) {
            const [r, g, b] = hueColour(hue);
            emit(at, [0.6 + r * 0.4, 0.6 + g * 0.4, 0.6 + b * 0.4], [0, 0, 0], 0.07, 0.28);
        },
        /** A sniper headshot: a tall gold flash and a wide ring on top of the elimination burst. */
        snipe(at: V3) {
            emit(at, [1, 0.85, 0.3], [0, 0, 0], 0.45, 0.18);
            emit(at, [1, 0.82, 0.25], [0, 0, 0], 0.35, 0.7, true);
            for (let i = 0; i < 10; i++) {
                const a = (i / 10) * Math.PI * 2;
                emit(at, [1, 0.9, 0.5], [Math.cos(a) * 7, 1.5 + Math.random() * 2, Math.sin(a) * 7], 0.05, 0.5);
            }
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
                    const s = p.size + t * 1.3;
                    p.entity.setLocalScale(s, s * 0.6, s);
                } else {
                    p.v[1] -= 9.8 * deltaTime;
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
