// GAMEPLAY_AUTHORED prop set. The source-derived M103 room is broad; no source asset identifies a server closet.
// These compact cabinet/console props make the interaction visible without changing campus source geometry.
import type { AppBase } from 'playcanvas';
import { Color, Entity, StandardMaterial } from 'playcanvas';

import { GEORGE_SERVER_ROOM } from '../../config/george';
import type { GeorgeReboot } from '../../net/protocol';

type GeorgeVisualState = 'online' | 'breached' | 'rebooting';

export const createGeorgeServerView = (app: AppBase) => {
    const root = new Entity('GameplayAuthored_George_M103_ServerRoom');
    root.setPosition(GEORGE_SERVER_ROOM.x, 0, GEORGE_SERVER_ROOM.z);
    app.root.addChild(root);

    const body = new StandardMaterial();
    body.diffuse = new Color(0.075, 0.09, 0.11);
    body.metalness = 0.62;
    body.gloss = 0.72;
    body.update();
    const trim = new StandardMaterial();
    trim.diffuse = new Color(0.16, 0.19, 0.22);
    trim.metalness = 0.75;
    trim.gloss = 0.8;
    trim.update();
    const partition = new StandardMaterial();
    partition.diffuse = new Color(0.11, 0.13, 0.15);
    partition.metalness = 0.18;
    partition.gloss = 0.25;
    partition.update();
    const screenMaterial = new StandardMaterial();
    screenMaterial.diffuse = new Color(0.035, 0.12, 0.1);
    screenMaterial.emissive = new Color(0.04, 0.4, 0.17);
    screenMaterial.update();
    const lightMaterial = new StandardMaterial();
    lightMaterial.emissive = new Color(0.1, 0.95, 0.28);
    lightMaterial.diffuse = new Color(0.1, 0.95, 0.28);
    lightMaterial.update();

    const box = (name: string, material: StandardMaterial, position: [number, number, number], size: [number, number, number], solid = false) => {
        const entity = new Entity(name);
        entity.addComponent('render', { type: 'box', material, castShadows: false, receiveShadows: false });
        entity.setLocalPosition(...position);
        entity.setLocalScale(...size);
        if (solid) {
            entity.addComponent('collision', { type: 'box', halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2] });
            entity.addComponent('rigidbody', { type: 'static', friction: 0.6, restitution: 0.05 });
        }
        root.addChild(entity);
        return entity;
    };

    // GAMEPLAY_AUTHORED low-complexity three-wall alcove. The front remains open so the terminal is reachable.
    box('George-Server-Room-Back-Partition', partition, [-1.53, 1.1, 0], [0.12, 2.2, 2.4], true);
    box('George-Server-Room-Side-Partition-A', partition, [-0.38, 1.1, -1.14], [2.3, 2.2, 0.12], true);
    box('George-Server-Room-Side-Partition-B', partition, [-0.38, 1.1, 1.14], [2.3, 2.2, 0.12], true);

    // A 1.9 m rack with a shallow desk/terminal in front. The console face points toward +X.
    box('George-Server-Rack', body, [-0.62, 0.96, 0], [0.72, 1.92, 0.64], true);
    box('George-Rack-Front-Trim', trim, [-0.235, 0.96, 0], [0.035, 1.78, 0.55]);
    const statusLight = box('George-Server-Status-Light', lightMaterial, [-0.2, 1.72, -0.22], [0.045, 0.09, 0.09]);
    const fan = new Entity('George-Server-Fan');
    fan.setLocalPosition(-0.2, 1.43, 0.19);
    root.addChild(fan);
    const fanMaterial = new StandardMaterial();
    fanMaterial.diffuse = new Color(0.28, 0.33, 0.36);
    fanMaterial.metalness = 0.72;
    fanMaterial.update();
    for (let blade = 0; blade < 3; blade++) {
        const vane = new Entity(`George-Server-Fan-Vane-${blade}`);
        vane.addComponent('render', { type: 'box', material: fanMaterial, castShadows: false, receiveShadows: false });
        vane.setLocalScale(0.035, 0.24, 0.035);
        vane.setLocalEulerAngles(0, 0, blade * 120);
        fan.addChild(vane);
    }
    const hub = new Entity('George-Server-Fan-Hub');
    hub.addComponent('render', { type: 'sphere', material: trim, castShadows: false, receiveShadows: false });
    hub.setLocalScale(0.08, 0.08, 0.08);
    fan.addChild(hub);
    box('George-Console-Desk', trim, [0.13, 0.76, 0], [0.56, 0.1, 0.5], true);
    const monitor = box('George-Console-Monitor', screenMaterial, [0.13, 1.14, 0], [0.1, 0.58, 0.72], true);
    box('George-Console-Keyboard', body, [0.1, 0.84, 0], [0.24, 0.035, 0.36]);

    const setState = (state: GeorgeVisualState) => {
        const colour = state === 'online' ? new Color(0.1, 0.95, 0.28)
            : state === 'breached' ? new Color(1, 0.55, 0.08) : new Color(1, 0.12, 0.1);
        lightMaterial.emissive = colour;
        lightMaterial.diffuse = colour;
        lightMaterial.update();
        screenMaterial.emissive = state === 'online' ? new Color(0.04, 0.4, 0.17)
            : state === 'breached' ? new Color(0.6, 0.22, 0.02) : new Color(0.65, 0.035, 0.025);
        screenMaterial.update();
        monitor.name = `George-Console-Monitor-${state.toUpperCase()}`;
        statusLight.name = `George-Server-Status-Light-${state.toUpperCase()}`;
    };
    let lastState: GeorgeVisualState = 'online';
    return {
        update(reboot: GeorgeReboot, credentialAvailable: boolean) {
            const next: GeorgeVisualState = reboot.phase === 'pending' || reboot.phase === 'shutdown'
                ? 'rebooting' : credentialAvailable ? 'breached' : 'online';
            if (next !== 'rebooting') fan.setLocalEulerAngles(0, 0, (performance.now() / 8) % 360);
            if (next === lastState) return;
            lastState = next;
            setState(next);
        },
        destroy() { root.destroy(); }
    };
};
