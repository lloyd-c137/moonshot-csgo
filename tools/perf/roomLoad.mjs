import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const roomUrl = process.env.ROOM_MODULE ? pathToFileURL(resolve(process.env.ROOM_MODULE)) : new URL('../../server/room.ts', import.meta.url);
const [{ Room }, { PROTOCOL_VERSION }, { OutboundPolicy, SnapshotAcks, SnapshotDeltaPublisher }] = await Promise.all([
    import(roomUrl),
    import('../../src/net/protocol.ts'),
    import('../../server/outboundPolicy.ts')
]);
const playerCounts = (process.env.PLAYERS ?? '3,8,16,32').split(',').map(Number);
const rtts = (process.env.RTT_MS ?? '20,50,100,200,400').split(',').map(Number);
const modes = (process.env.SNAPSHOT_MODE ?? 'full,delta,auto').split(',');
const behaviors = (process.env.BEHAVIOR ?? 'idle,sparse,most,all').split(',');
const repeats = Math.max(1, Number(process.env.REPEATS ?? 3));
const warmupTicks = Math.max(0, Number(process.env.WARMUP_SECONDS ?? 5) * 20);
const durationTicks = Math.max(20, Number(process.env.SECONDS ?? 20) * 20);
const bandwidthBps = Math.max(1, Number(process.env.BANDWIDTH_BPS ?? 10_000_000));
const slowPauseAtMs = Number(process.env.SLOW_CLIENT_MS ?? 0);
const ackWindowMax = Math.max(1, Math.min(12, Number(process.env.ACK_WINDOW_MAX ?? 12)));
const pct = (samples) => {
    const ordered = [...samples].sort((a, b) => a - b);
    const at = (p) => ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)] ?? 0;
    return { p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), p99: +at(0.99).toFixed(3), max: +((ordered.at(-1) ?? 0)).toFixed(3) };
};

