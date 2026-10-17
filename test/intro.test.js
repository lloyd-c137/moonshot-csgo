import assert from 'node:assert/strict';
import test from 'node:test';

import { INTRO_DURATION, INTRO_KEYS, introCamera, introLines } from '../src/gameplay/introPath.ts';
import { EXTERIOR, exteriorFromModel } from '../src/world/exteriorLayout.ts';

const eye = [-8.7, 1.62, 46.3],
    ahead = [-8.7, 1.62, 45.3];

test('intro starts on its first key and ends exactly in the player view', () => {
    const start = introCamera(0, eye, ahead, 78);
    assert.deepEqual(start.pos, INTRO_KEYS[0].pos);
    const end = introCamera(INTRO_DURATION, eye, ahead, 78);
    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(end.pos[i] - eye[i]) < 1e-9);
        assert.ok(Math.abs(end.look[i] - ahead[i]) < 1e-9);
    }
    assert.equal(end.fov, 78);
});

test('the flyover is continuous (no jumps at keys or the hand-over) and never below the ground', () => {
    let previous = introCamera(0, eye, ahead, 78);
    for (let t = 0.02; t <= INTRO_DURATION; t += 0.02) {
        const now = introCamera(t, eye, ahead, 78);
        const step = Math.hypot(...now.pos.map((v, i) => v - previous.pos[i]));
        assert.ok(step < 2.2, `jump of ${step.toFixed(2)} m at ${t.toFixed(2)} s`);
        assert.ok(now.pos[1] > 1, `below eye height at ${t.toFixed(2)} s`);
        previous = now;
    }
});

test('the gate stands where the owner model puts it, on the FF-01 south wall', () => {
    const [x] = exteriorFromModel(-8, 47);
    assert.ok(Math.abs(x - EXTERIOR.gate.x) < 0.1);
    assert.ok(EXTERIOR.gate.front > 57.72 && EXTERIOR.gate.front < 58.2, 'just outside the south wall');
    // The fit matches the room naming: model origin lands near the campus centre.
    const [cx, cz] = exteriorFromModel(0, 0);
    assert.ok(Math.abs(cx) < 2 && Math.abs(cz) < 3);
});

test('title card lines', () => {
    const lines = introLines(new Date(2026, 9, 17, 8, 5));
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes('MOONSHOT ACADEMY'));
    assert.ok(lines[2].startsWith('2026.10.17 08:05'));
});
