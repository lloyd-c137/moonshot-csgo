import assert from 'node:assert/strict';
import test from 'node:test';

import { applyKeyboardStateDeltas } from '../src/input/controllerAdapter.ts';

test('controller adapter emits key edges instead of accumulating held states', () => {
    const key = Array(43).fill(0);
    const previous = Array(3).fill(0);
    const slots = [22, 40, 41]; // W, Space, Shift in PlayCanvas 2.23.2.
    let jumpInput = 0;

    applyKeyboardStateDeltas(key, [1, 1, 1], previous, slots);
    jumpInput += key[40];
    assert.equal(jumpInput, 1, 'press contributes once');

    applyKeyboardStateDeltas(key, [1, 1, 1], previous, slots);
    jumpInput += key[40];
    assert.equal(jumpInput, 1, 'holding across frames does not accumulate more jump input');

    applyKeyboardStateDeltas(key, [0, 0, 0], previous, slots);
    jumpInput += key[40];
    assert.equal(jumpInput, 0, 'release cancels the controller input');
    assert.equal(key[22], -1, 'movement key release is forwarded');
    assert.equal(key[41], -1, 'sprint release is forwarded');

    applyKeyboardStateDeltas(key, [0, 0, 0], previous, slots);
    jumpInput += key[40];
    assert.equal(jumpInput, 0, 'released input stays cleared on later frames');
});