for (const count of playerCounts) {
    for (const behavior of behaviors) {
        for (const mode of modes) {
            for (const rttMs of rtts) {
                for (let repeat = 1; repeat <= repeats; repeat++) {
                    const acks = new SnapshotAcks(ackWindowMax);
                    const publisher = new SnapshotDeltaPublisher();
                    const outbound = new OutboundPolicy();
                    const peers = new Map();
                    const tickSamples = [];
                    const serializeSamples = [];
                    const delivered = [];
                    let bytes = 0;
                    let snapshotMessages = 0;
                    let fullMessages = 0;
                    let deltaMessages = 0;
                    let coalesced = 0;
                    let slowClosed = 0;
                    const movementCount = behavior === 'idle' ? 0 : behavior === 'sparse' ? 1 : behavior === 'most' ? Math.ceil(count * 0.75) : count;
                    const nowBase = Date.now();
                    const room = new Room({
                        to: (id, message) => {
                            if (message.type !== 'snapshot') return;
                            const peer = peers.get(id);
                            if (!peer || peer.closed) return;
                            const now = peer.now;
                            const shouldPause = peer.index === count - 1 && slowPauseAtMs > 0 && now >= slowPauseAtMs;
                            let queuedBytes = peer.queuedBytes;
                            if (!shouldPause) {
                                const elapsed = Math.max(0, now - peer.lastDrainAt);
                                queuedBytes = Math.max(0, queuedBytes - elapsed * bandwidthBps / 1000);
                            }
                            peer.queuedBytes = queuedBytes;
                            peer.lastDrainAt = now;
                            const pressure = outbound.decide(id, message, queuedBytes, now);
                            if (pressure === 'close') {
                                peer.closed = true;
                                slowClosed++;
                                return;
                            }
                            if (pressure === 'coalesce') {
                                coalesced++;
                                return;
                            }
                            const slot = acks.next(id, now);
                            if (slot.type === 'close') {
                                peer.closed = true;
                                slowClosed++;
                                return;
                            }
                            if (slot.type !== 'send') {
                                coalesced++;
                                return;
                            }
                            const isDelta = mode === 'delta' || mode === 'auto';
                            const output = isDelta
                                ? publisher.encode(id, message, slot.seq, now, mode === 'delta' ? 'delta' : 'auto')
                                : { ...message, seq: slot.seq };
                            const serializationStarted = performance.now();
                            const text = JSON.stringify(output);
                            serializeSamples.push(performance.now() - serializationStarted);
                            const frameBytes = Buffer.byteLength(text);
                            bytes += frameBytes;
                            snapshotMessages++;
                            if (output.type === 'snapshotFull') fullMessages++;
                            else if (output.type === 'snapshotDelta') deltaMessages++;
                            const queueAheadBytes = peer.queuedBytes;
                            peer.queuedBytes += frameBytes;
                            const queueDelayMs = (queueAheadBytes + frameBytes) / bandwidthBps * 1000;
                            const arrivalAt = now + Math.ceil(rttMs / 2 + queueDelayMs);
                            if (!shouldPause) {
                                if (arrivalAt >= warmupTicks * 50 && arrivalAt < (warmupTicks + durationTicks) * 50) {
                                    delivered.push(arrivalAt);
                                    peer.deliveredCount++;
                                }
                            }
                            acks.commit(id, slot.seq, now);
                            if (isDelta) publisher.commit(id, slot.seq);
                            if (!shouldPause) peer.acks.push({ seq: slot.seq, epoch: slot.epoch, at: now + rttMs + queueDelayMs });
                        },
                        all: () => undefined,
                        close: () => undefined
                    }, 1);

                    for (let i = 0; i < count; i++) {
                        const id = `p${i}`;
                        acks.register(id, true, publisher.register(id, mode !== 'full'));
                        peers.set(id, { index: i, now: 0, queuedBytes: 0, lastDrainAt: 0, acks: [], deliveredCount: 0, closed: false });
                        room.connect(id);
                        const now = nowBase;
                        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id, phase: 'playing', capabilities: { snapshotAck: true, snapshotDelta: mode !== 'full' } }, now);
                        room.message(id, { type: 'pose', pose: { p: [-2 + i * 0.2, 0.92, 0], yaw: 0, pitch: 0 }, ct: now }, now);
                    }

                    const cpuStart = process.cpuUsage();
                    const rssBefore = process.memoryUsage().rss;
                    let step = 0;
                    for (let tick = 0; tick < warmupTicks + durationTicks; tick++) {
                        const now = nowBase + tick * 50;
                        for (const [id, peer] of peers) {
                            peer.now = tick * 50;
                            for (let n = peer.acks.length - 1; n >= 0; n--) {
                                const ack = peer.acks[n];
                                if (ack.at <= peer.now) {
                                    acks.acknowledge(id, ack.seq, peer.now, ack.epoch);
                                    if (mode !== 'full') publisher.acknowledge(id, ack.epoch, ack.seq, peer.now);
                                    peer.acks.splice(n, 1);
                                }
                            }
                            if (peer.queuedBytes <= 0) peer.queuedBytes = 0;
                        }
                        const tickStarted = performance.now();
                        if (movementCount > 0) {
                            for (let i = 0; i < movementCount; i++) {
                                const x = -2 + i * 0.2 + (step % 1000) * 0.002;
                                room.message(`p${i}`, { type: 'pose', pose: { p: [x, 0.92, 0], yaw: 0, pitch: 0 }, ct: now }, now);
                            }
                            step++;
                        }
                        room.tick(now);
                        tickSamples.push(performance.now() - tickStarted);
                    }
                    const elapsedMs = durationTicks * 50;
                    const cpu = process.cpuUsage(cpuStart);
                    const measuredDeliveryCount = delivered.length;
                    console.log(JSON.stringify({
                        evidence: 'LOCAL_VIRTUAL_NETWORK_SIMULATION',
                        players: count, behavior, mode, rttMs, bandwidthBps, slowPauseAtMs: slowPauseAtMs || null,
                        ackWindowMax, ackPolicy: ackWindowMax === 1 ? 'STOP_AND_WAIT_REFERENCE' : 'RTT_ADAPTIVE_BOUNDED',
                        repeat, warmupSeconds: warmupTicks / 20, durationSeconds: durationTicks / 20,
                        measuredSnapshotDeliveryHz: +(measuredDeliveryCount / (elapsedMs / 1000) / count).toFixed(2),
                        deliveredSnapshotsPerClient: +(measuredDeliveryCount / count).toFixed(1),
                        clientDeliveryHz: Object.fromEntries(Array.from(peers, ([id, peer]) => [id, +(peer.deliveredCount / (elapsedMs / 1000)).toFixed(2)])),
                        snapshotMessages, fullMessages, deltaMessages, coalesced,
                        tickMs: pct(tickSamples.slice(warmupTicks)), modeledTickDriftMs: 'NOT MEASURED (virtual scheduler)',
                        serializationMs: pct(serializeSamples), outboundBytesPerSecond: +(bytes / (elapsedMs / 1000)).toFixed(1),
                        cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), rssDeltaBytes: process.memoryUsage().rss - rssBefore,
                        maxInFlight: acks.maxInFlightObserved, slowClosed,
                        note: 'RTT, bandwidth, and packet delivery are simulated; CPU/RSS/Room serialization are measured in this local process.'
                    }));
                }
            }
        }
    }
}
