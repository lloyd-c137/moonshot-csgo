// Other players in the shared world: a simple coloured figure per player (body, head, visor showing facing, a disc
// in hand) and a name tag drawn in the DOM. Tags hide when a wall is between the camera and the player.
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import { Color, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { FRISBEE_THROW_REMAINING } from '../characters/frisbeeThrowTrack';
import type { PlayerPose } from '../net/protocol';
import type { Shape } from '../render/shapes';
import { box, merge, place } from '../render/shapes';

import { hueColour } from './discs';

type Avatar = {
    character: ReturnType<CharacterAssetLoader['create']>;
    disc: EntityType;
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
    lastPosition: Vec3;
    lastMovedAt: number;
    locomotion: 'Idle_Loop' | 'Jog_Fwd_Loop' | 'Sprint_Loop';
    action: string | null;
    actionUntil: number;
    throwUntil: number;
    heldPose: PlayerPose | null;
    heldUntil: number;
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

export const createAvatars = (
    app: AppBase,
    camera: EntityType,
    layer: HTMLElement,
    characters: CharacterAssetLoader
) => {
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
            const material = id === holder && goldMaterial ? goldMaterial : avatar.character.materials.get('M_Main')!;
            for (const instance of avatar.disc.render!.meshInstances) instance.material = material;
        }
    };
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const screen = new Vec3();
    const head = new Vec3();
    const eye = new Vec3();

    const add = (id: string, name: string, hue: number) => {
        if (avatars.has(id)) return;
        const character = characters.create({ name: `avatar-${id}-rig`, colour: hueColour(hue), gripRightHand: true });
        const root = new Entity(`avatar-${id}`);
        root.addChild(character.root);
        // The capsule uses centre origin. Offset the model down so scaled feet still meet the floor.
        character.root.setLocalPosition(0, -0.9, 0);
        const hand = character.root.findByName('hand_r');
        const disc = new Entity(`avatar-disc-${id}`);
        disc.addComponent('render', {
            type: 'cylinder',
            material: character.materials.get('M_Main'),
            castShadows: false
        });
        if (hand) {
            hand.addChild(disc);
            disc.setLocalPosition(0, 0.07, 0.025);
            disc.setLocalScale(0.25, 0.035, 0.25);
            disc.setLocalEulerAngles(90, 0, 0);
        }
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
        avatars.set(id, {
            root,
            character,
            disc,
            tag,
            name,
            hue,
            visible: false,
            checkedAt: 0,
            glint,
            transform: '',
            opacity: '',
            lastPosition: new Vec3(),
            lastMovedAt: 0,
            locomotion: 'Idle_Loop',
            action: null,
            actionUntil: 0,
            throwUntil: 0,
            heldPose: null,
            heldUntil: 0
        });
        if (goldHolder === id) setGold(id);
    };

    const remove = (id: string) => {
        const avatar = avatars.get(id);
        if (!avatar) return;
        avatar.character.dispose();
        avatar.root.destroy();
        avatar.glint.destroy();
        avatar.tag.remove();
        avatars.delete(id);
    };

    /** Places every avatar from the interpolated poses; players without a pose (eliminated) are hidden. */
    const update = (poses: Map<string, PlayerPose>, now: number, hiddenIds: ReadonlySet<string> = new Set()) => {
        // Hit flash: the struck player's colour burns white and fades.
        for (const [hue, until] of flashes) {
            const left = Math.max(0, until - now) / 220;
            for (const avatar of avatars.values())
                if (avatar.hue === hue) {
                    const m = avatar.character.materials.get('M_Main')!;
                    m.emissive.set(left, left, left);
                    m.update();
                }
            if (left <= 0) flashes.delete(hue);
        }
        const cameraComponent = camera.camera!;
        eye.copy(camera.getPosition());
        for (const [id, avatar] of avatars) {
            let pose = poses.get(id);
            let deathHold = false;
            if (pose) {
                avatar.heldPose = pose;
                avatar.heldUntil = 0;
            } else if (avatar.heldPose && now < avatar.heldUntil) {
                pose = avatar.heldPose;
                deathHold = true;
            }
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
                    pose.p[1] - 0.9 + avatar.character.height * 0.88,
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
            const delta = now - avatar.lastMovedAt;
            if (delta >= 100) {
                const moved = Math.hypot(pose.p[0] - avatar.lastPosition.x, pose.p[2] - avatar.lastPosition.z);
                const speed = delta < 350 ? moved / (delta / 1000) : 0;
                // ponytail: a 100 ms window filters interpolation noise without adding per-frame animation state.
                if (avatar.locomotion === 'Sprint_Loop') {
                    if (speed < 4.6) avatar.locomotion = speed > 0.3 ? 'Jog_Fwd_Loop' : 'Idle_Loop';
                } else if (avatar.locomotion === 'Jog_Fwd_Loop') {
                    if (speed > 5.4) avatar.locomotion = 'Sprint_Loop';
                    else if (speed < 0.25) avatar.locomotion = 'Idle_Loop';
                } else if (speed > 0.45) {
                    avatar.locomotion = speed > 5.4 ? 'Sprint_Loop' : 'Jog_Fwd_Loop';
                }
                avatar.lastPosition.set(pose.p[0], pose.p[1], pose.p[2]);
                avatar.lastMovedAt = now;
                if (avatar.action && now >= avatar.actionUntil) avatar.action = null;
                if (!avatar.action) avatar.character.play(avatar.locomotion);
            }
            head.set(pose.p[0], pose.p[1] - 0.9 + avatar.character.height + 0.06, pose.p[2]);
            const distance = head.distance(eye);
            // Line of sight for the name tag, re-checked a few times a second.
            if (now - avatar.checkedAt > 200) {
                avatar.checkedAt = now;
                const hit = distance < 45 ? rigidbody.raycastFirst(eye, head) : null;
                avatar.visible = distance < 45 && (!hit || hit.entity.name.startsWith('avatar-'));
            }
            cameraComponent.worldToScreen(head, screen);
            const inFront = screen.z > 0;
            const hidden = deathHold || !avatar.visible || !inFront;
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
        setScale(id: string, scale: number) {
            avatars.get(id)?.character.setScale(scale);
        },
        react(id: string, head: boolean, eliminated: boolean, pose: PlayerPose | undefined, now: number) {
            const avatar = avatars.get(id);
            if (!avatar) return;
            const action = eliminated ? 'Death01' : head ? 'Hit_Head' : 'Hit_Chest';
            const duration = Math.max(0.35, avatar.character.duration(action));
            avatar.character.stopThrow();
            avatar.throwUntil = 0;
            avatar.action = action;
            avatar.actionUntil = now + duration * 1000;
            avatar.character.play(action, eliminated ? 0.06 : 0.08);
            if (eliminated && pose) {
                avatar.heldPose = pose;
                avatar.heldUntil = now + duration * 1000;
            }
        },
        actionState(id: string) {
            const avatar = avatars.get(id);
            if (!avatar) return null;
            return avatar.action ?? (performance.now() < avatar.throwUntil ? 'Frisbee_Throw' : null);
        },
        jointRotation(id: string, name: string) {
            const bone = avatars.get(id)?.character.root.findByName(name);
            return bone?.getLocalRotation().toArray() ?? null;
        },
        throw(id: string, now: number) {
            const avatar = avatars.get(id);
            if (!avatar) return;
            avatar.character.playThrow();
            avatar.throwUntil = now + FRISBEE_THROW_REMAINING * 1000;
        },
        setLeader,
        setGold,
        /** Material used for the golden disc attached to the holder's hand. */
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
