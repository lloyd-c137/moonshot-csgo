// Shared cinematic actor staging and deterministic camera. The current mannequin action clips remain temporary until
// the authored, paired Blender GLB is installed; this module must not be represented as final Boomerang animation.
import { Entity, Vec3 } from 'playcanvas';
import type { AppBase, Mesh, RigidBodyComponentSystem } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';

import { executionProgress } from './execution';
import type { Execution, ExecutionActor } from './execution';
import { FinisherDiscController } from './finisher/FinisherDiscController';

const actorColour = (hue: number): [number, number, number] => {
    const h = ((hue % 360) + 360) % 360;
    const f = (n: number) => {
        const k = (n + h / 60) % 6;
        return 0.28 + 0.64 * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
};

const makeActor = (app: AppBase, characters: CharacterAssetLoader, actor: ExecutionActor) => {
    const character = characters.create({ name: `execution-actor-${actor.id}`, colour: actorColour(actor.colour) });
    app.root.addChild(character.root);
    return { ...character, character, root: character.root };
};

export const createExecutionView = (
    app: AppBase,
    camera: Entity,
    characters: CharacterAssetLoader,
    discMesh: Mesh,
    onLocalChange: (active: boolean) => void
) => {
    const system = app.systems.rigidbody as RigidBodyComponentSystem;
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
            attacker: ReturnType<typeof makeActor>;
            target: ReturnType<typeof makeActor>;
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
        scene.attacker.dispose();
        scene.target.dispose();
        scene.disc?.destroy();
        scenes.delete(id);
    };
    return {
        start(record: Execution, global = false) {
            if (scenes.has(record.id)) return;
            const attacker = makeActor(app, characters, record.attacker);
            const target = makeActor(app, characters, record.target);
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
                attacker.root.setPosition(record.attacker.pose.p[0], record.attacker.pose.p[1] - 0.9, record.attacker.pose.p[2]);
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
                    const direction = shot.right.clone().mulScalar(Math.cos(angle)).add(shot.forward.clone().mulScalar(Math.sin(angle)));
                    const desired = shot.look.clone().add(direction.mulScalar(shot.radius));
                    desired.y += 0.85;
                    const hit = system.raycastFirst(shot.look, desired);
                    const distance = shot.look.distance(desired);
                    const eye = hit
                        ? shot.look.clone().lerp(shot.look, hit.point, Math.max(0.15, 1 - 0.28 / distance))
                        : desired;
                    cinematicCamera.setPosition(eye);
                    cinematicCamera.lookAt(shot.look);
                    cinematicCamera.camera!.fov = fov;
                } else {
                    const eye = shot.look.clone().add(shot.right.clone().mulScalar(4.2));
                    eye.y += 0.9;
                    cinematicCamera.setPosition(eye);
                    cinematicCamera.lookAt(shot.look);
                    cinematicCamera.camera!.fov = 86;
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
