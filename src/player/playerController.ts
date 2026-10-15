import type { AppBase, RigidBodyComponentSystem } from 'playcanvas';
import { Color, Entity, Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

export const SAFE_SPAWN = { x: 50.85, y: 0.92, z: -2.86 };

export const createPlayer = (app: AppBase) => {
    const player = new Entity('player');
    player.setPosition(SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z);
    player.addComponent('collision', { type: 'capsule', radius: 0.34, height: 1.8 });
    player.addComponent('rigidbody', {
        type: 'dynamic',
        mass: 80,
        linearDamping: 0,
        angularDamping: 0,
        linearFactor: Vec3.ONE,
        angularFactor: Vec3.ZERO,
        friction: 0.2,
        restitution: 0
    });
    (player.rigidbody!.system as RigidBodyComponentSystem).gravity.set(0, -18, 0);
    player.addComponent('script');

    const camera = new Entity('player-camera');
    camera.addComponent('camera', {
        clearColor: new Color(0.08, 0.12, 0.16),
        fov: 78,
        nearClip: 0.08,
        farClip: 180
    });
    camera.setLocalPosition(0, 0.66, 0);
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

export const recoverPlayer = (player: Entity) => {
    player.rigidbody!.teleport(SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z, 0, 0, 0);
    player.rigidbody!.linearVelocity = Vec3.ZERO;
    player.rigidbody!.angularVelocity = Vec3.ZERO;
};
