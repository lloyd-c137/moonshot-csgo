import assert from 'node:assert/strict';
import test from 'node:test';

import { input } from '../src/input/InputManager.ts';
import { CROUCH, canStandWithinHeadroom, CrouchController, crouchCentreOffset, hasGroundSupport } from '../src/player/crouch.ts';

const context = { enabled: true, grounded: true, alive: true, playing: true, locked: true, restricted: false, mode: 'hold' };

const fixture = () => {
    let position = { x: 0, y: 0.92, z: 0 };
    let blocked = false;
    const player = {
        collision: { height: CROUCH.standingHeight },
        getPosition: () => position,
        rigidbody: {
            linearVelocity: { x: 1, y: 0, z: 2, clone() { return { x: this.x, y: this.y, z: this.z, clone: this.clone }; } },
            angularVelocity: { x: 0, y: 0, z: 0 },
            teleport(x, y, z) { position = { x, y, z }; }
        }
    };
    const physics = { raycastFirst: () => blocked ? { entity: {} } : null };
    const states = [];
    const crouch = new CrouchController(player, physics, (value) => states.push(value));
    return { player, crouch, physics, states, position: () => position, block: (value) => (blocked = value) };
};

test('crouch tuning preserves the feet and requires conservative stand clearance', () => {
    assert.ok(Math.abs(crouchCentreOffset(true) + 0.3) < 1e-9);
    assert.ok(Math.abs(crouchCentreOffset(false) - 0.3) < 1e-9);
    assert.equal(canStandWithinHeadroom(0.63), false);
    assert.equal(canStandWithinHeadroom(0.64), true);
});

test('hold crouch changes the real capsule and centre; blocked stand-up keeps the crouched body', () => {
    const { player, crouch, block, position } = fixture();
    input.releaseAll();
    input.setBindings({ ...input.bindings, crouch: 'KeyC' });
    input.press('KeyC');
    input.beginFrame();
    crouch.update(context);
    assert.equal(player.collision.height, CROUCH.crouchingHeight);
    assert.equal(position().y, 0.62);
    assert.equal(crouch.active, true);

    input.releaseAll();
    input.beginFrame();
    block(true);
    crouch.update(context);
    assert.equal(crouch.active, true, 'a ceiling obstruction must not force a stand-up');
    assert.equal(player.collision.height, CROUCH.crouchingHeight);

    block(false);
    crouch.update(context);
    assert.equal(crouch.active, false, 'the player stands automatically when clearance returns');
    assert.equal(player.collision.height, CROUCH.standingHeight);
    assert.equal(position().y, 0.92);
    input.releaseAll();
    input.beginFrame();
});

test('ground support probes below the current capsule footprint', () => {
    const player = { collision: { height: 1.8 }, getPosition: () => ({ x: 0, y: 0.92, z: 0 }) };
    let calls = 0;
    const supported = hasGroundSupport(player, { raycastFirst: () => (++calls === 3 ? { entity: {} } : null) });
    assert.equal(supported, true);
    assert.equal(calls, 3);
});

test('stand-up clearance checks the capsule perimeter, including diagonal corners', () => {
    const { player, crouch, physics } = fixture();
    input.releaseAll();
    input.setBindings({ ...input.bindings, crouch: 'KeyC' });
    input.press('KeyC');
    input.beginFrame();
    crouch.update(context);
    input.releaseAll();
    input.beginFrame();
    let standProbeCalls = 0;
    physics.raycastFirst = (from) => {
        if (from.y > 0.7) {
            standProbeCalls++;
            if (from.x < -0.15 && from.z < -0.15) return { entity: {} };
        }
        return null;
    };
    crouch.update(context);
    assert.equal(crouch.active, true);
    assert.equal(player.collision.height, CROUCH.crouchingHeight);
    assert.equal(standProbeCalls, 9);
    input.releaseAll();
    input.beginFrame();
});
