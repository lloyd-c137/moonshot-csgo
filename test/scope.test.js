import assert from 'node:assert/strict';
import test from 'node:test';

import { aimProgress, aimReady, fovFactor, SCOPE, sensitivityFactor } from '../src/gameplay/scope.ts';

test('sniper aim: quick flicks never zoom; holding zooms in smoothly to the full scope', () => {
    assert.equal(aimProgress(0), 0);
    assert.equal(aimProgress(SCOPE.delay), 0, 'nothing before the delay');
    assert.equal(aimReady(SCOPE.delay + SCOPE.zoomSeconds - 0.01), false);
    assert.equal(aimReady(SCOPE.delay + SCOPE.zoomSeconds), true);
    assert.equal(aimProgress(10), 1);
    let previous = 0;
    for (let t = 0; t <= 1.2; t += 0.01) {
        const next = aimProgress(t);
        assert.ok(next >= previous && next - previous < 0.03, `monotonic and gradual at ${t.toFixed(2)}`);
        previous = next;
    }
    assert.equal(fovFactor(0), 1);
    assert.ok(Math.abs(fovFactor(1) - SCOPE.fovScale) < 1e-9);
    assert.equal(sensitivityFactor(78, 0), 1);
    const full = sensitivityFactor(78, 1);
    assert.ok(full > 0.25 && full < 0.45, `sensitivity drops with zoom (${full})`);
});
