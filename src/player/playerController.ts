import type { AppBase, RigidBodyComponentSystem } from 'playcanvas';
import { Color, Entity, Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import { FALL_RECOVERY_Y, PLAYER, SAFE_SPAWN } from '../config/gameplay';

export { SAFE_SPAWN };

export const createPlayer = (app: AppBase) => {
    const player = new Entity('player');
    player.setPosition(SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z);
    player.addComponent('collision', { type: 'capsule', radius: PLAYER.radius, height: PLAYER.height });
    player.addComponent('rigidbody', {
        type: 'dynamic',
        mass: PLAYER.mass,
        linearDamping: 0,
        angularDamping: 0,
        linearFactor: Vec3.ONE,
        angularFactor: Vec3.ZERO,
        friction: 0.2,
        restitution: 0
    });
    (player.rigidbody!.system as RigidBodyComponentSystem).gravity.set(0, PLAYER.gravity, 0);
    player.addComponent('script');

    const camera = new Entity('player-camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.08, 0.12, 0.16),
        fov: 78,
        nearClip: 0.08,
        farClip: 180
    });
    camera.setLocalPosition(0, PLAYER.eyeOffset, 0);
    player.addChild(camera);
    player.script!.create(FirstPersonController, {
        properties: {
            camera,
            lookSens: 0.08,
            speedGround: 40,
            speedAir: 4,
            sprintMult: 1.5,
            jumpForce: 500
        }
    });
    app.root.addChild(player);
    return { player, camera };
};

/**
 * Returns the player to the safe spawn, stopped and facing the spawn heading (north, yaw 0). The upstream controller
 * keeps its look angles in `_angles` and has no public setter, so the reset writes that field directly.
 */
export const recoverPlayer = (player: Entity) => {
    player.rigidbody!.teleport(SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z, 0, 0, 0);
    player.rigidbody!.linearVelocity = Vec3.ZERO;
    player.rigidbody!.angularVelocity = Vec3.ZERO;
    const controller = player.script?.get(FirstPersonController) as unknown as { _angles?: Vec3 } | null;
    controller?._angles?.set(0, 0, 0);
};

/** True when the capsule centre has dropped below the level and must be recovered. */
export const isOutOfWorld = (y: number) => !Number.isFinite(y) || y < FALL_RECOVERY_Y;
