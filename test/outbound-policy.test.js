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

test('application ACKs use a bounded RTT-adaptive window and cumulative acknowledgements', () => {
    const acks = new SnapshotAcks();
    acks.register('a', true, 7);
    const first = acks.next('a', 0);
    assert.deepEqual(first, { type: 'send', seq: 1, epoch: 7 });
    acks.commit('a', first.seq, 0);
    const second = acks.next('a', 50);
    assert.equal(second.type, 'send');
    if (second.type !== 'send') return;
    acks.commit('a', second.seq, 50);
    assert.equal(acks.acknowledge('a', 3, 100, 7), false, 'future acknowledgements are ignored');
    assert.equal(acks.acknowledge('a', 2, 110, 7), true, 'ACK is cumulative');
    assert.equal(acks.acknowledge('a', 1, 120, 7), false, 'stale ACK is ignored');
    assert.equal(acks.inFlightCount('a'), 0);
    assert.equal(acks.acknowledge('a', 2, 120, 6), false, 'wrong epoch is ignored');
});

test('stable simulated RTTs retain near-20Hz snapshot delivery after warmup', () => {
    for (const rttMs of [20, 50, 100, 200, 400]) {
        const acks = new SnapshotAcks();
        acks.register('peer', true, 3);
        const pendingAcks = [];
        const pendingDeliveries = [];
        let delivered = 0;
        const intervalMs = 50;
        for (let now = 0; now <= 15_000; now += intervalMs) {
            for (let i = pendingAcks.length - 1; i >= 0; i--) {
                const ack = pendingAcks[i];
                if (ack.at <= now) {
                    acks.acknowledge('peer', ack.seq, now, 3);
                    pendingAcks.splice(i, 1);
                }
            }
            for (let i = pendingDeliveries.length - 1; i >= 0; i--) {
                if (pendingDeliveries[i].at <= now) {
                    if (pendingDeliveries[i].at >= 5_000 && pendingDeliveries[i].at < 15_000) delivered++;
                    pendingDeliveries.splice(i, 1);
                }
            }
            const next = acks.next('peer', now);
            if (next.type !== 'send') continue;
            acks.commit('peer', next.seq, now);
            pendingAcks.push({ seq: next.seq, at: now + rttMs });
            pendingDeliveries.push({ at: now + rttMs / 2 });
        }
        assert.ok(delivered >= 190, `${rttMs}ms RTT delivered ${delivered} snapshots in the 10s measured window`);
        assert.ok(acks.maxInFlightObserved <= 12, 'window has a hard cap');
        assert.ok(acks.windowSize('peer') <= 12);
    }
});

test('legacy stop-and-wait reference is RTT-limited while the adaptive window is not', () => {
    const rate = (windowMax) => {
        const acks = new SnapshotAcks(windowMax);
        acks.register('peer', true, 1);
        const pending = [];
        const arrivals = [];
        let delivered = 0;
        for (let now = 0; now < 12_000; now += 50) {
            for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= now) {
                acks.acknowledge('peer', pending[i].seq, now, 1);
                pending.splice(i, 1);
            }
            for (let i = arrivals.length - 1; i >= 0; i--) if (arrivals[i] <= now) {
                if (arrivals[i] >= 2_000 && arrivals[i] < 12_000) delivered++;
                arrivals.splice(i, 1);
            }
            const next = acks.next('peer', now);
            if (next.type !== 'send') continue;
            acks.commit('peer', next.seq, now);
            pending.push({ seq: next.seq, at: now + 200 });
            arrivals.push(now + 100);
        }
        return delivered / 10;
    };
    assert.ok(rate(1) <= 6, `single-frame baseline runs at ${rate(1)}Hz around 200ms RTT`);
    assert.ok(rate(12) >= 19, `adaptive window sustains ${rate(12)}Hz around 200ms RTT`);
});

