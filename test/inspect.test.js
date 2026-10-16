import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectPose, REST } from '../src/gameplay/inspect.ts';

const near = (a, b, eps = 1e-6) => a.every((value, index) => Math.abs(value - b[index]) < eps);
const wrap = (angles) => angles.map((value) => ((value % 360) + 360) % 360);

test('weapon inspect starts and ends in the resting pose and moves smoothly in between', () => {
    assert.ok(near(inspectPose(0)[0], REST[0]) && near(inspectPose(0)[1], REST[1]));
    const [endPosition, endEuler] = inspectPose(1);
    assert.ok(near(endPosition, REST[0]));
    assert.ok(near(wrap(endEuler), wrap(REST[1])), 'same orientation after a full turn');
    // Brought toward the centre of view mid-way, and flipped over later.
    assert.ok(inspectPose(0.3)[0][0] < 0.15);
    assert.ok(inspectPose(0.75)[1][0] < -60);
    // No jumps between consecutive frames at 60 fps.
    let previous = inspectPose(0);
    for (let frame = 1; frame <= 144; frame++) {
        const next = inspectPose(frame / 144);
        assert.ok(Math.hypot(...next[0].map((v, i) => v - previous[0][i])) < 0.02, `position step at ${frame}`);
        assert.ok(Math.max(...next[1].map((v, i) => Math.abs(v - previous[1][i]))) < 20, `angle step at ${frame}`);
        previous = next;
    }
});
