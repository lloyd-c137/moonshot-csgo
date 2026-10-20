import type { AppBase, Entity, RigidBodyComponentSystem } from 'playcanvas';
import { Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import { PLAYER } from '../config/gameplay';
import { input } from '../input/InputManager';

/**
 * Step-up for the upstream capsule controller, which cannot climb a ledge: when the player walks into a step no
 * higher than `maxStep` (stand rows, kerbs, the court surround's sill) a small vertical boost lifts them onto it.
 * GAMEPLAY_AUTHORED; jumps and slopes are untouched.
 */
export const STEP_ASSIST = { maxStep: 0.5, minStep: 0.06, reach: 0.22, cooldown: 0.12 } as const;

/** Upward speed that lifts the capsule's feet `height` metres under PLAYER.gravity (plus a little clearance). */
export const stepBoost = (height: number) => Math.sqrt(2 * -PLAYER.gravity * (height + 0.08));

export const createStepAssist = (app: AppBase, player: Entity, camera: Entity) => {
    const system = app.systems.rigidbody as RigidBodyComponentSystem;
    const from = new Vec3(),
        to = new Vec3(),
        dir = new Vec3();
    let cooldown = 0;

    return {
        update(dt: number) {
            cooldown = Math.max(0, cooldown - dt);
            const controller = player.script?.get(FirstPersonController) as { enabled?: boolean } | null;
            const body = player.rigidbody;
            if (cooldown > 0 || !body || controller?.enabled === false) return;
            const forward = Number(input.isDown('moveForward')) - Number(input.isDown('moveBackward'));
            const strafe = Number(input.isDown('strafeRight')) - Number(input.isDown('strafeLeft'));
            if (!forward && !strafe) return;
            // Horizontal forward of the view; right is forward turned a quarter clockwise seen from above.
            const look = camera.forward;
            const flat = Math.hypot(look.x, look.z) || 1;
            const fx = look.x / flat,
                fz = look.z / flat;
            dir.set(fx * forward - fz * strafe, 0, fz * forward + fx * strafe).normalize();
            if (Math.abs(body.linearVelocity.y) > 1.5) return; // jumping or falling
            const p = player.getPosition();
            const feet = p.y - PLAYER.height / 2;
            // Grounded?
            from.set(p.x, p.y, p.z);
            to.set(p.x, feet - 0.12, p.z);
            if (!system.raycastFirst(from, to)) return;
            const reach = PLAYER.radius + STEP_ASSIST.reach;
            // Something at the shins ahead…
            from.set(p.x, feet + STEP_ASSIST.minStep, p.z);
            to.set(p.x + dir.x * reach, feet + STEP_ASSIST.minStep, p.z + dir.z * reach);
            const shin = system.raycastFirst(from, to);
            if (!shin || Math.abs(shin.normal.y) > 0.6) return;
            // …nothing at step height…
            from.set(p.x, feet + STEP_ASSIST.maxStep + 0.02, p.z);
            to.set(p.x + dir.x * reach, feet + STEP_ASSIST.maxStep + 0.02, p.z + dir.z * reach);
            if (system.raycastFirst(from, to)) return;
            // …and a tread to stand on just past the edge.
            const ax = shin.point.x + dir.x * 0.12,
                az = shin.point.z + dir.z * 0.12;
            from.set(ax, feet + STEP_ASSIST.maxStep + 0.02, az);
            to.set(ax, feet, az);
            const tread = system.raycastFirst(from, to);
            if (!tread || tread.normal.y < 0.7) return;
            const height = tread.point.y - feet;
            if (height < STEP_ASSIST.minStep || height > STEP_ASSIST.maxStep) return;
            const v = body.linearVelocity;
            body.linearVelocity = new Vec3(v.x + dir.x * 0.8, Math.max(v.y, stepBoost(height)), v.z + dir.z * 0.8);
            cooldown = STEP_ASSIST.cooldown;
        }
    };
};
