import assert from 'node:assert/strict';
import test from 'node:test';

import { RealtimeMetrics } from '../server/realtimeMetrics.ts';

test('fixed metrics windows aggregate a bounded recent sample set outside the tick path', () => {
    const metrics = new RealtimeMetrics();
    metrics.observe('tickMs', 1, 1000);
    metrics.observe('tickMs', 4, 2000);
    metrics.observe('tickMs', 2, 3000);
    metrics.increment('snapshots', 3, 3000);
    const report = metrics.snapshot(3000);
    assert.deepEqual(report.metrics.tickMs, { count: 3, p50: 2, p95: 4, p99: 4, max: 4 });
    assert.equal(report.counters.snapshots, 3);
    assert.equal(report.ratesPerSecond.snapshots, 3);
    assert.equal(metrics.snapshot(63_001).metrics.tickMs, undefined);
});
