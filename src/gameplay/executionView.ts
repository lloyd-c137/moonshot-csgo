// Shared cinematic actor staging and deterministic camera for the Boomerang finisher (paired clips authored in Blender,
// see tools/prepareFinisherAnimation.py), seeked on the shared server timeline.
//
// Smoothness: actors come from a small pool built and drawn once behind the title screen (no skinned-mesh
// instantiation or shader compile when a move starts), wear their players' own colours, and the cinematic camera
// eases in from the player's view instead of cutting.
import { Entity, Vec3 } from 'playcanvas';
import type { AppBase, Mesh, RigidBodyComponentSystem } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';

import { hueColour } from './discs';
import { executionProgress } from './execution';
import type { Execution } from './execution';
import { FinisherDiscController } from './finisher/FinisherDiscController';

type Actor = ReturnType<CharacterAssetLoader['create']> & {
    character: ReturnType<CharacterAssetLoader['create']>;
};

/** Seconds the cinematic camera takes to ease in from the player's own view. */
const CAMERA_BLEND = 0.35;

export const createExecutionView = (
    app: AppBase,
    camera: Entity,
    characters: CharacterAssetLoader,
    discMesh: Mesh,
    onLocalChange: (active: boolean) => void
) => {
    const system = app.systems.rigidbody as RigidBodyComponentSystem;
    const pool: Actor[] = [];
    let built = 0;
    const acquire = (colour: number): Actor => {
        let actor = pool.pop();
        if (!actor) {
            const character = characters.create({ name: `execution-actor-${built++}`, colour: hueColour(colour) });
            app.root.addChild(character.root);
            actor = Object.assign(character, { character });
        }
        actor.setColour(hueColour(colour));
        actor.root.enabled = true;
        return actor;
    };
    const release = (actor: Actor) => {
        actor.root.enabled = false;
        pool.push(actor);
    };
    /** Where the player's own camera was when the cinematic began, for the ease-in. */
    let blendFrom: { eye: Vec3; look: Vec3; fov: number; at: number } | null = null;
    const blendEye = new Vec3(),
        blendLook = new Vec3();
    const ease = (t: number) => {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
    };
    const captureBlend = () => {
        const eye = camera.getPosition().clone();
        blendFrom = {
            eye,
            look: camera.forward.clone().mulScalar(2).add(eye),
            fov: camera.camera!.fov,
            at: performance.now()
        };
    };
    /** Places the cinematic camera, eased from the player's view during the first CAMERA_BLEND seconds. */
    const place = (eye: Vec3, look: Vec3, fov: number) => {
        const t = blendFrom ? ease((performance.now() - blendFrom.at) / 1000 / CAMERA_BLEND) : 1;
        if (blendFrom && t < 1) {
            blendEye.lerp(blendFrom.eye, eye, t);
            blendLook.lerp(blendFrom.look, look, t);
            cinematicCamera.setPosition(blendEye);
            cinematicCamera.lookAt(blendLook);
            cinematicCamera.camera!.fov = blendFrom.fov + (fov - blendFrom.fov) * t;
            return;
        }
        blendFrom = null;
        cinematicCamera.setPosition(eye);
        cinematicCamera.lookAt(look);
        cinematicCamera.camera!.fov = fov;
    };
    const cinematicCamera = new Entity('global-finisher-camera');
    cinematicCamera.addComponent('camera');
    cinematicCamera.camera!.copy(camera.camera!);
    app.root.addChild(cinematicCamera);
    cinematicCamera.enabled = false;
    const originalCameraEnabled = camera.enabled;
    const scenes = new Map<
        string,
        {
            record: Execution;
            attacker: Actor;
            target: Actor;
            disc: FinisherDiscController | null;
            global: boolean;
        }
    >();
    let shot: {
        id: string;
        look: Vec3;
        right: Vec3;
        forward: Vec3;
        radius: number;
        global: boolean;
    } | null = null;
    const useCinematicCamera = () => {
        if (!cinematicCamera.enabled) captureBlend();
        camera.enabled = false;
        cinematicCamera.enabled = true;
    };
    const restoreCamera = (force = false) => {
        if (!shot && !force) return;
        cinematicCamera.enabled = false;
        camera.enabled = originalCameraEnabled;
        shot = null;
        onLocalChange(false);
    };
    const stop = (id: string) => {
        const scene = scenes.get(id);
        if (!scene) return;
        if (shot?.id === id) restoreCamera();
        else if (scene.global) restoreCamera(true);
        release(scene.attacker);
        release(scene.target);
        scene.disc?.destroy();
        scenes.delete(id);
    };
    return {
        /** Builds and draws one pair once (call behind the title screen) so the first real move does not hitch. */
        warm(at: [number, number, number]) {
            const attacker = acquire(0),
                target = acquire(0);
            attacker.root.setPosition(at[0], at[1] - 0.9, at[2]);
            target.root.setPosition(at[0] + 0.8, at[1] - 0.9, at[2]);
            attacker.character.playAt('Finisher_Boomerang_Attacker', 1.15);
            target.character.playAt('Finisher_Boomerang_Victim', 1.15);
            return () => {
                release(attacker);
                release(target);
            };
        },
        start(record: Execution, global = false) {
            if (scenes.has(record.id)) return;
            const attacker = acquire(record.attacker.colour);
            const target = acquire(record.target.colour);
            const disc = global
                ? new FinisherDiscController(discMesh, attacker, target, record.variant === 'THE_BOOMERANG_GOLD')
                : null;
            if (disc) disc.attach(app.root);
            scenes.set(record.id, {
                record,
                attacker,
                target,
                disc,
                global
            });
            if (global) {
                useCinematicCamera();
                onLocalChange(true);
            }
        },
        stop,
        clear() {
            for (const id of [...scenes.keys()]) stop(id);
        },
        hasActor: (id: string) =>
            [...scenes.values()].some((s) => s.record.attacker.id === id || s.record.target.id === id),
        localRecord: (id: string) =>
            [...scenes.values()].find((s) => s.record.attacker.id === id || s.record.target.id === id)?.record ?? null,
        hiddenIds: () => new Set([...scenes.values()].flatMap((s) => [s.record.attacker.id, s.record.target.id])),
        get localActive() {
            return shot !== null;
        },
        update(now: number, self: string) {
            for (const scene of scenes.values()) {
                const { record, attacker, target } = scene;
                const progress = executionProgress(record, now);
                const dx = record.target.pose.p[0] - record.attacker.pose.p[0],
                    dz = record.target.pose.p[2] - record.attacker.pose.p[2],
                    distance = Math.hypot(dx, dz);
                attacker.root.enabled = target.root.enabled = true;
                attacker.root.setPosition(
                    record.attacker.pose.p[0],
                    record.attacker.pose.p[1] - 0.9,
                    record.attacker.pose.p[2]
                );
                attacker.root.setEulerAngles(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0);
                const actionTime = progress * 2.6;
                attacker.character.playAt('Finisher_Boomerang_Attacker', actionTime);
                target.character.playAt('Finisher_Boomerang_Victim', actionTime);
                target.root.setPosition(
                    record.target.pose.p[0],
                    record.target.pose.p[1] - 0.9,
                    record.target.pose.p[2]
                );
                target.root.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
                scene.disc?.update(progress);
                if (!scene.global && record.attacker.id !== self && record.target.id !== self) continue;
                if (!shot) {
                    const look = new Vec3(
                        (record.attacker.pose.p[0] + record.target.pose.p[0]) / 2,
                        record.target.pose.p[1] + 0.3,
                        (record.attacker.pose.p[2] + record.target.pose.p[2]) / 2
                    );
                    const forward = new Vec3(dx / distance, 0, dz / distance),
                        right = new Vec3(-forward.z, 0, forward.x);
                    const radius = record.cameraPlanId === 'OPEN' ? 4.1 : record.cameraPlanId === 'TIGHT' ? 2 : 3;
                    shot = { id: record.id, look, right, forward, radius, global: scene.global };
                    useCinematicCamera();
                    if (!scene.global) onLocalChange(true);
                }
                if (scene.global) {
                    const keyframes = [
                        [0, -0.55, 62],
                        [0.18, -0.18, 58],
                        [0.44, 0.43, 52],
                        [0.63, 0.12, 56],
                        [0.83, -0.32, 56],
                        [1, 0.06, 60]
                    ];
                    let index = 0;
                    while (index < keyframes.length - 2 && progress > keyframes[index + 1][0]) index++;
                    const left = keyframes[index];
                    const rightKey = keyframes[index + 1];
                    const raw = Math.max(0, Math.min(1, (progress - left[0]) / (rightKey[0] - left[0])));
                    const eased = raw * raw * (3 - 2 * raw);
                    const angle = left[1] + (rightKey[1] - left[1]) * eased;
                    const fov = left[2] + (rightKey[2] - left[2]) * eased;
                    const direction = shot.right
                        .clone()
                        .mulScalar(Math.cos(angle))
                        .add(shot.forward.clone().mulScalar(Math.sin(angle)));
                    const desired = shot.look.clone().add(direction.mulScalar(shot.radius));
                    desired.y += 0.85;
                    const hit = system.raycastFirst(shot.look, desired);
                    const distance = shot.look.distance(desired);
                    const eye = hit
                        ? shot.look.clone().lerp(shot.look, hit.point, Math.max(0.15, 1 - 0.28 / distance))
                        : desired;
                    place(eye, shot.look, fov);
                } else {
                    const eye = shot.look.clone().add(shot.right.clone().mulScalar(4.2));
                    eye.y += 0.9;
                    place(eye, shot.look, 86);
                }
            }
        },
        debug(now: number, self: string) {
            return [...scenes.values()].map((s) => ({
                id: s.record.id,
                role: s.record.attacker.id === self ? 'attacker' : s.record.target.id === self ? 'target' : 'observer',
                progress: executionProgress(s.record, now),
                actorsVisible: s.attacker.root.enabled && s.target.root.enabled,
                camera: shot?.id === s.record.id,
                attackerAnimation: s.attacker.character.animationState(),
                targetAnimation: s.target.character.animationState(),
                renderedParts:
                    s.attacker.root.findComponents('render').length + s.target.root.findComponents('render').length,
                cameraPosition: (shot?.id === s.record.id ? cinematicCamera : camera).getPosition().toArray()
            }));
        }
    };
};
