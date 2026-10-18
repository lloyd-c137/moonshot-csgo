// The camera for the event cutscenes (shots in cutscenes.ts): its own camera entity, eased between shots and pulled
// in front of any wall between the subject and the lens.
import type { AppBase, Entity as EntityType, RigidBodyComponentSystem } from 'playcanvas';
import { Entity, Vec3 } from 'playcanvas';

import type { Shot } from './cutscenes';

type V3 = [number, number, number];

export const createCutsceneView = (app: AppBase, playerCamera: EntityType) => {
    const camera = new Entity('event-cutscene-camera');
    camera.addComponent('camera');
    camera.camera!.copy(playerCamera.camera!);
    camera.enabled = false;
    app.root.addChild(camera);
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    let smoothed: Shot | null = null;
    const from = new Vec3(),
        to = new Vec3();

    /** Keeps the lens on the subject's side of any wall (0.25 m in front of the hit). */
    const clear = (target: V3, eye: V3): V3 => {
        from.set(...target);
        to.set(...eye);
        const hit = rigidbody.raycastFirst(from, to);
        if (!hit) return eye;
        const dx = eye[0] - target[0],
            dy = eye[1] - target[1],
            dz = eye[2] - target[2];
        const length = Math.hypot(dx, dy, dz) || 1;
        const reach = Math.max(0.6, hit.point.distance(from) - 0.25);
        return [target[0] + (dx / length) * reach, target[1] + (dy / length) * reach, target[2] + (dz / length) * reach];
    };

    return {
        get active() {
            return camera.enabled;
        },
        start() {
            smoothed = null;
            playerCamera.enabled = false;
            camera.enabled = true;
        },
        update(shot: Shot, dt: number) {
            const eye = clear(shot.target, shot.eye);
            const k = smoothed ? 1 - Math.exp(-dt * 7) : 1;
            const mix = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
            smoothed = smoothed
                ? { eye: mix(smoothed.eye, eye), target: mix(smoothed.target, shot.target), fov: smoothed.fov + (shot.fov - smoothed.fov) * k }
                : { ...shot, eye };
            camera.setPosition(...smoothed.eye);
            camera.lookAt(new Vec3(...smoothed.target));
            camera.camera!.fov = smoothed.fov;
        },
        stop() {
            camera.enabled = false;
            playerCamera.enabled = true;
            smoothed = null;
        }
    };
};
