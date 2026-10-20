// Other players in the shared world: a simple coloured figure per player (body, head, visor showing facing, a disc
// in hand) and a name tag drawn in the DOM. Tags hide when a wall is between the camera and the player.
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import { Color, CULLFACE_NONE, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { FRISBEE_THROW_REMAINING } from '../characters/frisbeeThrowTrack';
import { attachHeldItemSocket } from '../characters/heldItemSocket';
import { MAX_HP } from '../net/protocol';
import type { PlayerPose } from '../net/protocol';
import type { Shape } from '../render/shapes';
import { box, merge, place } from '../render/shapes';
import type { SkinLibrary } from '../render/skinDisc';

import { hueColour } from './discs';

type Avatar = {
    character: ReturnType<CharacterAssetLoader['create']>;
    headBone: EntityType | null;
    disc: EntityType;
    /** The golden disc model in the hand (child of `disc`, made on first hold). */
    goldDisc: EntityType | null;
    /** The equipped skin's disc in the hand (child of `disc`), and which skin it shows. */
    skinDisc: EntityType | null;
    skin: string | null;
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
    crouchAmount: number;
    crouchAt: number;
    action: string | null;
    actionUntil: number;
    throwUntil: number;
    heldPose: PlayerPose | null;
    heldUntil: number;
    avatarRequest: number;
    avatarId: string | null;
    avatarVersion: string | null;
    flashlight: boolean;
    flashlightProp: EntityType;
    flashlightLight: EntityType;
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
    characters: CharacterAssetLoader,
    avatarUrl: (id: string, version: string) => string | null
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
    const flashlightMaterial = new StandardMaterial();
    flashlightMaterial.diffuse = new Color(0.12, 0.15, 0.18);
    flashlightMaterial.update();
    const flashlightLensMaterial = new StandardMaterial();
    flashlightLensMaterial.useLighting = false;
    flashlightLensMaterial.diffuse = new Color(1, 0.94, 0.72);
    flashlightLensMaterial.emissive = new Color(1, 0.86, 0.5);
    flashlightLensMaterial.emissiveIntensity = 1.2;
    flashlightLensMaterial.update();

    const avatars = new Map<string, Avatar>();
    const heads = new Map<string, HTMLImageElement | HTMLCanvasElement>();
    let goldHolder: string | null = null;
    let goldMaterial: StandardMaterial | null = null;
    /** Hit flash per hue material: until (ms). */
    const flashes = new Map<number, number>();
    /** The golden disc replaces the in-hand disc of whoever holds it. */
    let goldMesh: Mesh | null = null;
    const setGold = (holder: string | null) => {
        goldHolder = holder;
        for (const [id, avatar] of avatars) {
            const golden = id === holder && goldMaterial !== null && goldMesh !== null;
            if (golden && !avatar.goldDisc) {
                // The NOVA DISC model at its true size: a child of the in-hand disc (a scaled primitive cylinder),
                // so it shows and hides with it; the parent's scale is undone here.
                const model = new Entity(`avatar-gold-disc-${id}`);
                model.addComponent('render', { meshInstances: [new MeshInstance(goldMesh!, goldMaterial!)], castShadows: false });
                model.setLocalScale(1 / 0.25, 1 / 0.035, 1 / 0.25);
                model.setLocalPosition(0, -0.5, 0);
                avatar.disc.addChild(model);
                avatar.goldDisc = model;
            }
            if (avatar.goldDisc) avatar.goldDisc.enabled = golden;
            if (avatar.skinDisc) avatar.skinDisc.enabled = !golden;
            avatar.disc.render!.enabled = !golden && !avatar.skinDisc;
        }
    };
    let skins: SkinLibrary | null = null;
    /** Puts a player's equipped skin in their hand (everyone sees it); null restores the plain disc. */
    const setSkin = (id: string, skin: string | null, counter = false) => {
        const avatar = avatars.get(id);
        const key = skin ? `${skin}:${counter}` : null;
        if (!avatar || avatar.skin === key) return;
        avatar.skin = key;
        avatar.skinDisc?.destroy();
        avatar.skinDisc = null;
        const instances = skin ? (skins?.instances(skin, counter) ?? null) : null;
        if (instances) {
            const model = new Entity(`avatar-skin-disc-${id}`);
            model.addComponent('render', { meshInstances: instances, castShadows: false });
            // True size under the scaled primitive cylinder (as the golden disc).
            model.setLocalScale(1 / 0.25, 1 / 0.035, 1 / 0.25);
            model.setLocalPosition(0, -0.5, 0);
            avatar.disc.addChild(model);
            avatar.skinDisc = model;
        }
        setGold(goldHolder);
    };
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const screen = new Vec3();
    const head = new Vec3();
    const headOffset = new Vec3(0, 0.12, 0);
    const eye = new Vec3();

    const setAvatar = (id: string, avatarId: string | null, avatarVersion: string | null) => {
        const avatar = avatars.get(id);
        if (!avatar) return;
        avatar.avatarId = avatarId;
        avatar.avatarVersion = avatarVersion;
        const request = ++avatar.avatarRequest;
        if (!avatarId || !avatarVersion) {
            heads.delete(id);
            avatar.character.setHeadImage(null);
            return;
        }
        const url = avatarUrl(avatarId, avatarVersion);
        if (!url) return;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = url;
        void image
            .decode()
            .then(() => {
                if (
                    avatars.get(id) === avatar &&
                    avatar.avatarRequest === request &&
                    avatar.avatarId === avatarId &&
                    avatar.avatarVersion === avatarVersion
                ) {
                    heads.set(id, image);
                    avatar.character.setHeadImage(image);
                }
            })
            .catch(() => {
                if (avatars.get(id) === avatar && avatar.avatarRequest === request) {
                    heads.delete(id);
                    avatar.character.setHeadImage(null);
                }
            });
    };

    const add = (
        id: string,
        name: string,
        hue: number,
        avatarId: string | null = null,
        avatarVersion: string | null = null
    ) => {
        if (avatars.has(id)) return;
        const character = characters.create({ name: `avatar-${id}-rig`, colour: hueColour(hue), gripRightHand: true });
        const root = new Entity(`avatar-${id}`);
        root.addChild(character.root);
        // The capsule uses centre origin. Offset the model down so scaled feet still meet the floor.
        character.root.setLocalPosition(0, -0.9, 0);
        const hand = attachHeldItemSocket(character.root, `avatar-${id}-right-hand-socket`);
        const disc = new Entity(`avatar-disc-${id}`);
        disc.addComponent('render', {
            type: 'cylinder',
            material: character.materials.get('M_Main'),
            castShadows: false
        });
        hand.addChild(disc);
        disc.setLocalScale(0.25, 0.035, 0.25);
        const flashlightProp = new Entity(`avatar-flashlight-${id}`);
        flashlightProp.addComponent('render', { type: 'cylinder', material: flashlightMaterial, castShadows: false });
        flashlightProp.setLocalScale(0.065, 0.17, 0.065);
        flashlightProp.setLocalPosition(0, 0.06, -0.04);
        flashlightProp.setLocalEulerAngles(90, 0, 0);
        hand.addChild(flashlightProp);
        const flashlightLens = new Entity(`avatar-flashlight-lens-${id}`);
        flashlightLens.addComponent('render', { type: 'sphere', material: flashlightLensMaterial, castShadows: false });
        flashlightLens.setLocalScale(0.075, 0.035, 0.075);
        flashlightLens.setLocalPosition(0, 0.085, -0.03);
        flashlightProp.addChild(flashlightLens);
        const flashlightLight = new Entity(`avatar-flashlight-beam-${id}`);
        flashlightLight.addComponent('light', {
            type: 'spot', color: new Color(1, 0.94, 0.75), intensity: 2.8, range: 14,
            innerConeAngle: 20, outerConeAngle: 38, castShadows: false
        });
        flashlightLight.setLocalPosition(0.24, 0.2, -0.35);
        flashlightLight.setLocalEulerAngles(90, 0, 0);
        root.addChild(flashlightLight);
        flashlightProp.enabled = false;
        flashlightLight.enabled = false;
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
        const armorBadge = document.createElement('b');
        armorBadge.className = 'armor-badge';
        armorBadge.textContent = '✚';
        armorBadge.title = '复活甲';
        armorBadge.hidden = true;
        // Health pips, shown briefly over a player who was just hit (two hits, or one to the head, eliminate).
        const pips = document.createElement('span');
        pips.className = 'hp-pips';
        pips.hidden = true;
        for (let i = 0; i < MAX_HP; i++) pips.append(document.createElement('i'));
        tag.append(badge, armorBadge, document.createTextNode(name), pips);
        tag.style.setProperty('--player-colour', `hsl(${hue} 75% 52%)`);
        tag.hidden = true;
        layer.append(tag);
        avatars.set(id, {
            root,
            character,
            headBone: character.root.findByName('Head') as EntityType | null,
            disc,
            goldDisc: null,
            skinDisc: null,
            skin: null,
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
            crouchAmount: 0,
            crouchAt: performance.now(),
            action: null,
            actionUntil: 0,
            throwUntil: 0,
            heldPose: null,
            heldUntil: 0,
            avatarRequest: 0,
            avatarId: null,
            avatarVersion: null,
            flashlight: false,
            flashlightProp,
            flashlightLight
        });
        setAvatar(id, avatarId, avatarVersion);
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
            const postureTarget = pose.crouched ? 1 : 0;
            const postureDt = Math.max(0, Math.min(0.05, (now - avatar.crouchAt) / 1000));
            avatar.crouchAt = now;
            avatar.crouchAmount += (postureTarget - avatar.crouchAmount) * (1 - Math.exp(-postureDt / 0.15));
            avatar.character.setCrouch(avatar.crouchAmount);
            avatar.disc.enabled = now >= avatar.throwUntil;
            avatar.root.setPosition(pose.p[0], pose.p[1], pose.p[2]);
            avatar.root.setEulerAngles(0, pose.yaw, 0);
            avatar.flashlightProp.enabled = avatar.flashlight;
            avatar.flashlightLight.enabled = avatar.flashlight;
            if (avatar.flashlight) avatar.flashlightLight.setLocalEulerAngles(90 + pose.pitch, 0, 0);
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
            if (avatar.headBone) head.copy(avatar.headBone.getPosition()).add(headOffset);
            else head.set(pose.p[0], pose.p[1] - 0.9 + avatar.character.height + 0.06, pose.p[2]);
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
        setFlashlight(id: string, enabled: boolean) {
            const avatar = avatars.get(id);
            if (avatar) avatar.flashlight = enabled;
        },
        setAvatar,
        setHeadImage(id: string, image: HTMLImageElement | HTMLCanvasElement | null) {
            if (image) heads.set(id, image);
            else heads.delete(id);
            avatars.get(id)?.character.setHeadImage(image);
        },
        /** The custom head picture a player is wearing, if any (the ceremony's stand-ins wear it too). */
        headImage: (id: string) => heads.get(id) ?? null,
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
        setReviveArmor(id: string, active: boolean) {
            const badge = avatars.get(id)?.tag.querySelector<HTMLElement>('.armor-badge');
            if (badge) badge.hidden = !active;
        },
        setGold,
        /** Material used for the golden disc attached to the holder's hand. */
        set goldMaterial(material: StandardMaterial) {
            goldMaterial = material;
            setGold(goldHolder);
        },
        setSkin,
        /** Disc skins (render/skinDisc.ts) for discs in players' hands. */
        set skins(library: SkinLibrary) {
            skins = library;
        },
        /** Mesh of the golden disc attached to the holder's hand. */
        set goldMesh(mesh: Mesh) {
            goldMesh = mesh;
            setGold(goldHolder);
        },
        /** Shows the struck player's remaining health pips over their head for a moment (gold flash on a head hit). */
        health(id: string, hp: number, head: boolean) {
            const avatar = avatars.get(id);
            const pips = avatar?.tag.querySelector<HTMLElement>('.hp-pips');
            if (!avatar || !pips) return;
            [...pips.children].forEach((pip, index) => {
                (pip as HTMLElement).dataset.full = String(index < hp);
            });
            pips.dataset.head = String(head);
            pips.hidden = false;
            pips.classList.remove('flash');
            void pips.offsetWidth;
            pips.classList.add('flash');
            window.clearTimeout(Number(pips.dataset.timer ?? 0));
            pips.dataset.timer = String(window.setTimeout(() => (pips.hidden = true), 2500));
        },
        /** Hit-stop: holds the struck player's pose for `ms` (presentation only; positions keep updating). */
        freeze(id: string, ms: number) {
            const avatar = avatars.get(id);
            if (!avatar || ms <= 0) return;
            avatar.character.setSpeed(0);
            window.setTimeout(() => avatars.get(id)?.character.setSpeed(1), ms);
        },
        /** Flashes a struck player white. */
        flash(id: string, now: number) {
            const avatar = avatars.get(id);
            if (avatar) flashes.set(avatar.hue, now + 220);
        },
        has: (id: string) => avatars.has(id),
        hasHeadImage: (id: string) => avatars.get(id)?.character.hasHeadImage() ?? false,
        clear: () => {
            for (const id of [...avatars.keys()]) remove(id);
        }
    };
};

export type Avatars = ReturnType<typeof createAvatars>;
