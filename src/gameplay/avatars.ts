// Other players in the shared world: a simple coloured figure per player (body, head, visor showing facing, a disc
// in hand) and a name tag drawn in the DOM. Tags hide when a wall is between the camera and the player.
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import { Color, CULLFACE_BACK, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';

import type { PlayerPose } from '../net/protocol';
import type { Shape } from '../render/shapes';
import { box, cylinder, merge, place, sphere } from '../render/shapes';

import { hueColour } from './discs';

type Avatar = { root: EntityType; tag: HTMLElement; name: string; visible: boolean; checkedAt: number };

const meshOf = (app: AppBase, shape: Shape) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    return mesh;
};

const material = (colour: [number, number, number], gloss = 0.35) => {
    const m = new StandardMaterial();
    m.diffuse = new Color(...colour);
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = gloss;
    m.cull = CULLFACE_BACK;
    m.update();
    return m;
};

export const createAvatars = (app: AppBase, camera: EntityType, layer: HTMLElement) => {
    // Figure in local space: feet at y = -0.9 (the capsule centre is the origin), facing -Z like the camera.
    const bodyMesh = meshOf(
        app,
        merge([
            place(cylinder(0.24, 0.75, 20, true, 0.2), { y: -0.05 }),
            place(sphere(16, 10), { y: 0.32, sx: 0.2, sy: 0.12, sz: 0.2 }),
            place(cylinder(0.075, 0.55, 10), { x: -0.11, y: -0.65 }),
            place(cylinder(0.075, 0.55, 10), { x: 0.11, y: -0.65 })
        ])
    );
    const headMesh = meshOf(app, place(sphere(16, 12), { y: 0.63, sx: 0.16, sy: 0.18, sz: 0.16 }));
    const visorMesh = meshOf(app, place(box(0.22, 0.07, 0.04), { y: 0.66, z: -0.145 }));
    const discMesh = meshOf(app, place(cylinder(0.135, 0.025, 24), { x: 0.3, y: 0.05, z: -0.12, roll: 1.2 }));
    const visorMaterial = material([0.08, 0.09, 0.11], 0.8);
    const skin = material([0.93, 0.8, 0.68], 0.3);
    const materials = new Map<number, StandardMaterial>();
    const colourMaterial = (hue: number) => {
        if (!materials.has(hue)) materials.set(hue, material(hueColour(hue)));
        return materials.get(hue)!;
    };

    const avatars = new Map<string, Avatar>();
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const screen = new Vec3();
    const head = new Vec3();
    const eye = new Vec3();

    const add = (id: string, name: string, hue: number) => {
        if (avatars.has(id)) return;
        const root = new Entity(`avatar-${id}`);
        const body = colourMaterial(hue);
        root.addComponent('render', {
            meshInstances: [
                new MeshInstance(bodyMesh, body),
                new MeshInstance(headMesh, skin),
                new MeshInstance(visorMesh, visorMaterial),
                new MeshInstance(discMesh, body)
            ],
            castShadows: false
        });
        root.enabled = false;
        app.root.addChild(root);
        const tag = document.createElement('span');
        tag.className = 'name-tag';
        tag.textContent = name;
        tag.style.setProperty('--player-colour', `hsl(${hue} 75% 52%)`);
        tag.hidden = true;
        layer.append(tag);
        avatars.set(id, { root, tag, name, visible: false, checkedAt: 0 });
    };

    const remove = (id: string) => {
        const avatar = avatars.get(id);
        if (!avatar) return;
        avatar.root.destroy();
        avatar.tag.remove();
        avatars.delete(id);
    };

    /** Places every avatar from the interpolated poses; players without a pose (eliminated) are hidden. */
    const update = (poses: Map<string, PlayerPose>, now: number) => {
        const cameraComponent = camera.camera!;
        eye.copy(camera.getPosition());
        for (const [id, avatar] of avatars) {
            const pose = poses.get(id);
            if (!pose) {
                avatar.root.enabled = false;
                avatar.tag.hidden = true;
                continue;
            }
            avatar.root.enabled = true;
            avatar.root.setPosition(pose.p[0], pose.p[1], pose.p[2]);
            avatar.root.setEulerAngles(0, pose.yaw, 0);
            head.set(pose.p[0], pose.p[1] + 1.05, pose.p[2]);
            const distance = head.distance(eye);
            // Line of sight for the name tag, re-checked a few times a second.
            if (now - avatar.checkedAt > 200) {
                avatar.checkedAt = now;
                const hit = distance < 45 ? rigidbody.raycastFirst(eye, head) : null;
                avatar.visible = distance < 45 && (!hit || hit.entity.name.startsWith('avatar-'));
            }
            cameraComponent.worldToScreen(head, screen);
            const inFront = screen.z > 0;
            avatar.tag.hidden = !avatar.visible || !inFront;
            if (!avatar.tag.hidden) {
                avatar.tag.style.transform = `translate(-50%, -100%) translate(${screen.x}px, ${screen.y}px)`;
                avatar.tag.style.opacity = String(Math.max(0.35, 1 - distance / 50));
            }
        }
    };

    return {
        add,
        remove,
        update,
        has: (id: string) => avatars.has(id),
        clear: () => {
            for (const id of [...avatars.keys()]) remove(id);
        }
    };
};

export type Avatars = ReturnType<typeof createAvatars>;
