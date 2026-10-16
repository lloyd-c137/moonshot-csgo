import assert from 'node:assert/strict';
import test from 'node:test';

import { airborne, CATCH_AT, inspectPose, REST, TOSS_AT } from '../src/gameplay/inspect.ts';

const near = (a, b, eps = 1e-6) => a.every((value, index) => Math.abs(value - b[index]) < eps);
const wrap = (angles) => angles.map((value) => ((value % 360) + 360) % 360);

test('weapon inspect: toss, tumble over the centre of view, catch, and back to the resting pose', () => {
    assert.ok(near(inspectPose(0)[0], REST[0]) && near(inspectPose(0)[1], REST[1]));
    const [endPosition, endEuler] = inspectPose(1);
    assert.ok(near(endPosition, REST[0]));
    assert.ok(near(wrap(endEuler), wrap(REST[1])), 'same orientation after whole turns');
    // In the air between toss and catch, peaking well above the hand near the centre of view.
    assert.equal(airborne(TOSS_AT - 0.01), false);
    assert.equal(airborne((TOSS_AT + CATCH_AT) / 2), true);
    assert.equal(airborne(CATCH_AT + 0.01), false);
    const apex = inspectPose((TOSS_AT + CATCH_AT) / 2)[0];
    assert.ok(apex[1] > 0, `apex above the eye line (${apex[1]})`);
    assert.ok(apex[0] < 0.2);
    // It tumbles at least three times while airborne.
    assert.ok(inspectPose(CATCH_AT)[1][0] - inspectPose(TOSS_AT)[1][0] >= 1080);
    // Continuous: no teleports between consecutive frames (~15 ms apart).
    let previous = inspectPose(0);
    for (let frame = 1; frame <= 144; frame++) {
        const next = inspectPose(frame / 144);
        assert.ok(Math.hypot(...next[0].map((v, i) => v - previous[0][i])) < 0.04, `position step at ${frame}`);
        assert.ok(Math.max(...next[1].map((v, i) => Math.abs(v - previous[1][i]))) < 25, `angle step at ${frame}`);
        previous = next;
    }
});
