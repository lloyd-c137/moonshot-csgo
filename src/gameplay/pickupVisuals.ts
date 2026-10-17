import { Color, Entity, Mesh, MeshInstance, StandardMaterial } from 'playcanvas';
import type { AppBase } from 'playcanvas';

import type { ItemKind } from '../config/gameplayItems';
import { box, cylinder, merge, place, sphere, torus } from '../render/shapes';
import type { Shape } from '../render/shapes';

type PickupModel = { kind: ItemKind; primary: Shape; accent?: Shape; colour: [number, number, number]; accentColour?: [number, number, number] };

const modelFor = (kind: ItemKind): PickupModel => {
    const floorRing = place(torus(0.34, 0.025, 28, 6), { y: 0.035 });
    switch (kind) {
        case 'revive':
            return {
                kind,
                primary: merge([floorRing, place(box(0.42, 0.28, 0.3), { y: 0.36 }), place(box(0.3, 0.06, 0.34), { y: 0.53 })]),
                accent: merge([place(box(0.07, 0.24, 0.035), { y: 0.37, z: -0.17 }), place(box(0.24, 0.07, 0.035), { y: 0.37, z: -0.17 })]),
                colour: [0.88, 0.93, 1], accentColour: [1, 0.19, 0.26]
            };
        case 'frc':
            return {
                kind,
                primary: merge([floorRing, place(cylinder(0.3, 0.12, 28), { y: 0.38 }), place(torus(0.28, 0.035, 28, 6), { y: 0.45 })]),
                accent: place(cylinder(0.19, 0.03, 24), { y: 0.46 }),
                colour: [0.85, 0.08, 0.05], accentColour: [1, 0.38, 0.08]
            };
        case 'eye':
            return {
                kind,
                primary: merge([floorRing, place(sphere(20, 12), { y: 0.43, sx: 0.22, sy: 0.17, sz: 0.22 }), place(torus(0.31, 0.035, 28, 6), { y: 0.43 })]),
                accent: place(sphere(16, 10), { y: 0.43, z: -0.18, sx: 0.075, sy: 0.075, sz: 0.075 }),
                colour: [0.12, 0.74, 0.98], accentColour: [0.84, 0.98, 1]
            };
        case 'stealth':
            return {
                kind,
                primary: merge([floorRing, place(cylinder(0.22, 0.56, 6, true, 0.015), { y: 0.4 }), place(cylinder(0.22, 0.56, 6, true, 0.015), { y: 0.4, roll: Math.PI })]),
                accent: place(torus(0.25, 0.025, 24, 6), { y: 0.4 }),
                colour: [0.45, 0.2, 0.92], accentColour: [0.86, 0.73, 1]
            };
        case 'creation':
            return {
                kind,
                primary: merge([
                    floorRing,
                    place(cylinder(0.23, 0.12, 12), { y: 0.4 }),
                    place(torus(0.22, 0.05, 24, 8), { y: 0.42 }),
                    ...Array.from({ length: 8 }, (_, index) => {
                        const angle = index * Math.PI / 4;
                        return place(box(0.13, 0.1, 0.095), { x: Math.cos(angle) * 0.29, y: 0.4, z: Math.sin(angle) * 0.29, yaw: -angle });
                    })
                ]),
                accent: merge([place(cylinder(0.105, 0.15, 6), { y: 0.43 }), place(sphere(12, 8), { y: 0.43, sx: 0.075, sy: 0.075, sz: 0.075 })]),
                colour: [0.14, 0.75, 0.38], accentColour: [0.92, 1, 0.3]
            };
    }
};

const createPart = (app: AppBase, parent: Entity, shape: Shape, colour: [number, number, number], intensity: number) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    const material = new StandardMaterial();
    material.useLighting = false;
    material.diffuse = new Color(...colour);
    material.emissive = new Color(...colour);
    material.emissiveIntensity = intensity;
    material.update();
    const part = new Entity('pickup-part');
    part.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)], castShadows: false });
    parent.addChild(part);
};

/** Multi-part GAMEPLAY_AUTHORED skill models, shared visual language, distinct silhouette per pickup. */
export const createPickupVisual = (app: AppBase, kind: ItemKind) => {
    const model = modelFor(kind);
    const root = new Entity(`Pickup_${kind}`);
    createPart(app, root, model.primary, model.colour, 0.55);
    if (model.accent && model.accentColour) createPart(app, root, model.accent, model.accentColour, 0.8);
    app.root.addChild(root);
    return root;
};
