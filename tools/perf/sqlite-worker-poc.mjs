import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

const workerSource = `
  const { parentPort, workerData } = require('node:worker_threads');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(workerData.path);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, account TEXT NOT NULL, amount INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS totals (account TEXT PRIMARY KEY, amount INTEGER NOT NULL)');
  const find = db.prepare('SELECT amount FROM totals WHERE account = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO events (id, account, amount) VALUES (?, ?, ?)');
  const add = db.prepare('INSERT INTO totals (account, amount) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET amount = amount + excluded.amount');
  parentPort.on('message', ({ requestId, eventId, account, amount }) => {
    try {
      db.exec('BEGIN IMMEDIATE');
      const result = insert.run(eventId, account, amount);
      if (result.changes) add.run(account, amount);
      db.exec('COMMIT');
      parentPort.postMessage({ requestId, total: find.get(account)?.amount ?? 0 });
    } catch (error) {
      db.exec('ROLLBACK');
      parentPort.postMessage({ requestId, error: String(error) });
    }
  });
`;

const startWorker = (path) => new Worker(workerSource, { eval: true, workerData: { path } });
const send = (worker, request) => new Promise((resolve, reject) => {
    const onMessage = (message) => {
        if (message.requestId !== request.requestId) return;
        worker.off('message', onMessage);
        if (message.error) reject(new Error(message.error));
        else resolve(message.total);
    };
    worker.on('message', onMessage);
    worker.postMessage(request);
});

const directory = await mkdtemp(join(tmpdir(), 'moonshot-sqlite-worker-poc-'));
const path = join(directory, 'poc.sqlite');
const latencies = [];
try {
    let worker = startWorker(path);
    await new Promise((resolve, reject) => { worker.once('online', resolve); worker.once('error', reject); });
    let expectedTotal = 0;
    for (let i = 0; i < 100; i++) {
        const request = { requestId: `first-${i}`, eventId: `event-${i}`, account: 'poc-account', amount: 1 };
        const started = performance.now();
        expectedTotal = await send(worker, request);
        latencies.push(performance.now() - started);
    }
    assert.equal(expectedTotal, 100);
    await worker.terminate();

    worker = startWorker(path);
    await new Promise((resolve, reject) => { worker.once('online', resolve); worker.once('error', reject); });
    const duplicate = await send(worker, { requestId: 'replay', eventId: 'event-99', account: 'poc-account', amount: 1 });
    assert.equal(duplicate, 100, 'replaying a committed event after worker restart must not double apply it');
    await worker.terminate();

    const sorted = latencies.sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
    console.log(JSON.stringify({ evidence: 'LOCAL_SQLITE_WORKER_POC', node: process.version, operations: 100, duplicateReplayAfterRestart: 'idempotent', rpcMs: { p50: +percentile(0.5).toFixed(3), p95: +percentile(0.95).toFixed(3), p99: +percentile(0.99).toFixed(3), max: +sorted.at(-1).toFixed(3) }, note: 'Isolated feasibility PoC only; the campus account runtime still uses DatabaseSync on the main thread.' }));
} finally {
    await rm(directory, { recursive: true, force: true });
}
