// The 金飞盘 (golden disc) in the world: lying where it spawned or fell — big, hovering, spinning, throwing off
// sparks under a tall beam of light with a slow ground ring — or carried, when the beam follows its holder.
// Pooled meshes and the shared spark pool; no textures.
import type { AppBase, Entity as EntityType, Mesh as MeshType } from 'playcanvas';
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial } from 'playcanvas';

import type { GoldState } from '../net/protocol';
import { cylinder, place, torus } from '../render/shapes';
import type { Shape } from '../render/shapes';

import type { Effects } from './effects';
import type { V3 } from './frisbee';

export const GOLD_COLOUR: [number, number, number] = [1, 0.78, 0.24];

const meshOf = (app: AppBase, shape: Shape) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    mesh.incRefCount();
    return mesh;
};

/** Polished gold that also glows (the scene has no environment map, so real metal would read as black). */
export const createGoldMaterial = () => {
    const material = new StandardMaterial();
    material.name = 'gold-disc';
    material.diffuse = new Color(1, 0.74, 0.2);
    material.specular = new Color(1, 0.9, 0.6);
    material.gloss = 0.92;
    material.emissive = new Color(1, 0.62, 0.12);
    material.emissiveIntensity = 0.55;
    material.update();
    return material;
};

const glow = (colour: [number, number, number], intensity: number) => {
    const material = new StandardMaterial();
    material.useLighting = false;
    material.diffuse = new Color(0, 0, 0);
    material.emissive = new Color(...colour);
    material.emissiveIntensity = intensity;
    material.blendType = BLEND_ADDITIVE;
    material.depthWrite = false;
    material.cull = CULLFACE_NONE;
    material.update();
    return material;
};

export const createGold = (app: AppBase, discMesh: MeshType, effects: Effects) => {
    const material = createGoldMaterial();
    const disc = new Entity('gold-disc');
    disc.addComponent('render', { meshInstances: [new MeshInstance(discMesh, material)], castShadows: false });
    disc.setLocalScale(1.7, 1.7, 1.7);
    // Beam: a tall soft column (two nested cylinders) marking the disc — or its holder — from across the floor.
    const beam = new Entity('gold-beam');
    const beamMesh = meshOf(app, place(cylinder(0.32, 1, 24, false), { y: 0.5 }));
    const coreMesh = meshOf(app, place(cylinder(0.09, 1, 12, false), { y: 0.5 }));
    const beamMaterial = glow(GOLD_COLOUR, 0.22);
    const coreMaterial = glow([1, 0.92, 0.6], 0.55);
    beam.addComponent('render', {
        meshInstances: [new MeshInstance(beamMesh, beamMaterial), new MeshInstance(coreMesh, coreMaterial)],
        castShadows: false
    });
    // Ground ring under a lying disc.
    const ring = new Entity('gold-ring');
    const ringMaterial = glow(GOLD_COLOUR, 0.8);
    ring.addComponent('render', {
        meshInstances: [new MeshInstance(meshOf(app, torus(0.9, 0.03, 48, 6)), ringMaterial)],
        castShadows: false
    });
    for (const entity of [disc, beam, ring]) {
        entity.enabled = false;
        app.root.addChild(entity);
    }

    let state: GoldState | null = null;
    let sparkAt = 0;
    return {
        material,
        get state() {
            return state;
        },
        set(next: GoldState | null) {
            state = next;
        },
        /** Pickup or catch flourish at a point. */
        flourish(at: V3) {
            effects.ring(at, GOLD_COLOUR, 0.3, 0.6, 3.2);
            effects.ring(at, [1, 1, 1], 0.2, 0.35, 1.8);
            for (let i = 0; i < 24; i++) {
                const a = (i / 24) * Math.PI * 2;
                effects.mote(at, GOLD_COLOUR, [Math.cos(a) * 4, 2 + Math.random() * 3, Math.sin(a) * 4], 0.05, 0.7, 5);
            }
        },
        /**
         * Places the visuals: a lying disc at its spot, or the beam over the holder (`holderAt`: their capsule centre,
         * or null when the holder is this player — no beam in their own face).
         */
        update(now: number, holderAt: V3 | null, holderIsMe: boolean) {
            if (!state) {
                disc.enabled = beam.enabled = ring.enabled = false;
                return;
            }
            const lying = state.holder === null;
            const base: V3 | null = lying ? state.at : holderAt;
            disc.enabled = lying;
            ring.enabled = lying;
            beam.enabled = base !== null && !(holderIsMe && !lying);
            const pulse = 0.5 + 0.5 * Math.sin(now / 260);
            material.emissiveIntensity = 0.45 + pulse * 0.35;
            material.update();
            if (base) {
                beam.setPosition(base[0], base[1] - 0.9, base[2]);
                beam.setLocalScale(1 + pulse * 0.15, 40, 1 + pulse * 0.15);
                beamMaterial.emissiveIntensity = 0.16 + pulse * 0.1;
                beamMaterial.update();
            }
            if (lying) {
                const [x, y, z] = state.at;
                const hover = y + 0.25 + Math.sin(now / 420) * 0.12;
                disc.setPosition(x, hover, z);
                disc.setLocalEulerAngles(18 + Math.sin(now / 700) * 8, now / 6, 0);
                ring.setPosition(x, y - 0.86, z);
                const r = 1 + 0.25 * Math.sin(now / 300);
                ring.setLocalScale(r, 1, r);
                ring.setLocalEulerAngles(0, -now / 15, 0);
                // Sparkles rising around it, a few per frame.
                if (now - sparkAt > 30) {
                    sparkAt = now;
                    const a = Math.random() * Math.PI * 2;
                    const d = 0.25 + Math.random() * 0.4;
                    effects.mote(
                        [x + Math.cos(a) * d, hover - 0.1 + Math.random() * 0.3, z + Math.sin(a) * d],
                        Math.random() < 0.3 ? [1, 1, 1] : GOLD_COLOUR,
                        [Math.cos(a) * 0.3, 0.6 + Math.random() * 0.8, Math.sin(a) * 0.3],
                        0.025 + Math.random() * 0.03,
                        0.9 + Math.random() * 0.6
                    );
                }
            } else if (base && !holderIsMe && now - sparkAt > 60) {
                // A few sparks trail the holder too.
                sparkAt = now;
                effects.mote(
                    [
                        base[0] + (Math.random() - 0.5) * 0.6,
                        base[1] + Math.random() * 0.8,
                        base[2] + (Math.random() - 0.5) * 0.6
                    ],
                    GOLD_COLOUR,
                    [0, 0.8, 0],
                    0.03,
                    0.8
                );
            }
        },
        /** Everything drawn once (for shader warm-up), then hidden again by the next update. */
        showAll(at: V3) {
            for (const entity of [disc, beam, ring]) {
                entity.enabled = true;
                entity.setPosition(...at);
            }
        },
        entities: [disc, beam, ring] as EntityType[]
    };
};

export type Gold = ReturnType<typeof createGold>;
