import { Color, Entity, Mesh, MeshInstance, StandardMaterial } from 'playcanvas';
import type { AppBase } from 'playcanvas';

import type { ItemKind } from '../config/gameplayItems';
import { box, cylinder, merge, place, torus } from '../render/shapes';
import type { Shape } from '../render/shapes';

import type { PickupAssetLoader } from './pickupAssetLoader';

const PALETTE: Record<ItemKind, { glow: [number, number, number]; trim: [number, number, number] }> = {
    revive: { glow: [1, 0.18, 0.22], trim: [1, 0.76, 0.64] },
    frc: { glow: [1, 0.08, 0.04], trim: [0.24, 0.86, 1] },
    eye: { glow: [0.06, 0.78, 1], trim: [0.7, 0.96, 1] },
    stealth: { glow: [0.12, 0.58, 1], trim: [0.82, 0.96, 1] },
    creation: { glow: [0.24, 0.92, 0.34], trim: [0.9, 1, 0.26] },
    flashlight: { glow: [1, 0.82, 0.36], trim: [1, 0.97, 0.74] }
};

const createPart = (app: AppBase, parent: Entity, name: string, shape: Shape, colour: [number, number, number], intensity: number) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    const material = new StandardMaterial();
    material.name = `pickup-${name}`;
    material.useLighting = false;
    material.diffuse = new Color(...colour);
    material.emissive = new Color(...colour);
    material.emissiveIntensity = intensity;
    material.update();
    const part = new Entity(name);
    part.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)], castShadows: false });
    parent.addChild(part);
    return part;
};

const createFrcDisc = (app: AppBase, root: Entity) => {
    createPart(
        app,
        root,
        'FRC_Red_Frisbee',
        merge([
            place(cylinder(0.34, 0.085, 40, true, 0.29), { y: 0.39 }),
            place(torus(0.31, 0.022, 40, 7), { y: 0.438 }),
            place(torus(0.2, 0.012, 32, 6), { y: 0.438 }),
            place(cylinder(0.09, 0.012, 24, true, 0.075), { y: 0.44 }),
            ...Array.from({ length: 6 }, (_, index) => {
                const angle = (index * Math.PI) / 3;
                return place(box(0.075, 0.014, 0.018), {
                    x: Math.cos(angle) * 0.245,
                    y: 0.448,
                    z: Math.sin(angle) * 0.245,
                    yaw: -angle
                });
            })
        ]),
        [0.96, 0.035, 0.025],
        0.4
    );
    const ring = createPart(app, root, 'FrcTechRing', place(torus(0.42, 0.014, 48, 6), { y: 0.37 }), [0.24, 0.82, 1], 1.5);
    createPart(app, root, 'FrcEnergyRing', place(torus(0.37, 0.009, 48, 5), { y: 0.34 }), [1, 0.2, 0.08], 1.2);
    return ring;
};

/** Distinct imported OpenGameArt models, with a shared lift ring; FRC remains a red, tech-styled frisbee. */
export const createPickupVisual = (app: AppBase, kind: ItemKind, assets: PickupAssetLoader) => {
    const root = new Entity(`Pickup_${kind}`);
    const palette = PALETTE[kind];
    const importedModel = kind === 'frc' || kind === 'stealth' || kind === 'flashlight' ? null : assets.instantiate(kind);
    if (importedModel) {
        importedModel.name = `${kind}-open-game-art-model`;
        root.addChild(importedModel);
    }
    const halo = place(torus(kind === 'frc' ? 0.47 : 0.39, 0.022, 36, 6), { y: 0.035 });
    createPart(app, root, `${kind}-pickup-halo`, halo, palette.glow, 0.85);

    if (kind === 'frc') {
        createFrcDisc(app, root);
    } else if (kind === 'revive') {
        // A small luminous cross reads as a revive/medical pickup without covering the sourced medkit.
        createPart(app, root, 'revive-cross', merge([
            place(box(0.22, 0.045, 0.012), { y: 0.38, z: 0.13 }),
            place(box(0.045, 0.22, 0.012), { y: 0.38, z: 0.13 })
        ]), palette.trim, 1.1);
    } else if (kind === 'eye') {
        createPart(app, root, 'eye-signal-ring', place(torus(0.48, 0.012, 40, 5), { y: 0.28 }), palette.trim, 1.2);
    } else if (kind === 'stealth') {
        const page = { y: 0.38, pitch: 0.08, roll: -0.04 };
        createPart(app, root, 'leave-pass-paper', place(box(0.42, 0.014, 0.56), page), [0.96, 0.98, 1], 0.18);
        createPart(app, root, 'leave-pass-header', place(box(0.26, 0.006, 0.025), { ...page, y: 0.391, z: -0.2 }), [0.12, 0.55, 0.92], 0.45);
        createPart(app, root, 'leave-pass-lines', merge([
            place(box(0.32, 0.006, 0.009), { ...page, y: 0.391, z: -0.11 }),
            place(box(0.32, 0.006, 0.009), { ...page, y: 0.391, z: -0.04 }),
            place(box(0.28, 0.006, 0.009), { ...page, y: 0.391, z: 0.03 }),
            place(box(0.32, 0.006, 0.009), { ...page, y: 0.391, z: 0.1 })
        ]), [0.36, 0.58, 0.72], 0.18);
        createPart(app, root, 'leave-pass-orbit', place(torus(0.38, 0.012, 36, 5), { y: 0.14 }), palette.trim, 0.9);
    } else if (kind === 'creation') {
        createPart(app, root, 'creation-energy-ring', place(torus(0.43, 0.013, 40, 5), { y: 0.14 }), palette.trim, 1.2);
    } else if (kind === 'flashlight') {
        // GAMEPLAY_AUTHORED: recognizable hand torch with a luminous lens, grip and bezel.
        createPart(app, root, 'flashlight-body', merge([
            place(cylinder(0.085, 0.42, 20, true, 0.07), { y: 0.36 }),
            place(cylinder(0.12, 0.11, 24, true, 0.09), { y: 0.12 }),
            place(torus(0.095, 0.014, 24, 5), { y: 0.43 })
        ]), [0.12, 0.16, 0.2], 0.12);
        createPart(app, root, 'flashlight-lens', place(cylinder(0.077, 0.018, 24, true, 0.077), { y: 0.42 }), palette.trim, 1.6);
        createPart(app, root, 'flashlight-grip', place(box(0.11, 0.16, 0.1), { y: 0.28 }), [0.07, 0.09, 0.12], 0.08);
    }

    app.root.addChild(root);
    return root;
};
