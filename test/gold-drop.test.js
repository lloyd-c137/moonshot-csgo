import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGoldDrop } from '../server/goldDrop.ts';
import { GOLD_DROP_SURFACES } from '../src/config/goldDropSurfaces.ts';

test('generated gold anchors include audited ground and multiple raised arena levels', () => {
    assert.ok(GOLD_DROP_SURFACES.some(([, y]) => Math.abs(y - 0.92) < 0.02), 'source-audited base floor exists');
    const elevated = GOLD_DROP_SURFACES.filter(([, y]) => y > 4.5);
    assert.ok(elevated.length > 100, 'walkable stands, stairs and bowl surfaces were sampled');
    assert.ok(Math.max(...elevated.map(([, y]) => y)) > 14, 'upper bowl levels are represented');
});

test('drop stays on the holder’s multi-level support instead of snapping through a nearby floor', () => {
    const high = GOLD_DROP_SURFACES.find(([, y]) => y > 6 && y < 15);
    assert.ok(high);
    const lowerNear = GOLD_DROP_SURFACES.find(([x, y, z]) => y < 1.2 && Math.hypot(x - high[0], z - high[2]) < 2);
    assert.ok(lowerNear, 'fixture overlaps a ground-floor anchor in X/Z');
    const resolved = resolveGoldDrop({ p: [high[0], high[1], high[2]], yaw: 0, pitch: 0 });
    assert.deepEqual(resolved.at, high);
    assert.equal(resolved.source, 'current-surface');
    assert.ok(Math.abs(resolved.at[1] - lowerNear[1]) > 4, 'the lower floor cannot capture the elevated drop');
});

test('unsupported stale position relocates to a nearby audited anchor and missing pose uses safe spawn', () => {
    const sample = GOLD_DROP_SURFACES[0];
    const local = resolveGoldDrop({ p: [sample[0] + 0.2, sample[1] + 2.5, sample[2]], yaw: 0, pitch: 0 });
    assert.equal(local.source, 'nearby-surface');
    assert.equal(local.relocated, true);
    const fallback = resolveGoldDrop(null, []);
    assert.equal(fallback.source, 'fallback-spawn');
    assert.deepEqual(fallback.at, [-8.7, 0.92, 46.3]);
});
