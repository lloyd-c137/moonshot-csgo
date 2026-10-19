import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('SQLite worker-thread PoC serializes RPC and idempotently replays an event after restart', () => {
    const result = spawnSync(process.execPath, ['tools/perf/sqlite-worker-poc.mjs'], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.evidence, 'LOCAL_SQLITE_WORKER_POC');
    assert.equal(output.operations, 100);
    assert.equal(output.duplicateReplayAfterRestart, 'idempotent');
    assert.ok(output.rpcMs.p95 >= 0);
});
