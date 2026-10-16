// Discs lying on the floor (thrown and landed, or put out by the PE office): flat, slowly turning, with a soft
// pulsing ring so they are easy to spot and walk over to pick up. Drawn from the room's list.
import type { AppBase, Entity as EntityType, Mesh as MeshType } from 'playcanvas';
import { BLEND_ADDITIVE, Color, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial } from 'playcanvas';

import type { GroundDisc } from '../net/protocol';
import { torus } from '../render/shapes';

export const createGroundDiscs = (app: AppBase, discMesh: MeshType) => {
    const discMaterial = new StandardMaterial();
    discMaterial.diffuse = new Color(0.93, 0.95, 0.97);
    discMaterial.emissive = new Color(0.3, 0.55, 0.75);
    discMaterial.emissiveIntensity = 0.4;
    discMaterial.gloss = 0.6;
    discMaterial.update();
    const ringMaterial = new StandardMaterial();
    ringMaterial.useLighting = false;
    ringMaterial.diffuse = new Color(0, 0, 0);
    ringMaterial.emissive = new Color(0.55, 0.85, 1);
    ringMaterial.emissiveIntensity = 0.7;
    ringMaterial.blendType = BLEND_ADDITIVE;
    ringMaterial.depthWrite = false;
    ringMaterial.cull = CULLFACE_NONE;
    ringMaterial.update();
    const shape = torus(0.32, 0.012, 32, 4);
    const ringMesh = new Mesh(app.graphicsDevice);
    ringMesh.setPositions(shape.positions);
    ringMesh.setNormals(shape.normals);
    ringMesh.setIndices(shape.indices);
    ringMesh.update();
    ringMesh.incRefCount();

    const pool: { root: EntityType; disc: EntityType; ring: EntityType }[] = [];
    const make = () => {
        const root = new Entity('ground-disc');
        const disc = new Entity('ground-disc-mesh');
        disc.addComponent('render', { meshInstances: [new MeshInstance(discMesh, discMaterial)], castShadows: false });
        const ring = new Entity('ground-disc-ring');
        ring.addComponent('render', { meshInstances: [new MeshInstance(ringMesh, ringMaterial)], castShadows: false });
        root.addChild(disc);
        root.addChild(ring);
        root.enabled = false;
        app.root.addChild(root);
        return { root, disc, ring };
    };
    let discs: GroundDisc[] = [];
    return {
        get list() {
            return discs;
        },
        set(next: GroundDisc[]) {
            discs = next;
            while (pool.length < discs.length) pool.push(make());
            pool.forEach((item, index) => {
                const disc = discs[index];
                item.root.enabled = !!disc;
                if (disc) item.root.setPosition(disc.at[0], Math.max(0.01, disc.at[1] - 0.005), disc.at[2]);
            });
        },
        update(now: number) {
            const pulse = 0.5 + 0.5 * Math.sin(now / 300);
            ringMaterial.emissiveIntensity = 0.35 + pulse * 0.5;
            ringMaterial.update();
            pool.forEach((item, index) => {
                if (!item.root.enabled) return;
                item.disc.setLocalEulerAngles(0, now / 25 + index * 40, 0);
                item.disc.setLocalPosition(0, 0.02 + pulse * 0.02, 0);
                const s = 1 + pulse * 0.25;
                item.ring.setLocalScale(s, 1, s);
            });
        },
        /** Drawn once for shader warm-up. */
        showAt(x: number, y: number, z: number) {
            if (!pool.length) pool.push(make());
            pool[0].root.enabled = true;
            pool[0].root.setPosition(x, y, z);
        }
    };
};

export type GroundDiscs = ReturnType<typeof createGroundDiscs>;
