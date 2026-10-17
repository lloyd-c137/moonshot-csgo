// GAMEPLAY_AUTHORED paired disc finisher on the shared CC0 humanoid rig (Quaternius UAL clips, see
// docs/CHARACTER_ASSET_AUDIT.md), timed by EXECUTION_TIMELINE / finisherClips in execution.ts.
//
// Smoothness: actors come from a small pool built and drawn once at start-up (no skinned-mesh instantiation, material
// cloning or shader compile when a move starts); clip changes start at the offset the move's progress implies and
// never cut a clip part-way; the fallen target stays until its death clip ends; the camera eases into the shot.
import type { AppBase, Entity, RigidBodyComponentSystem } from 'playcanvas';
import { Entity as EntityClass, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { attachHeldItemSocket } from '../characters/heldItemSocket';

import { hueColour } from './discs';
import { EXECUTION, executionFrame, executionProgress, finisherClips, finisherLingerMs } from './execution';
import type { ClipCue, Execution } from './execution';

type Actor = ReturnType<CharacterAssetLoader['create']> & { clip: string; speed: number };

/** Seconds the camera takes to ease from first person into the shared shot. */
const CAMERA_BLEND = 0.35;
const DURATION_SECONDS = EXECUTION.durationMs / 1000;

export const createExecutionView = (
    app: AppBase,
    camera: Entity,
    characters: CharacterAssetLoader,
    onLocalChange: (active: boolean) => void,
    /** Once per move, at the blow: where the target's head is, and whether this client takes part. */
    onImpact: (record: Execution, at: [number, number, number], local: boolean) => void = () => undefined
) => {
    const system = app.systems.rigidbody as RigidBodyComponentSystem;
    const clips = {
        Sword_Attack: 0,
        Hit_Chest: 0,
        Death01: 0
    };
    const pools = { attacker: [] as Actor[], target: [] as Actor[] };
    let built = 0;
    const build = (role: 'attacker' | 'target'): Actor => {
        const character = characters.create({
            name: `execution-${role}-${built++}`,
            colour: [0.5, 0.5, 0.5],
            gripRightHand: role === 'attacker'
        });
        if (role === 'attacker') {
            const hand = attachHeldItemSocket(character.root, `${character.root.name}-disc-socket`);
            const held = new EntityClass(`${character.root.name}-disc`);
            held.addComponent('render', {
                type: 'cylinder',
                material: character.materials.get('M_Main'),
                castShadows: false
            });
            hand.addChild(held);
            held.setLocalScale(0.25, 0.035, 0.25);
        }
        character.root.enabled = false;
        app.root.addChild(character.root);
        for (const name of Object.keys(clips) as (keyof typeof clips)[])
            clips[name] = character.duration(name) || clips[name];
        return Object.assign(character, { clip: '', speed: 1 });
    };
    const acquire = (role: 'attacker' | 'target', colour: number) => {
        const actor = pools[role].pop() ?? build(role);
        actor.setColour(hueColour(colour));
        actor.clip = '';
        actor.root.enabled = true;
        return actor;
    };
    const release = (role: 'attacker' | 'target', actor: Actor) => {
        actor.root.enabled = false;
        pools[role].push(actor);
    };
    const cue = (actor: Actor, next: ClipCue, blend: number) => {
        if (actor.speed !== next.speed) {
            actor.speed = next.speed;
            actor.setSpeed(next.speed);
        }
        if (actor.clip === next.clip) return;
        actor.clip = next.clip;
        actor.play(next.clip, blend, next.offset);
    };

    type Scene = { record: Execution; attacker: Actor; target: Actor; struck: boolean };
    const scenes = new Map<string, Scene>();
    /** Fallen targets finishing their death clip after the move ended. */
    const fallen: { actor: Actor; until: number }[] = [];
    let shot: {
        id: string;
        parent: Entity;
        position: Vec3;
        rotation: ReturnType<Entity['getLocalRotation']>;
        fov: number;
        fromEye: Vec3;
        fromLook: Vec3;
        eye: Vec3;
        look: Vec3;
        startedAt: number;
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
    /** Ends a move; a completed one leaves its target falling until the death clip is over. */
    const stop = (id: string, completed = false) => {
        const scene = scenes.get(id);
        if (!scene) return;
        if (shot?.id === id) restoreCamera();
        release('attacker', scene.attacker);
        if (completed && scene.target.clip === 'Death01')
            fallen.push({ actor: scene.target, until: performance.now() + finisherLingerMs(DURATION_SECONDS) });
        else release('target', scene.target);
        scenes.delete(id);
    };
    const eyeFor = (record: Execution, look: Vec3) => {
        const dx = record.target.pose.p[0] - record.attacker.pose.p[0],
            dz = record.target.pose.p[2] - record.attacker.pose.p[2],
            distance = Math.hypot(dx, dz) || 1;
        const forward = new Vec3(dx / distance, 0, dz / distance),
            right = new Vec3(-forward.z, 0, forward.x);
        let eye = look.clone();
        let bestScore = -Infinity;
        for (const direction of [
            right.clone(),
            right.clone().mulScalar(-1),
            forward.clone(),
            forward.clone().mulScalar(-1),
            right.clone().add(forward),
            right.clone().sub(forward),
            right.clone().mulScalar(-1).add(forward),
            right.clone().mulScalar(-1).sub(forward)
        ]) {
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
        return eye;
    };
    const ease = (t: number) => {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
    };
    const blendEye = new Vec3(),
        blendLook = new Vec3();

    return {
        /** Builds and draws one pair once (call behind the title screen) so the first real move does not hitch. */
        warm(at: [number, number, number]) {
            const attacker = acquire('attacker', 0),
                target = acquire('target', 0);
            attacker.root.setPosition(at[0], at[1] - 0.9, at[2]);
            target.root.setPosition(at[0] + 0.8, at[1] - 0.9, at[2]);
            attacker.play('Sword_Attack', 0);
            target.play('Death01', 0);
            return () => {
                release('attacker', attacker);
                release('target', target);
            };
        },
        start(record: Execution) {
            if (scenes.has(record.id)) return;
            scenes.set(record.id, {
                record,
                attacker: acquire('attacker', record.attacker.colour),
                target: acquire('target', record.target.colour),
                struck: false
            });
        },
        stop,
        clear() {
            for (const id of [...scenes.keys()]) stop(id);
            for (const { actor } of fallen.splice(0)) release('target', actor);
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
            const wall = performance.now();
            for (let i = fallen.length - 1; i >= 0; i--) {
                if (wall < fallen[i].until) continue;
                release('target', fallen[i].actor);
                fallen.splice(i, 1);
            }
            for (const scene of scenes.values()) {
                const { record, attacker, target } = scene;
                const progress = executionProgress(record, now);
                const frame = executionFrame(progress);
                const dx = record.target.pose.p[0] - record.attacker.pose.p[0],
                    dz = record.target.pose.p[2] - record.attacker.pose.p[2],
                    distance = Math.hypot(dx, dz) || 1;
                // Step in to striking distance (0.85 m), settle back as the move ends.
                const lunge = Math.min(0.6, Math.max(0, distance - 0.85)) * frame.close * (1 - frame.recover);
                attacker.root.setPosition(
                    record.attacker.pose.p[0] + (dx / distance) * lunge,
                    record.attacker.pose.p[1] - 0.9,
                    record.attacker.pose.p[2] + (dz / distance) * lunge
                );
                attacker.root.setEulerAngles(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0);
                target.root.setPosition(
                    record.target.pose.p[0],
                    record.target.pose.p[1] - 0.9,
                    record.target.pose.p[2]
                );
                target.root.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
                const next = finisherClips(progress, DURATION_SECONDS, clips);
                cue(attacker, next.attacker, next.attacker.clip === 'Idle_Loop' ? 0.3 : 0.15);
                cue(target, next.target, next.target.clip === 'Death01' ? 0.12 : 0.06);
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
                    const fromEye = camera.getPosition().clone();
                    const fromLook = camera.forward.clone().mulScalar(2).add(fromEye);
                    onLocalChange(true);
                    const look = new Vec3(
                        (record.attacker.pose.p[0] + record.target.pose.p[0]) / 2,
                        record.target.pose.p[1] + 0.3,
                        (record.attacker.pose.p[2] + record.target.pose.p[2]) / 2
                    );
                    const eye = eyeFor(record, look);
                    app.root.addChild(camera);
                    shot = { id: record.id, ...saved, fromEye, fromLook, eye, look, startedAt: wall };
                }
                // Both participants share one fixed, collision-clamped shot, eased in from first person.
                const t = ease((wall - shot.startedAt) / 1000 / CAMERA_BLEND);
                blendEye.lerp(shot.fromEye, shot.eye, t);
                blendLook.lerp(shot.fromLook, shot.look, t);
                camera.setPosition(blendEye);
                camera.lookAt(blendLook);
                camera.camera!.fov = shot.fov + (86 - shot.fov) * t;
            }
        },
        debug(now: number, self: string) {
            return [...scenes.values()].map((s) => {
                const progress = executionProgress(s.record, now);
                return {
                    id: s.record.id,
                    role:
                        s.record.attacker.id === self
                            ? 'attacker'
                            : s.record.target.id === self
                              ? 'target'
                              : 'observer',
                    progress,
                    frame: executionFrame(progress),
                    actorsVisible: s.attacker.root.enabled && s.target.root.enabled,
                    camera: shot?.id === s.record.id,
                    phase: executionFrame(progress).phase,
                    clips: [s.attacker.clip, s.target.clip],
                    struck: s.struck,
                    pooled: pools.attacker.length + pools.target.length,
                    renderedParts:
                        s.attacker.root.findComponents('render').length + s.target.root.findComponents('render').length,
                    cameraPosition: camera.getPosition().toArray()
                };
            });
        }
    };
};
