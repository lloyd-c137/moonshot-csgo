// The night guard in the world: a figure in a dark uniform and cap holding a flashlight. Before the blackout he stands
// at the south gate; after it he walks his rounds and the torch throws a real spot light and a visible beam. Placed from
// the room clock (gameplay/guard.ts); `catches` tells whether the local player is in the beam with nothing in between.
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import {
    BLEND_ADDITIVE,
    Color,
    CULLFACE_BACK,
    CULLFACE_NONE,
    Entity,
    Mesh,
    MeshInstance,
    StandardMaterial,
    Vec3
} from 'playcanvas';

import { box, cylinder, merge, place, sphere } from '../render/shapes';
import type { Shape } from '../render/shapes';

import { GUARD, guardAt, inBeam } from './guard';
import { powerOut } from './power';
import type { PowerState } from './power';
import type { TeacherPose } from './teacher';

const meshOf = (app: AppBase, shape: Shape) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    mesh.incRefCount();
    return mesh;
};
const solid = (colour: [number, number, number], gloss = 0.3) => {
    const m = new StandardMaterial();
    m.diffuse = new Color(...colour);
    m.gloss = gloss;
    m.cull = CULLFACE_BACK;
    m.update();
    return m;
};

export const createGuard = (app: AppBase, camera: EntityType, layer: HTMLElement) => {
    const uniform = solid([0.1, 0.12, 0.18]);
    const skin = solid([0.9, 0.76, 0.64]);
    const cap = solid([0.06, 0.07, 0.1], 0.5);
    const badge = solid([0.95, 0.78, 0.2], 0.8);
    const torchBody = solid([0.15, 0.15, 0.16], 0.7);
    const lens = new StandardMaterial();
    lens.emissive = new Color(1, 0.96, 0.8);
    lens.update();

    const root = new Entity('guard');
    root.addComponent('render', {
        castShadows: false,
        meshInstances: [
            new MeshInstance(
                meshOf(
                    app,
                    merge([
                        place(cylinder(0.27, 0.8, 20, true, 0.23), { y: 1.2 }),
                        place(cylinder(0.09, 0.8, 10), { x: -0.12, y: 0.4 }),
                        place(cylinder(0.09, 0.8, 10), { x: 0.12, y: 0.4 }),
                        place(cylinder(0.07, 0.6, 10), { x: -0.32, y: 1.2 })
                    ])
                ),
                uniform
            ),
            // Right arm raised forward, holding the torch.
            new MeshInstance(
                meshOf(app, place(cylinder(0.07, 0.55, 10), { x: 0.3, y: 1.32, z: -0.22, pitch: Math.PI / 2.4 })),
                uniform
            ),
            new MeshInstance(meshOf(app, place(sphere(16, 12), { y: 1.77, sx: 0.15, sy: 0.17, sz: 0.15 })), skin),
            new MeshInstance(
                meshOf(
                    app,
                    merge([
                        place(cylinder(0.17, 0.1, 18), { y: 1.9 }),
                        place(box(0.3, 0.02, 0.14), { y: 1.86, z: -0.14 })
                    ])
                ),
                cap
            ),
            new MeshInstance(meshOf(app, place(box(0.08, 0.08, 0.02), { x: -0.12, y: 1.38, z: -0.26 })), badge),
            new MeshInstance(
                meshOf(app, place(cylinder(0.04, 0.24, 12), { x: 0.3, y: 1.35, z: -0.48, pitch: Math.PI / 2 })),
                torchBody
            ),
            new MeshInstance(
                meshOf(app, place(cylinder(0.045, 0.01, 12), { x: 0.3, y: 1.35, z: -0.6, pitch: Math.PI / 2 })),
                lens
            )
        ]
    });
    // The torch: a spot light and a soft visible beam (off until the blackout).
    const torch = new Entity('guard-torch');
    torch.addComponent('light', {
        type: 'spot',
        color: new Color(1, 0.95, 0.82),
        intensity: 0,
        range: GUARD.range + 2,
        innerConeAngle: GUARD.halfAngle * 0.6,
        outerConeAngle: GUARD.halfAngle,
        castShadows: false
    });
    torch.setLocalPosition(0.3, GUARD.torch, -0.6);
    // Spot lights shine down their -Y axis: tip it forward (toward -Z) and a little down.
    torch.setLocalEulerAngles(-84, 0, 0);
    root.addChild(torch);
    const beamMaterial = new StandardMaterial();
    beamMaterial.useLighting = false;
    beamMaterial.diffuse = new Color(0, 0, 0);
    beamMaterial.emissive = new Color(1, 0.95, 0.75);
    beamMaterial.emissiveIntensity = 0.07;
    beamMaterial.blendType = BLEND_ADDITIVE;
    beamMaterial.depthWrite = false;
    beamMaterial.cull = CULLFACE_NONE;
    beamMaterial.update();
    const spread = Math.tan((GUARD.halfAngle * Math.PI) / 180) * GUARD.range;
    const beam = new Entity('guard-beam');
    beam.addComponent('render', {
        castShadows: false,
        // A cone along -Z from the lens: cylinder (axis Y) from radius 0.05 at the top to `spread` at the bottom.
        meshInstances: [
            new MeshInstance(
                meshOf(app, place(cylinder(spread, GUARD.range, 24, false, 0.05), { y: -GUARD.range / 2 })),
                beamMaterial
            )
        ]
    });
    beam.setLocalPosition(0.3, GUARD.torch, -0.6);
    beam.setLocalEulerAngles(-84, 0, 0);
    root.addChild(beam);
    app.root.addChild(root);

    const tag = document.createElement('span');
    tag.className = 'name-tag guard-tag';
    tag.innerHTML = '<b>保安</b> 夜间巡逻';
    layer.append(tag);

    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const screen = new Vec3();
    const head = new Vec3();
    const torchAt = new Vec3();
    const target = new Vec3();
    let pose: TeacherPose = guardAt(0, null);
    let on = false;

    return {
        get pose() {
            return pose;
        },
        /** Places him at room time `roomMs`; the torch is lit once the lights are out (`blackoutAt` reached). */
        update(roomMs: number, blackoutAt: number | null, power: PowerState) {
            pose = guardAt(roomMs, blackoutAt, power);
            on = (blackoutAt !== null && roomMs >= blackoutAt) || powerOut(roomMs, power);
            const bob = pose.walking ? Math.abs(Math.sin(roomMs / 260)) * 0.03 : 0;
            root.setPosition(pose.x, bob, pose.z);
            root.setEulerAngles(0, pose.yaw, 0);
            torch.light!.intensity = on ? 3.2 : 0;
            beam.enabled = on;
            head.set(pose.x, 2.15, pose.z);
            camera.camera!.worldToScreen(head, screen);
            const shown = screen.z > 0 && head.distance(camera.getPosition()) < 45;
            tag.hidden = !shown;
            if (shown)
                tag.style.transform = `translate(-50%, -100%) translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px)`;
        },
        /** Whether the lit torch has a player (capsule centre `at`) in its beam with a clear line to them. */
        catches(at: Vec3, player: EntityType) {
            if (!on || !inBeam(pose, at.x, at.z)) return false;
            torchAt.set(pose.x, GUARD.torch, pose.z);
            target.set(at.x, at.y + 0.4, at.z);
            const hit = rigidbody.raycastFirst(torchAt, target);
            return !hit || hit.entity === player;
        },
        /** Drawn once at a point (shader warm-up), torch lit. */
        showAt(x: number, z: number) {
            root.setPosition(x, 0, z);
            torch.light!.intensity = 3.2;
            beam.enabled = true;
        },
        root
    };
};

export type Guard = ReturnType<typeof createGuard>;
