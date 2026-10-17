// GAMEPLAY_AUTHORED paired disc finisher on the shared CC0 humanoid rig (Quaternius UAL clips, see
// docs/CHARACTER_ASSET_AUDIT.md), timed by EXECUTION_TIMELINE in execution.ts.
import type { AppBase, Entity, RigidBodyComponentSystem } from 'playcanvas';
import { Entity as EntityClass, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { attachHeldItemSocket } from '../characters/heldItemSocket';

import { hueColour } from './discs';
import { executionFrame, executionProgress } from './execution';
import type { Execution, ExecutionActor } from './execution';

const makeActor = (app: AppBase, characters: CharacterAssetLoader, actor: ExecutionActor, disc: boolean) => {
    // Each actor wears its player's own solid colour, so everyone can tell who finished whom.
    const character = characters.create({
        name: `execution-actor-${actor.id}`,
        colour: hueColour(actor.colour),
        gripRightHand: disc
    });
    if (disc) {
        const hand = attachHeldItemSocket(character.root, `execution-disc-socket-${actor.id}`);
        const held = new EntityClass(`execution-disc-${actor.id}`);
        held.addComponent('render', {
            type: 'cylinder',
            material: character.materials.get('M_Main'),
            castShadows: false
        });
        hand.addChild(held);
        held.setLocalScale(0.25, 0.035, 0.25);
    }
    app.root.addChild(character.root);
    return { ...character, character, root: character.root };
};

export const createExecutionView = (
    app: AppBase,
    camera: Entity,
    characters: CharacterAssetLoader,
    onLocalChange: (active: boolean) => void,
    /** Once per move, at the blow: where the target's head is, and whether this client takes part. */
    onImpact: (record: Execution, at: [number, number, number], local: boolean) => void = () => undefined
) => {
    const system = app.systems.rigidbody as RigidBodyComponentSystem;
    const scenes = new Map<
        string,
        {
            record: Execution;
            attacker: ReturnType<typeof makeActor>;
            target: ReturnType<typeof makeActor>;
            struck: boolean;
        }
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
                attacker: makeActor(app, characters, record.attacker, true),
                target: makeActor(app, characters, record.target, false),
                struck: false
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
                // Step in to striking distance (0.85 m), settle back as the move ends.
                const lunge = Math.min(0.6, Math.max(0, distance - 0.85)) * frame.close * (1 - frame.recover);
                attacker.root.enabled = target.root.enabled = true;
                attacker.root.setPosition(
                    record.attacker.pose.p[0] + (dx / distance) * lunge,
                    record.attacker.pose.p[1] - 0.9,
                    record.attacker.pose.p[2] + (dz / distance) * lunge
                );
                attacker.root.setEulerAngles(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0);
                // Disc raised (grab), brought down overhead (strike), held through the fall, then back to idle.
                attacker.character.play(
                    frame.phase === 'approach' || frame.phase === 'grab'
                        ? 'Interact'
                        : frame.phase === 'recover'
                          ? 'Idle_Loop'
                          : 'Sword_Attack',
                    0.1
                );
                // The death clip alone carries the fall: no extra roll or sinking on top of it.
                target.character.play(
                    frame.impact ? 'Death01' : frame.phase === 'approach' ? 'Idle_Loop' : 'Hit_Chest',
                    0.08
                );
                target.root.setPosition(
                    record.target.pose.p[0],
                    record.target.pose.p[1] - 0.9,
                    record.target.pose.p[2]
                );
                target.root.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
                if (frame.impact && !scene.struck) {
                    scene.struck = true;
                    const local = record.attacker.id === self || record.target.id === self;
                    onImpact(
                        record,
                        [record.target.pose.p[0], record.target.pose.p[1] + 0.75, record.target.pose.p[2]],
                        local
                    );
                }
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
                phase: executionFrame(executionProgress(s.record, now)).phase,
                struck: s.struck,
                renderedParts:
                    s.attacker.root.findComponents('render').length + s.target.root.findComponents('render').length,
                cameraPosition: camera.getPosition().toArray()
            }));
        }
    };
};
