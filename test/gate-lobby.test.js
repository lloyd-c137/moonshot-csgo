import assert from 'node:assert/strict';
import test from 'node:test';

import { SOUTH_GATE } from '../src/config/gameplay.ts';
import { inPlaza, stepGate } from '../src/gameplay/gateLobby.ts';

const mid = (SOUTH_GATE.x0 + SOUTH_GATE.x1) / 2;

test('outside: flaps open and go green only for a player walking up to the gate', () => {
    assert.deepEqual(stepGate('lobby', mid, SOUTH_GATE.spawn.z), {
        state: 'lobby',
        open: false,
        light: 'red',
        joined: false
    });
    const near = stepGate('lobby', mid, SOUTH_GATE.line + 1);
    assert.equal(near.open, true);
    assert.equal(near.light, 'green');
    assert.equal(stepGate('lobby', mid + 8, SOUTH_GATE.line + 1).open, false, 'not beside the gate');
});

test('passing the line joins the round once; then the gate stays shut and red', () => {
    const step = stepGate('lobby', mid, SOUTH_GATE.line - 0.6);
    assert.deepEqual(step, { state: 'inside', open: false, light: 'red', joined: true });
    const again = stepGate('inside', mid, SOUTH_GATE.line - 3);
    assert.equal(again.joined, false);
    assert.equal(again.open, false);
    const leave = stepGate('inside', mid, SOUTH_GATE.line - 0.5);
    assert.equal(leave.light, 'denied', 'blinks red at anyone trying to leave');
    assert.equal(leave.open, false);
});

test('the lobby is confined to the indoor south-door vestibule', () => {
    assert.ok(inPlaza(SOUTH_GATE.spawn.x, SOUTH_GATE.spawn.z));
    assert.ok(inPlaza(mid, SOUTH_GATE.outer.line - 0.4), 'the foyer is part of the waiting zone');
    assert.ok(!inPlaza(mid, SOUTH_GATE.outer.line + 0.3), 'the exterior plaza is outside the lobby');
    assert.ok(!inPlaza(mid, SOUTH_GATE.line - 1));
    assert.ok(SOUTH_GATE.spawn.x >= SOUTH_GATE.x0 && SOUTH_GATE.spawn.x <= SOUTH_GATE.x1, 'spawn faces the opening');
    assert.ok(Math.abs(SOUTH_GATE.line - 53.46) < 0.01, 'gate is at the screenshot-identified pillar line');
    assert.equal(SOUTH_GATE.outer.line, 57.12, 'the source south entrance remains open');
    const lanes = SOUTH_GATE.cabinets.slice(1).map((x, i) => x - SOUTH_GATE.cabinets[i] - 0.2);
    assert.ok(
        lanes.every((width) => width >= 0.7),
        'lanes fit the 0.6 m capsule'
    );
});