test('a stalled reader coalesces stale states, times out, and can restart from a fresh epoch', () => {
    const acks = new SnapshotAcks();
    acks.register('slow', true, 4);
    for (let i = 0; i < 3; i++) {
        const next = acks.next('slow', i * 50);
        assert.equal(next.type, 'send');
        if (next.type === 'send') acks.commit('slow', next.seq, i * 50);
    }
    assert.equal(acks.next('slow', 150).type, 'coalesce');
    assert.equal(acks.next('slow', 2000).type, 'close');
    acks.register('slow', true, 5);
    assert.deepEqual(acks.next('slow', 2100), { type: 'send', seq: 1, epoch: 5 });
});

test('snapshot delta publisher chains from successfully enqueued frames and preserves removals', () => {
    const publisher = new SnapshotDeltaPublisher();
    const epoch = publisher.register('a', true);
    const pose = (x, t = 100) => ({ p: [x, 0, 0], yaw: 0, pitch: 0, t });
    const first = publisher.encode('a', { type: 'snapshot', t: 100, poses: { visible: pose(0) }, fans: {} }, 1, 100);
    assert.equal(first.type, 'snapshotFull');
    if (first.type !== 'snapshotFull') return;
    assert.equal(first.epoch, epoch);
    publisher.commit('a', first.seq);

    const second = publisher.encode('a', { type: 'snapshot', t: 150, poses: { visible: pose(1, 150) }, fans: {} }, 2, 150);
    assert.equal(second.type, 'snapshotDelta');
    if (second.type !== 'snapshotDelta') return;
    assert.equal(second.baseSeq, first.seq);
    assert.deepEqual(Object.keys(second.updates), ['visible']);
    publisher.commit('a', second.seq);

    const third = publisher.encode('a', { type: 'snapshot', t: 200, poses: {}, fans: {} }, 3, 200);
    assert.equal(third.type, 'snapshotDelta');
    if (third.type !== 'snapshotDelta') return;
    assert.equal(third.baseSeq, second.seq, 'baseline follows the last successfully enqueued frame, not its ACK');
    assert.deepEqual(third.removed, ['visible'], 'visibility loss is explicit');
    publisher.commit('a', third.seq);

    const visibleAgain = publisher.encode('a', { type: 'snapshot', t: 225, poses: { visible: pose(2, 225) }, fans: {} }, 4, 225);
    assert.equal(visibleAgain.type, 'snapshotDelta');
    if (visibleAgain.type !== 'snapshotDelta') return;
    assert.equal(visibleAgain.baseSeq, third.seq);
    assert.deepEqual(Object.keys(visibleAgain.updates), ['visible'], 'visibility restoration is an explicit pose update');

    const oldEpoch = visibleAgain.epoch;
    const newEpoch = publisher.resync('a');
    assert.ok(newEpoch > oldEpoch);
    const resynced = publisher.encode('a', { type: 'snapshot', t: 250, poses: {}, fans: {} }, 1, 250);
    assert.equal(resynced.type, 'snapshotFull');
    if (resynced.type === 'snapshotFull') assert.equal(resynced.epoch, newEpoch);
});

test('a coalesced snapshot consumes no sequence and the next delta uses the last sent base', () => {
    const acks = new SnapshotAcks();
    const publisher = new SnapshotDeltaPublisher();
    const policy = new OutboundPolicy();
    const epoch = publisher.register('a', true);
    acks.register('a', true, epoch);
    const pose = (x, t) => ({ p: [x, 0, 0], yaw: 0, pitch: 0, t });
    const firstSlot = acks.next('a', 0);
    const first = publisher.encode('a', { type: 'snapshot', t: 0, poses: { peer: pose(0, 0) } }, firstSlot.seq, 0);
    assert.equal(first.type, 'snapshotFull');
    acks.commit('a', firstSlot.seq, 0);
    publisher.commit('a', firstSlot.seq);
    acks.acknowledge('a', firstSlot.seq, 10, firstSlot.epoch);
    publisher.acknowledge('a', firstSlot.epoch, firstSlot.seq, 10);

    assert.equal(policy.decide('a', { type: 'snapshot', t: 50, poses: { peer: pose(1, 50) } }, 300 * 1024, 50), 'coalesce');
    const secondSlot = acks.next('a', 50);
    assert.equal(secondSlot.type, 'send');
    if (secondSlot.type !== 'send') return;
    assert.equal(secondSlot.seq, 2);
    const second = publisher.encode('a', { type: 'snapshot', t: 100, poses: { peer: pose(2, 100) } }, secondSlot.seq, 100);
    assert.equal(second.type, 'snapshotDelta');
    if (second.type !== 'snapshotDelta') return;
    assert.equal(second.baseSeq, 1);
});

