// Original GAMEPLAY_AUTHORED paired animation for the existing simple avatar style. No imported animation assets.
import type { AppBase, Entity, RigidBodyComponentSystem } from 'playcanvas';
import { Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';

import { executionFrame, executionProgress } from './execution';
import type { Execution, ExecutionActor } from './execution';

const makeActor = (app: AppBase, characters: CharacterAssetLoader, actor: ExecutionActor) => {
    const character = characters.create({ name: `execution-actor-${actor.id}`, colour: [0.12, 0.55, 0.82] });
    app.root.addChild(character.root);
    return { ...character, character, root: character.root };
};

export const createExecutionView = (
    app: AppBase,
    camera: Entity,
    characters: CharacterAssetLoader,
    onLocalChange: (active: boolean) => void
) => {
    const system = app.systems.rigidbody as RigidBodyComponentSystem;
    const scenes = new Map<
        string,
        { record: Execution; attacker: ReturnType<typeof makeActor>; target: ReturnType<typeof makeActor> }
    >();
    let shot: {
        id: string;
        parent: Entity;
        position: Vec3;
        rotation: ReturnType<Entity['getLocalRotation']>;
        fov: number;
        eye: Vec3;
        look: Vec3;
    } | null = null;
    const restoreCamera = () => {
        if (!shot) return;
        shot.parent.addChild(camera);
        camera.setLocalPosition(shot.position);
        camera.setLocalRotation(shot.rotation);
        camera.camera!.fov = shot.fov;
        shot = null;
        onLocalChange(false);
    };
    const stop = (id: string) => {
        const scene = scenes.get(id);
        if (!scene) return;
        if (shot?.id === id) restoreCamera();
        scene.attacker.dispose();
        scene.target.dispose();
        scenes.delete(id);
    };
    return {
        start(record: Execution) {
            if (scenes.has(record.id)) return;
            scenes.set(record.id, {
                record,
                attacker: makeActor(app, characters, record.attacker),
                target: makeActor(app, characters, record.target)
            });
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
                const frame = executionFrame(executionProgress(record, now));
                const dx = record.target.pose.p[0] - record.attacker.pose.p[0],
                    dz = record.target.pose.p[2] - record.attacker.pose.p[2],
                    distance = Math.hypot(dx, dz);
                const lunge = Math.min(0.4, Math.max(0, distance - 0.85)) * frame.reach * (1 - frame.recover);
                attacker.root.enabled = target.root.enabled = true;
                attacker.root.setPosition(
                    record.attacker.pose.p[0] + (dx / distance) * lunge,
                    record.attacker.pose.p[1] - 0.9,
                    record.attacker.pose.p[2] + (dz / distance) * lunge
                );
                attacker.root.setEulerAngles(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0);
                attacker.character.play(frame.reach > 0.45 ? 'Punch_Cross' : 'Interact', 0.08);
                target.character.play(frame.fall > 0.1 ? 'Death01' : 'Hit_Chest', 0.08);
                target.root.setPosition(
                    record.target.pose.p[0],
                    record.target.pose.p[1] - 0.9 - Math.min(0.45, frame.fall * 0.45),
                    record.target.pose.p[2]
                );
                target.root.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, frame.fall * 45);
                if (record.attacker.id !== self && record.target.id !== self) continue;
                if (!shot) {
                    const saved = {
                        parent: camera.parent as Entity,
                        position: camera.getLocalPosition().clone(),
                        rotation: camera.getLocalRotation().clone(),
                        fov: camera.camera!.fov
                    };
                    onLocalChange(true);
                    const look = new Vec3(
                        (record.attacker.pose.p[0] + record.target.pose.p[0]) / 2,
                        record.target.pose.p[1] + 0.3,
                        (record.attacker.pose.p[2] + record.target.pose.p[2]) / 2
                    );
                    const forward = new Vec3(dx / distance, 0, dz / distance),
                        right = new Vec3(-forward.z, 0, forward.x);
                    let eye = look.clone();
                    const directions = [
                        right.clone(),
                        right.clone().mulScalar(-1),
                        forward.clone(),
                        forward.clone().mulScalar(-1),
                        right.clone().add(forward),
                        right.clone().sub(forward),
                        right.clone().mulScalar(-1).add(forward),
                        right.clone().mulScalar(-1).sub(forward)
                    ];
                    let bestScore = -Infinity;
                    for (const direction of directions) {
                        direction.normalize();
                        const candidate = look.clone().add(direction.mulScalar(4.2));
                        candidate.y += 0.9;
                        const hit = system.raycastFirst(look, candidate);
                        const wanted = hit
                            ? look.clone().lerp(look, hit.point, Math.max(0, 1 - 0.22 / look.distance(hit.point)))
                            : candidate;
                        const clearance = look.distance(wanted);
                        const score = clearance - Math.abs(direction.dot(forward)) * 4.5;
                        if (clearance > 0.35 && score > bestScore) {
                            bestScore = score;
                            eye = wanted;
                        }
                    }
                    app.root.addChild(camera);
                    shot = { id: record.id, ...saved, eye, look };
                }
                // Both participants use the same fixed, collision-clamped shot. No orbit, camera shake or FOV pulse.
                camera.setPosition(shot.eye);
                camera.lookAt(shot.look);
                camera.camera!.fov = 86;
            }
        },
        debug(now: number, self: string) {
            return [...scenes.values()].map((s) => ({
                id: s.record.id,
                role: s.record.attacker.id === self ? 'attacker' : s.record.target.id === self ? 'target' : 'observer',
                progress: executionProgress(s.record, now),
                frame: executionFrame(executionProgress(s.record, now)),
                actorsVisible: s.attacker.root.enabled && s.target.root.enabled,
                camera: shot?.id === s.record.id,
                attackerArm: executionFrame(executionProgress(s.record, now)).attackerArm,
                targetLean: executionFrame(executionProgress(s.record, now)).targetLean,
                renderedParts:
                    s.attacker.root.findComponents('render').length + s.target.root.findComponents('render').length,
                cameraPosition: camera.getPosition().toArray()
            }));
        }
    };
};
