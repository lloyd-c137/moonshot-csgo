// Builds a GAMEPLAY_AUTHORED room scene (see src/world/rooms) into the level: one mesh per material, flat colours
// only, plus one static collider body for its footprints.
import type { AppBase } from 'playcanvas';
import {
    BLEND_NORMAL,
    Color,
    CULLFACE_BACK,
    CULLFACE_NONE,
    Entity,
    Mesh,
    MeshInstance,
    StandardMaterial
} from 'playcanvas';

import { MeshBuilder } from '../render/meshBuilder';
import { merge } from '../render/shapes';

import type { AuthoredRoomScene, MaterialSpec } from './rooms/m104';

const material = (name: string, spec: MaterialSpec) => {
    const m = new StandardMaterial();
    m.name = `${name}`;
    m.useMetalness = true;
    m.metalness = spec.metalness ?? 0;
    m.gloss = spec.gloss ?? 0.25;
    m.diffuse = new Color(...spec.colour);
    m.cull = CULLFACE_BACK;
    if (spec.emissive) {
        m.emissive = new Color(...spec.emissive);
        m.emissiveIntensity = spec.emissiveIntensity ?? 1;
        m.diffuse = new Color(0, 0, 0);
        m.useLighting = false;
    }
    if (spec.opacity !== undefined) {
        m.opacity = spec.opacity;
        m.blendType = BLEND_NORMAL;
        m.depthWrite = false;
        m.cull = CULLFACE_NONE;
    }
    if (spec.decal) {
        m.depthBias = -2;
        m.slopeDepthBias = -2;
    }
    m.update();
    return m;
};

export const buildAuthoredRoom = (app: AppBase, parent: Entity, scene: AuthoredRoomScene) => {
    const root = new Entity(`GameplayAuthored_Room_${scene.room}`);
    parent.addChild(root);
    const byMaterial = new Map<string, AuthoredRoomScene['parts']>();
    for (const part of scene.parts) {
        if (!byMaterial.has(part.material)) byMaterial.set(part.material, []);
        byMaterial.get(part.material)!.push(part);
    }
    let triangles = 0;
    for (const [key, parts] of byMaterial) {
        const shape = merge(parts.map((part) => part.shape));
        const mesh = new Mesh(app.graphicsDevice);
        mesh.setPositions(shape.positions);
        mesh.setNormals(shape.normals);
        mesh.setIndices(shape.indices);
        mesh.update();
        triangles += shape.indices.length / 3;
        const entity = new Entity(`${scene.room}_${key}`);
        entity.addComponent('render', {
            meshInstances: [new MeshInstance(mesh, material(`${scene.room}-${key}`, scene.materials[key]))],
            castShadows: false
        });
        root.addChild(entity);
    }
    const colliders = new MeshBuilder();
    for (const { x, z, w, d, h, yaw } of scene.colliders) colliders.box(x, 0, z, w, d, h, yaw);
    if (!colliders.empty) {
        const body = new Entity(`GameplayAuthored_${scene.room}_Colliders`);
        body.addComponent('collision', { type: 'mesh', render: { meshes: [colliders.build(app.graphicsDevice)] } });
        body.addComponent('rigidbody', { type: 'static', friction: 0.5, restitution: 0 });
        root.addChild(body);
    }
    return { root, materials: byMaterial.size, triangles, colliders: scene.colliders.length };
};