test('clients without delta capability retain the legacy full snapshot message', () => {
    const publisher = new SnapshotDeltaPublisher();
    publisher.register('legacy', false);
    const full = publisher.encode('legacy', { type: 'snapshot', t: 10, poses: { peer: { p: [1, 0, 0], yaw: 0, pitch: 0, t: 10 } } }, 1, 10);
    assert.equal(full.type, 'snapshot');
    assert.equal(full.seq, 1);
});

test('adaptive encoding chooses Full for dense movement and Delta for the same forced-delta case', () => {
    const poseSet = (offset, t) => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
        `p${i}`, { p: [i + (i < 5 ? offset : 0), 0, 0], yaw: 0, pitch: 0, t }
    ]));
    const auto = new SnapshotDeltaPublisher();
    auto.register('auto', true);
    const firstAuto = auto.encode('auto', { type: 'snapshot', t: 0, poses: poseSet(0, 0) }, 1, 0);
    auto.commit('auto', 1);
    const denseAuto = auto.encode('auto', { type: 'snapshot', t: 50, poses: poseSet(1, 50) }, 2, 50);
    assert.equal(firstAuto.type, 'snapshotFull');
    assert.equal(denseAuto.type, 'snapshotFull');

    const forced = new SnapshotDeltaPublisher();
    forced.register('forced', true);
    forced.encode('forced', { type: 'snapshot', t: 0, poses: poseSet(0, 0) }, 1, 0);
    forced.commit('forced', 1);
    const denseDelta = forced.encode('forced', { type: 'snapshot', t: 50, poses: poseSet(1, 50) }, 2, 50, 'delta');
    assert.equal(denseDelta.type, 'snapshotDelta');
    if (denseDelta.type === 'snapshotDelta') assert.equal(Object.keys(denseDelta.updates).length, 5);
});

test('periodic full snapshot deadline is based on full ACK, not every delta ACK', () => {
    const publisher = new SnapshotDeltaPublisher();
    publisher.register('a', true);
    const pose = (x, t) => ({ p: [x, 0, 0], yaw: 0, pitch: 0, t });
    const full = publisher.encode('a', { type: 'snapshot', t: 0, poses: { a: pose(0, 0) } }, 1, 0);
    assert.equal(full.type, 'snapshotFull');
    publisher.commit('a', 1);
    assert.equal(publisher.acknowledge('a', full.epoch, 1, 100), true);
    for (let seq = 2; seq < 201; seq++) {
        const now = seq * 50;
        const delta = publisher.encode('a', { type: 'snapshot', t: now, poses: { a: pose(seq, now) } }, seq, now);
        assert.equal(delta.type, 'snapshotDelta');
        publisher.commit('a', seq);
        publisher.acknowledge('a', delta.epoch, seq, now + 1);
    }
    const due = publisher.encode('a', { type: 'snapshot', t: 10_100, poses: { a: pose(202, 10_100) } }, 201, 10_100);
    assert.equal(due.type, 'snapshotFull', 'ten seconds after the acknowledged full snapshot');
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
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotAck', seq: 1, epoch: 2 }))?.type, 'snapshotAck');
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotAck', seq: -1 })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotAck', seq: 1, epoch: 1.5 })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'snapshotResync', epoch: 2, seq: 4 }))?.type, 'snapshotResync');
});
