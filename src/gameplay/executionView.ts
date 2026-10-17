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
import {
    FINISHER_STRIKE,
    finisherCamera,
    finisherFlight,
    finisherPunch,
    finisherWarp
} from './finisher/finisherTiming';
import { TOSS, tossApproach } from './finisher/tossTimeline';

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
    onLocalChange: (active: boolean) => void,
    /** Presentation hooks: the strike (once per move) and the disc trail (a few times per frame interval). */
    hooks: {
        impact?: (at: [number, number, number], record: Execution) => void;
        trail?: (at: [number, number, number], gold: boolean) => void;
    } = {}
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
            /** performance.now() at the move's start: the film runs on this smooth local clock. */
            localStart: number | null;
            impacted: boolean;
            trailAt: number;
        }
    >();
    /** Real seconds since the last update (camera smoothing). */
    let lastUpdate = performance.now();
    let shot: {
        id: string;
        look: Vec3;
        right: Vec3;
        forward: Vec3;
        radius: number;
        global: boolean;
        /** Smoothed camera distance after wall collision (pulls in at once, eases back out). */
        reach: number;
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
            attacker.character.playAt('Finisher_Toss_Attacker', 1.15);
            target.character.playAt('Finisher_Toss_Victim', 1.15);
            // Both disc finishes too, so their glowing material's shader is compiled before the first real move.
            const discs = [false, true].map((gold) => {
                const disc = new FinisherDiscController(discMesh, attacker, target, gold);
                disc.attach(app.root);
                disc.update(0.3);
                return disc;
            });
            return () => {
                for (const disc of discs) disc.destroy();
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
                global,
                localStart: null,
                impacted: false,
                trailAt: 0
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
            const real = performance.now();
            const dt = Math.min(0.1, (real - lastUpdate) / 1000);
            lastUpdate = real;
            for (const scene of scenes.values()) {
                const { record, attacker, target } = scene;
                // The estimated server clock is corrected packet by packet; driving clips from it made them jump.
                // Anchor once to the local monotonic clock and only re-anchor on a large disagreement.
                const duration = record.endsAt - record.startsAt;
                const expected = real - (now - record.startsAt);
                if (scene.localStart === null || Math.abs(scene.localStart - expected) > 250)
                    scene.localStart = expected;
                const progress = Math.max(0, Math.min(1, (real - scene.localStart) / duration));
                // Film time: bullet time on the strike, same 2.6 s overall (finisherTiming.ts).
                const film = finisherWarp(progress);
                const dx = record.target.pose.p[0] - record.attacker.pose.p[0],
                    dz = record.target.pose.p[2] - record.attacker.pose.p[2],
                    distance = Math.hypot(dx, dz);
                attacker.root.enabled = target.root.enabled = true;
                // THE TOSS: the attacker strolls in from behind, ending on their real position.
                const behind = (TOSS.approach * (1 - tossApproach(film * TOSS.frames))) / Math.max(distance, 1e-6);
                attacker.root.setPosition(
                    record.attacker.pose.p[0] - dx * behind,
                    record.attacker.pose.p[1] - 0.9,
                    record.attacker.pose.p[2] - dz * behind
                );
                attacker.root.setEulerAngles(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0);
                const actionTime = film * 2.6;
                // Seek every frame on the smooth local clock: immune to slow motion and hit-stop on app.timeScale.
                attacker.character.playAt('Finisher_Toss_Attacker', actionTime, 0.045, 0);
                target.character.playAt('Finisher_Toss_Victim', actionTime, 0.045, 0);
                target.root.setPosition(
                    record.target.pose.p[0],
                    record.target.pose.p[1] - 0.9,
                    record.target.pose.p[2]
                );
                target.root.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
                scene.disc?.update(film);
                const frame = film * TOSS.frames;
                const flying =
                    (frame > TOSS.tossRelease && frame < TOSS.tossCatch) ||
                    (frame > TOSS.throwRelease && frame < TOSS.homeCatch);
                if (scene.disc && hooks.trail && flying && real >= scene.trailAt) {
                    scene.trailAt = real + 28;
                    const at = scene.disc.position;
                    hooks.trail([at.x, at.y, at.z], record.variant === 'THE_BOOMERANG_GOLD');
                }
                if (!scene.impacted && film >= FINISHER_STRIKE) {
                    scene.impacted = true;
                    hooks.impact?.(
                        [record.target.pose.p[0], record.target.pose.p[1] + 0.45, record.target.pose.p[2]],
                        record
                    );
                }
                const punch = finisherPunch(film);
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
                    shot = { id: record.id, look, right, forward, radius, global: scene.global, reach: radius };
                    useCinematicCamera();
                    if (!scene.global) onLocalChange(true);
                }
                if (scene.global) {
                    // One continuous orbit (Catmull-Rom through the keys), pushed in and shaken on the strike.
                    const { angle, fov } = finisherCamera(film);
                    // While the disc is far out ahead the frame widens and leans forward to keep it in view.
                    const flight = finisherFlight(film);
                    const focus = shot.look.clone().add(shot.forward.clone().mulScalar(2.6 * flight));
                    const direction = shot.right
                        .clone()
                        .mulScalar(Math.cos(angle))
                        .add(shot.forward.clone().mulScalar(Math.sin(angle)));
                    const wanted = shot.radius * (1 + 0.55 * flight) * (1 - 0.22 * punch);
                    const probe = focus.clone().add(direction.clone().mulScalar(wanted));
                    probe.y += 0.85;
                    const hit = system.raycastFirst(focus, probe);
                    const free = hit ? Math.max(0.6, focus.distance(hit.point) - 0.28) : wanted;
                    // Walls pull the camera in at once; it eases back out instead of popping.
                    shot.reach = free < shot.reach ? free : Math.min(free, shot.reach + dt * 2.5);
                    const scale = Math.min(1, shot.reach / Math.max(0.01, wanted));
                    const eye = focus.clone().add(direction.mulScalar(shot.reach));
                    eye.y += 0.85 * scale;
                    const shake = 0.07 * punch;
                    eye.x += Math.sin(real * 0.09) * shake;
                    eye.y += Math.sin(real * 0.113 + 1) * shake;
                    eye.z += Math.cos(real * 0.071) * shake;
                    place(eye, focus, fov - 6 * punch);
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
