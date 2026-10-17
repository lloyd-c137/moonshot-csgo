import assert from 'node:assert/strict';
import test from 'node:test';

import {
    FINISHER_STRIKE,
    finisherCamera,
    finisherPunch,
    finisherWarp
} from '../src/gameplay/finisher/finisherTiming.ts';

test('bullet time: monotonic, ends fixed, slow around the strike, the 2.6 s total unchanged', () => {
    assert.equal(finisherWarp(0), 0);
    assert.ok(Math.abs(finisherWarp(1) - 1) < 1e-12);
    let last = -1;
    for (let p = 0; p <= 1; p += 0.001) {
        const w = finisherWarp(p);
        assert.ok(w >= last, `monotonic at ${p}`);
        last = w;
    }
    const slope = (p) => (finisherWarp(p + 0.002) - finisherWarp(p - 0.002)) / 0.004;
    // The film reaches the strike a little later in real time, then lingers on it.
    const real = (() => {
        let p = 0;
        while (finisherWarp(p) < FINISHER_STRIKE) p += 0.0005;
        return p;
    })();
    assert.ok(slope(real) < 0.3, 'slow motion on the strike');
    assert.ok(slope(0.3) > 1, 'normal action runs a little faster to make room');
});

test('camera path is continuous through every key (no stop-start)', () => {
    let previous = finisherCamera(0);
    for (let t = 0.002; t <= 1; t += 0.002) {
        const now = finisherCamera(t);
        assert.ok(Math.abs(now.angle - previous.angle) < 0.03, `angle jump at ${t}`);
        assert.ok(Math.abs(now.fov - previous.fov) < 0.6, `fov jump at ${t}`);
        previous = now;
    }
    // Moving through the middle keys rather than resting on them.
    const speed = (t) => Math.abs(finisherCamera(t + 0.004).angle - finisherCamera(t - 0.004).angle);
    assert.ok(speed(0.44) > 0.001 && speed(0.63) > 0.001);
});

test('impact punch starts at the strike and fades', () => {
    assert.equal(finisherPunch(FINISHER_STRIKE - 0.01), 0);
    assert.equal(finisherPunch(FINISHER_STRIKE), 1);
    assert.ok(finisherPunch(FINISHER_STRIKE + 0.1) < 0.1);
});
