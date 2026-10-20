import type { Entity, RigidBodyComponentSystem } from 'playcanvas';
import { Vec3 } from 'playcanvas';

import { input } from '../input/InputManager.ts';

export const CROUCH = {
    standingHeight: 1.8,
    crouchingHeight: 1.2,
    radius: 0.28,
    standingEye: 0.66,
    crouchingEye: 0.43,
    speedScale: 0.55,
    transitionSeconds: 0.15,
    headroomMargin: 0.04
} as const;

let crouchedForController = false;
const groundFrom = new Vec3();
const groundTo = new Vec3();
const standFrom = new Vec3();
const standTo = new Vec3();
const STAND_PROBES = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2],
    [-Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2]
] as const;
export const isPhysicallyCrouched = () => crouchedForController;

export const crouchCentreOffset = (crouched: boolean) =>
    (CROUCH.standingHeight - CROUCH.crouchingHeight) / 2 * (crouched ? -1 : 1);

export const canStandWithinHeadroom = (clearance: number) =>
    Number.isFinite(clearance) && clearance + 1e-9 >= CROUCH.standingHeight - CROUCH.crouchingHeight + CROUCH.headroomMargin;

export type CrouchContext = {
    enabled: boolean;
    grounded: boolean;
    alive: boolean;
    playing: boolean;
    locked: boolean;
    restricted: boolean;
    mode: 'hold' | 'toggle';
};

/** Physical capsule posture. The caller supplies conservative world queries so this module stays testable. */
export class CrouchController {
    private crouched = false;
    private requested = false;
    private readonly player: Entity;
    private readonly physics: RigidBodyComponentSystem;
    private readonly onPosture: (crouched: boolean) => void;

    constructor(
        player: Entity,
        physics: RigidBodyComponentSystem,
        onPosture: (crouched: boolean) => void
    ) {
        this.player = player;
        this.physics = physics;
        this.onPosture = onPosture;
    }

    get active() { return this.crouched; }
    get needsGroundSupport() { return this.crouched || this.requested || input.isDown('crouch') || input.wasPressed('crouch'); }

    /** Applies a server-restored capsule state after its authoritative centre has been teleported. */
    restoreAtCurrentCentre(crouched: boolean) {
        this.player.collision!.height = crouched ? CROUCH.crouchingHeight : CROUCH.standingHeight;
        this.crouched = crouched;
        this.requested = crouched;
        crouchedForController = crouched;
        this.onPosture(crouched);
    }

    update(context: CrouchContext) {
        if (context.mode === 'toggle' && input.wasPressed('crouch')) this.requested = !this.requested;
        if (context.mode === 'hold') this.requested = input.isDown('crouch');
        const allowed = context.enabled && context.grounded && context.alive && context.playing && context.locked && !context.restricted;
        const wantsCrouch = allowed && this.requested;
        if (wantsCrouch && !this.crouched) this.setPosture(true);
        if (!allowed) this.requested = false;
        if (!wantsCrouch && this.crouched && this.hasStandClearance()) this.setPosture(false);

        this.onPosture(this.crouched);
        return this.crouched;
    }

    reset() {
        this.requested = false;
        if (!this.crouched || this.hasStandClearance()) this.setPosture(false);
    }

    private setPosture(crouched: boolean) {
        if (this.crouched === crouched) return;
        const position = this.player.getPosition();
        const velocity = this.player.rigidbody?.linearVelocity.clone() ?? Vec3.ZERO;
        const offset = crouchCentreOffset(crouched);
        const nextY = position.y + offset;
        // Adjust the existing dynamic body in place. Teleport preserves contact stability better than
        // changing its shape around a fixed centre and does not recreate the Rigidbody.
        this.player.collision!.height = crouched ? CROUCH.crouchingHeight : CROUCH.standingHeight;
        this.player.rigidbody!.teleport(position.x, nextY, position.z);
        this.player.rigidbody!.linearVelocity = velocity;
        this.crouched = crouched;
        crouchedForController = crouched;
        this.requested = crouched;
    }

    private hasStandClearance() {
        const centre = this.player.getPosition();
        const startY = centre.y + CROUCH.crouchingHeight / 2 - 0.015;
        const endY = centre.y + (CROUCH.standingHeight - CROUCH.crouchingHeight) / 2 + CROUCH.standingHeight / 2 + CROUCH.headroomMargin;
        const offset = CROUCH.radius * 0.98;
        // Nine vertical probes conservatively cover the capsule footprint and headroom. Starting above
        // the current cap avoids hitting the player's own collision shape.
        for (const [px, pz] of STAND_PROBES) {
            const x = centre.x + px * offset;
            const z = centre.z + pz * offset;
            standFrom.set(x, startY, z);
            standTo.set(x, endY, z);
            const hit = this.physics.raycastFirst(standFrom, standTo);
            if (hit && hit.entity !== this.player) return false;
        }
        return true;
    }
}

export const hasGroundSupport = (player: Entity, physics: RigidBodyComponentSystem) => {
    const centre = player.getPosition();
    const bottom = centre.y - (player.collision?.height ?? CROUCH.standingHeight) / 2;
    const offset = CROUCH.radius * 0.72;
    for (const [dx, dz] of [[offset, 0], [-offset, 0], [0, offset], [0, -offset]]) {
        groundFrom.set(centre.x + dx, bottom + 0.06, centre.z + dz);
        groundTo.set(centre.x + dx, bottom - 0.12, centre.z + dz);
        const hit = physics.raycastFirst(groundFrom, groundTo);
        if (hit && hit.entity !== player) return true;
    }
    return false;
};
