// Other players in the shared world: a simple coloured figure per player (body, head, visor showing facing, a disc
// in hand) and a name tag drawn in the DOM. Tags hide when a wall is between the camera and the player.
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import { Color, CULLFACE_BACK, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';

import type { PlayerPose } from '../net/protocol';
import type { Shape } from '../render/shapes';
import { box, cylinder, merge, place, sphere } from '../render/shapes';

import { hueColour } from './discs';

type Avatar = {
    root: EntityType;
    tag: HTMLElement;
    name: string;
    visible: boolean;
    checkedAt: number;
    hue: number;
    /** Scope glint shown while the player aims a sniper throw. */
    glint: EntityType;
    /** Last written name-tag styles. */
    transform: string;
    opacity: string;
};

const meshOf = (app: AppBase, shape: Shape) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    // Shared by every avatar: hold a reference of our own, or destroying the last avatar (a player leaving) would
    // destroy the mesh and every later avatar would render invisible.
    mesh.incRefCount();
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

    // Scope glint: a bright four-point star in front of an aiming player's visor, so snipers can be spotted.
    const glintMesh = meshOf(
        app,
        merge([box(0.5, 0.035, 0.002), box(0.035, 0.5, 0.002), place(box(0.12, 0.12, 0.002), { roll: Math.PI / 4 })])
    );
    const glintMaterial = new StandardMaterial();
    glintMaterial.useLighting = false;
    glintMaterial.diffuse = new Color(0, 0, 0);
    // Opaque warm gold rather than additive white: it has to read against the pale campus walls too.
    glintMaterial.emissive = new Color(1, 0.78, 0.25);
    glintMaterial.cull = CULLFACE_NONE;
    glintMaterial.update();

    const avatars = new Map<string, Avatar>();
    let goldHolder: string | null = null;
    let goldMaterial: StandardMaterial | null = null;
    /** Hit flash per hue material: until (ms). */
    const flashes = new Map<number, number>();
    /** The golden disc replaces the in-hand disc of whoever holds it. */
    const setGold = (holder: string | null) => {
        goldHolder = holder;
        for (const [id, avatar] of avatars) {
            const instances = avatar.root.render!.meshInstances;
            const wanted = id === holder && goldMaterial ? goldMaterial : colourMaterial(avatar.hue);
            if (instances[3] && instances[3].material !== wanted) instances[3].material = wanted;
        }
    };
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
        const glint = new Entity('glint');
        glint.addComponent('render', {
            meshInstances: [new MeshInstance(glintMesh, glintMaterial)],
            castShadows: false
        });
        glint.enabled = false;
        app.root.addChild(glint);
        const tag = document.createElement('span');
        tag.className = 'name-tag';
        const badge = document.createElement('b');
        badge.className = 'title';
        badge.textContent = '淘汰王';
        badge.hidden = true;
        tag.append(badge, document.createTextNode(name));
        tag.style.setProperty('--player-colour', `hsl(${hue} 75% 52%)`);
        tag.hidden = true;
        layer.append(tag);
        avatars.set(id, { root, tag, name, hue, visible: false, checkedAt: 0, glint, transform: '', opacity: '' });
        if (goldHolder === id) setGold(id);
    };

    const remove = (id: string) => {
        const avatar = avatars.get(id);
        if (!avatar) return;
        avatar.root.destroy();
        avatar.glint.destroy();
        avatar.tag.remove();
        avatars.delete(id);
    };

    /** Places every avatar from the interpolated poses; players without a pose (eliminated) are hidden. */
    const update = (poses: Map<string, PlayerPose>, now: number, hiddenIds: ReadonlySet<string> = new Set()) => {
        // Hit flash: the struck player's colour burns white and fades.
        for (const [hue, until] of flashes) {
            const m = colourMaterial(hue);
            const left = Math.max(0, until - now) / 220;
            m.emissive.set(left, left, left);
            m.update();
            if (left <= 0) flashes.delete(hue);
        }
        const cameraComponent = camera.camera!;
        eye.copy(camera.getPosition());
        for (const [id, avatar] of avatars) {
            const pose = poses.get(id);
            if (!pose || hiddenIds.has(id)) {
                avatar.root.enabled = false;
                avatar.glint.enabled = false;
                avatar.tag.hidden = true;
                continue;
            }
            // Glint: grows with the aim, flickers, always faces the camera, sits just in front of the visor.
            const aim = pose.aim ?? 0;
            avatar.glint.enabled = aim > 0.3;
            if (avatar.glint.enabled) {
                const yaw = (pose.yaw * Math.PI) / 180;
                avatar.glint.setPosition(
                    pose.p[0] - Math.sin(yaw) * 0.25,
                    pose.p[1] + 0.66,
                    pose.p[2] - Math.cos(yaw) * 0.25
                );
                avatar.glint.lookAt(eye);
                // Bigger with distance so a far sniper still shows a visible point of light.
                const far = Math.max(1, Math.hypot(pose.p[0] - eye.x, pose.p[2] - eye.z) / 12);
                const size = (aim - 0.3) * 1.6 * (1.1 + Math.sin(now / 45) * 0.25) * far;
                avatar.glint.setLocalScale(size, size, size);
                avatar.glint.rotateLocal(0, 0, now / 20);
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
            const hidden = !avatar.visible || !inFront;
            if (avatar.tag.hidden !== hidden) avatar.tag.hidden = hidden;
            if (!hidden) {
                // Whole pixels and two-decimal opacity: unchanged values skip the style write (and its restyle).
                const transform = `translate(-50%, -100%) translate(${Math.round(screen.x)}px, ${Math.round(screen.y)}px)`;
                if (transform !== avatar.transform) {
                    avatar.transform = transform;
                    avatar.tag.style.transform = transform;
                }
                const opacity = Math.max(0.35, 1 - distance / 50).toFixed(2);
                if (opacity !== avatar.opacity) {
                    avatar.opacity = opacity;
                    avatar.tag.style.opacity = opacity;
                }
            }
        }
    };

    /** Marks the current leader (title shown before the name tag), or nobody with null. */
    const setLeader = (leader: string | null) => {
        for (const [id, avatar] of avatars) {
            const badge = avatar.tag.querySelector<HTMLElement>('.title');
            if (badge) badge.hidden = id !== leader;
        }
    };

    return {
        add,
        remove,
        update,
        setLeader,
        setGold,
        /** Material used for the golden disc in a holder's hand. */
        set goldMaterial(material: StandardMaterial) {
            goldMaterial = material;
            setGold(goldHolder);
        },
        /** Flashes a struck player white. */
        flash(id: string, now: number) {
            const avatar = avatars.get(id);
            if (avatar) flashes.set(avatar.hue, now + 220);
        },
        has: (id: string) => avatars.has(id),
        clear: () => {
            for (const id of [...avatars.keys()]) remove(id);
        }
    };
};

export type Avatars = ReturnType<typeof createAvatars>;
