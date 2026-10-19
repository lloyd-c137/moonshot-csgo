import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const roomUrl = process.env.ROOM_MODULE ? pathToFileURL(resolve(process.env.ROOM_MODULE)) : new URL('../../server/room.ts', import.meta.url);
const [{ Room }, { PROTOCOL_VERSION }, { SnapshotDeltaPublisher }] = await Promise.all([
    import(roomUrl),
    import('../../src/net/protocol.ts'),
    import('../../server/outboundPolicy.ts')
]);
const players = (process.env.PLAYERS ?? '2,3,8,16,32').split(',').map(Number);
const seconds = Math.max(2, Number(process.env.SECONDS ?? 3));
const snapshotMode = process.env.SNAPSHOT_MODE === 'delta' ? 'delta' : 'full';
const percentiles = (samples) => {
    const ordered = [...samples].sort((a, b) => a - b);
    const at = (p) => ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)] ?? 0;
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: ordered.at(-1) ?? 0 };
};

for (const count of players) {
    for (const mode of ['idle', 'movement']) {
        let serializedBytes = 0;
        let snapshotCount = 0;
        const serializeSamples = [];
        const publisher = new SnapshotDeltaPublisher();
        const sequences = new Map();
        const encode = (id, message) => {
            if (message.type !== 'snapshot') return JSON.stringify(message);
            let outgoing = message;
            if (snapshotMode === 'delta') {
                const seq = (sequences.get(id) ?? 0) + 1;
                sequences.set(id, seq);
                outgoing = publisher.encode(id, message, seq, Date.now());
                publisher.acknowledge(id, seq, Date.now());
            }
            const serializeStarted = performance.now();
            const json = JSON.stringify(outgoing);
            serializeSamples.push(performance.now() - serializeStarted);
            return json;
        };
        const room = new Room({
            to: (id, message) => {
                const text = encode(id, message);
                if (message.type === 'snapshot') {
                    snapshotCount++;
                    serializedBytes += Buffer.byteLength(text);
                }
            },
            all: () => undefined,
            close: () => undefined
        }, 1);
        for (let i = 0; i < count; i++) {
            const id = `p${i}`;
            room.connect(id);
            const now = Date.now();
            room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id, phase: 'playing' }, now);
            if (snapshotMode === 'delta') publisher.register(id, true);
            room.message(id, { type: 'pose', pose: { p: [-2 + i * 0.2, 0.92, 0], yaw: 0, pitch: 0 }, ct: now }, now);
        }
        const samples = [];
        const drifts = [];
        const cpuStart = process.cpuUsage();
        const rssBefore = process.memoryUsage().rss;
        const startedAt = performance.now();
        const deadline = startedAt + seconds * 1000;
        let expected = startedAt + 50;
        let step = 0;
        while (performance.now() < deadline) {
            const target = expected;
            await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(0, target - performance.now())));
            const realNow = Date.now();
            const tickStarted = performance.now();
            drifts.push(tickStarted - target);
            if (mode === 'movement') {
                for (let i = 0; i < count; i++) {
                    room.message(`p${i}`, {
                        type: 'pose',
                        pose: { p: [-2 + i * 0.2 + (step % 200) * 0.002, 0.92, 0], yaw: 0, pitch: 0 },
                        ct: realNow
                    }, realNow);
                }
                step++;
            }
            room.tick(realNow);
            samples.push(performance.now() - tickStarted);
            expected += 50;
            // Do not burst through stale publication deadlines after a blocking event-loop pause.
            if (expected < performance.now()) expected = performance.now() + 50;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        const cpu = process.cpuUsage(cpuStart);
        console.log(JSON.stringify({
            players: count,
            mode,
            snapshotMode,
            ticks: samples.length,
            elapsedSeconds: +elapsed.toFixed(2),
            tickMs: percentiles(samples),
            driftMs: percentiles(drifts),
            snapshots: snapshotCount,
            outboundBytesPerSecond: +((serializedBytes / elapsed)).toFixed(1),
            serializeMs: percentiles(serializeSamples),
            cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1),
            rssDeltaBytes: process.memoryUsage().rss - rssBefore
        }));
    }
}
