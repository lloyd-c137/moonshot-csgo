import assert from 'node:assert/strict';
import test from 'node:test';

import { OutboundPolicy, SnapshotAcks, SnapshotDeltaPublisher } from '../server/outboundPolicy.ts';
import { parseClientMessage } from '../src/net/protocol.ts';

test('native socket backpressure coalesces snapshots and closes sustained slow clients', () => {
    const policy = new OutboundPolicy();
    const snapshot = { type: 'snapshot', t: 0, poses: {} };
    const critical = { type: 'struck', target: 'b', by: 'a', hp: 0, out: true, head: false, sniper: false, gold: false, at: [0, 0, 0], scores: {} };
    assert.equal(policy.decide('slow', snapshot, 300 * 1024, 100), 'coalesce');
    assert.equal(policy.decide('slow', critical, 300 * 1024, 200), 'send');
    assert.equal(policy.decide('slow', critical, 513 * 1024, 300), 'send');
    assert.equal(policy.decide('slow', critical, 513 * 1024, 2300), 'close');
    assert.equal(policy.decide('healthy', snapshot, 32 * 1024, 2400), 'send');
});

test('application snapshot acknowledgements cap Cloudflare snapshots to one in flight', () => {
    const acks = new SnapshotAcks();
    assert.deepEqual(acks.next('a', 0), { type: 'send', seq: 1 });
    assert.equal(acks.acknowledge('a', 2), false, 'future acknowledgements are ignored');
    assert.equal(acks.acknowledge('a', 1), true);
    assert.deepEqual(acks.next('a', 100), { type: 'send', seq: 2 });
    assert.deepEqual(acks.next('a', 150), { type: 'coalesce' });
    assert.deepEqual(acks.next('a', 2100), { type: 'close' });
});

test('snapshot delta publisher uses acknowledged recipient baseline and resyncs with a new epoch', () => {
    const publisher = new SnapshotDeltaPublisher();
    publisher.register('a', true);
    const pose = (x, t = 100) => ({ p: [x, 0, 0], yaw: 0, pitch: 0, t });
    const first = publisher.encode('a', { type: 'snapshot', t: 100, poses: { visible: pose(0) }, fans: {} }, 1, 100);
    assert.equal(first.type, 'snapshotFull');
    if (first.type !== 'snapshotFull') return;
    assert.equal(publisher.acknowledge('a', first.seq, 100), true);

    const second = publisher.encode('a', { type: 'snapshot', t: 150, poses: { visible: pose(1, 150) }, fans: {} }, 2, 150);
    assert.equal(second.type, 'snapshotDelta');
    if (second.type !== 'snapshotDelta') return;
    assert.equal(second.baseSeq, first.seq);
    assert.deepEqual(Object.keys(second.updates), ['visible']);
    assert.equal(publisher.acknowledge('a', second.seq, 150), true);

    const third = publisher.encode('a', { type: 'snapshot', t: 200, poses: {}, fans: {} }, 3, 200);
    assert.equal(third.type, 'snapshotDelta');
    if (third.type !== 'snapshotDelta') return;
    assert.deepEqual(third.removed, ['visible'], 'visibility loss is explicit');

    const oldEpoch = third.epoch;
    publisher.resync('a');
    const resynced = publisher.encode('a', { type: 'snapshot', t: 250, poses: {}, fans: {} }, 4, 250);
    assert.equal(resynced.type, 'snapshotFull');
    if (resynced.type === 'snapshotFull') assert.ok(resynced.epoch > oldEpoch);
});

test('snapshot delta clients retain unchanged baseline fields in a delta', async () => {
    const { applyPoseDelta } = await import('../src/net/snapshotDelta.ts');
    const base = { a: { p: [0, 0, 0], yaw: 0, pitch: 0, t: 1 }, b: { p: [1, 0, 0], yaw: 0, pitch: 0, t: 1 } };
    const current = applyPoseDelta(base, { a: { p: [2, 0, 0], yaw: 0, pitch: 0, t: 2 } }, []);
    assert.equal(current.a.p[0], 2);
    assert.equal(current.b.p[0], 1, 'omission means unchanged, not removed');
    assert.deepEqual(applyPoseDelta(current, {}, ['b']), { a: current.a });
});

test('snapshot capability and resync messages are shape-checked', () => {
    assert.equal(parseClientMessage(JSON.stringify({ type: 'hello', version: 15, name: 'a', capabilities: { snapshotAck: true, snapshotDelta: true } }))?.type, 'hello');
    assert.equal(parseClientMessage(JSON.stringify({ type: 'hello', version: 15, name: 'a', capabilities: { admin: true } })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotAck', seq: 1 }))?.type, 'snapshotAck');
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotAck', seq: -1 })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotResync', epoch: 2, seq: 4 }))?.type, 'snapshotResync');
});
