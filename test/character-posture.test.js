import assert from 'node:assert/strict';
import test from 'node:test';

import { Quat } from 'playcanvas';

import { replacePostureOverlay } from '../src/characters/CharacterAssetLoader.ts';

const closeQuat = (a, b, tolerance = 1e-5) =>
    Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance && Math.abs(a.z - b.z) < tolerance && Math.abs(a.w - b.w) < tolerance;

test('crouch joint overlay replaces its previous frame and returns to the animation pose', () => {
    const animationPose = new Quat().setFromEulerAngles(12, 4, -3);
    const previous = new Quat();
    const current = animationPose.clone();
    const inverse = new Quat();
    const out = new Quat();
    const target = new Quat().setFromEulerAngles(-22, 0, 0);

    for (let frame = 0; frame < 300; frame++) {
        replacePostureOverlay(current, previous, target, inverse, out);
        current.copy(out);
        previous.copy(target);
    }
    const expected = new Quat().mul2(animationPose, target);
    assert.ok(closeQuat(current, expected), 'a long crouched idle must not accumulate joint rotation');

    const neutral = new Quat();
    replacePostureOverlay(current, previous, neutral, inverse, out);
    const restored = new Quat().mul2(animationPose, neutral);
    assert.ok(closeQuat(out, restored), 'standing removes only the posture layer');
});
