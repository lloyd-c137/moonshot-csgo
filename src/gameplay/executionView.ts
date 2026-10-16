// Original GAMEPLAY_AUTHORED paired animation for the existing simple avatar style. No imported animation assets.
import type { AppBase, RigidBodyComponentSystem } from 'playcanvas';
import { Color, Entity, StandardMaterial, Vec3 } from 'playcanvas';

import { hueColour } from './discs';
import { executionFrame, executionProgress } from './execution';
import type { Execution, ExecutionActor } from './execution';

const makeMaterial = (colour: readonly number[]) => {
    const material = new StandardMaterial();
    material.diffuse = new Color(colour[0], colour[1], colour[2]);
    material.update();
    return material;
};

const makeActor = (app: AppBase, actor: ExecutionActor) => {
    const root = new Entity(`execution-actor-${actor.id}`);
    app.root.addChild(root);
    const body = makeMaterial(hueColour(actor.colour)),
        skin = makeMaterial([0.93, 0.8, 0.68]),
        dark = makeMaterial([0.08, 0.09, 0.11]);
    const part = (
        parent: Entity,
        name: string,
        type: 'box' | 'sphere' | 'capsule' | 'cylinder',
        position: number[],
        scale: number[],
        material: StandardMaterial
    ) => {
        const entity = new Entity(name);
        parent.addChild(entity);
        entity.addComponent('render', { type, material, castShadows: false });
        entity.setLocalPosition(position[0], position[1], position[2]);
        entity.setLocalScale(scale[0], scale[1], scale[2]);
        return entity;
    };
    const hips = new Entity('hips');
    root.addChild(hips);
    const torso = new Entity('torso');
    hips.addChild(torso);
    part(torso, 'body', 'capsule', [0, 0.34, 0], [0.43, 0.76, 0.36], body);
    part(torso, 'head', 'sphere', [0, 0.87, 0], [0.32, 0.36, 0.32], skin);
    part(torso, 'visor', 'box', [0, 0.9, -0.16], [0.22, 0.07, 0.04], dark);
    const arm = (side: number) => {
        const shoulder = new Entity('shoulder');
        shoulder.setLocalPosition(side * 0.27, 0.67, 0);
        torso.addChild(shoulder);
        part(shoulder, 'upper-arm', 'capsule', [0, -0.17, 0], [0.13, 0.34, 0.13], body);
        const elbow = new Entity('elbow');
        elbow.setLocalPosition(0, -0.34, 0);
        shoulder.addChild(elbow);
        part(elbow, 'forearm', 'capsule', [0, -0.15, 0], [0.12, 0.3, 0.12], body);
        part(elbow, 'hand', 'sphere', [0, -0.32, 0], [0.14, 0.14, 0.14], skin);
        return { shoulder, elbow };
    };
    const left = arm(-1),
        right = arm(1);
    const disc = part(right.elbow, 'disc', 'cylinder', [0, -0.35, -0.1], [0.27, 0.035, 0.27], body);
    const legs = [-1, 1].map((side) => {
        const hip = new Entity('hip');
        hip.setLocalPosition(side * 0.11, 0, 0);
        hips.addChild(hip);
        part(hip, 'thigh', 'capsule', [0, -0.18, 0], [0.14, 0.36, 0.14], body);
        const knee = new Entity('knee');
        knee.setLocalPosition(0, -0.36, 0);
        hip.addChild(knee);
        part(knee, 'calf', 'capsule', [0, -0.17, 0], [0.13, 0.34, 0.13], body);
        return { hip, knee };
    });
    root.setPosition(actor.pose.p[0], actor.pose.p[1] - 0.9, actor.pose.p[2]);
    root.setEulerAngles(0, actor.pose.yaw, 0);
    return {
        root,
        hips,
        torso,
        left,
        right,
        legs,
        disc,
        destroy: () => {
            root.destroy();
            body.destroy();
            skin.destroy();
            dark.destroy();
        }
    };
};

export const createExecutionView = (app: AppBase, camera: Entity, onLocalChange: (active: boolean) => void) => {
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
        scene.attacker.destroy();
        scene.target.destroy();
        scenes.delete(id);
    };
    return {
        start(record: Execution) {
            if (scenes.has(record.id)) return;
            scenes.set(record.id, {
                record,
                attacker: makeActor(app, record.attacker),
                target: makeActor(app, record.target)
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
                attacker.root.setPosition(
                    record.attacker.pose.p[0] + (dx / distance) * lunge,
                    record.attacker.pose.p[1] - 0.9,
                    record.attacker.pose.p[2] + (dz / distance) * lunge
                );
                attacker.root.setEulerAngles(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0);
                attacker.hips.setLocalPosition(0, 0.72, 0);
                attacker.torso.setLocalEulerAngles(-frame.attackerLean, 0, 0);
                attacker.left.shoulder.setLocalEulerAngles(
                    80 * frame.reach * (1 - frame.recover),
                    0,
                    -20 * frame.reach
                );
                attacker.left.elbow.setLocalEulerAngles(-30 * frame.reach, 0, 0);
                attacker.right.shoulder.setLocalEulerAngles(frame.attackerArm, 0, 15 * frame.reach);
                attacker.right.elbow.setLocalEulerAngles(-40 * frame.reach, 0, 0);
                const upper = 65 * frame.fall,
                    knee = -100 * frame.fall;
                target.hips.setLocalPosition(
                    0,
                    0.36 * Math.cos((upper * Math.PI) / 180) + 0.34 * Math.cos(((upper + knee) * Math.PI) / 180) + 0.02,
                    0
                );
                target.torso.setLocalEulerAngles(-frame.targetLean, 0, 15 * frame.fall);
                for (const leg of target.legs) {
                    leg.hip.setLocalEulerAngles(upper, 0, 0);
                    leg.knee.setLocalEulerAngles(knee, 0, 0);
                }
                target.left.shoulder.setLocalEulerAngles(frame.targetArm, 0, -30 * frame.reach);
                target.right.shoulder.setLocalEulerAngles(frame.targetArm, 0, 30 * frame.reach);
                target.disc.enabled = false;
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
                attackerArm: s.attacker.right.shoulder.getLocalEulerAngles().x,
                targetLean: s.target.torso.getLocalEulerAngles().x,
                renderedParts:
                    s.attacker.root.findComponents('render').length + s.target.root.findComponents('render').length,
                cameraPosition: camera.getPosition().toArray()
            }));
        }
    };
};
