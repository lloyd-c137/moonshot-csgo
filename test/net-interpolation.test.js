import assert from 'node:assert/strict';
import test from 'node:test';

import { PoseBuffer, ServerClock } from '../src/net/interpolation.ts';

const pose = (x, yaw = 0) => ({ p: [x, 0.9, 0], yaw, pitch: 0 });

test('stamped poses interpolate smoothly even when snapshots repeat or bunch', () => {
    const buffer = new PoseBuffer();
    // A player walking 3 m/s, poses received every 50 ms; the same pose relayed twice must not stall motion.
    for (let t = 0; t <= 500; t += 50) {
        buffer.push(t, pose((3 * t) / 1000));
        buffer.push(t, pose((3 * t) / 1000)); // duplicate snapshot
    }
    assert.equal(buffer.size, 11);
    let previous = -Infinity;
    for (let t = 0; t <= 500; t += 7) {
        const x = buffer.sample(t).p[0];
        assert.ok(Math.abs(x - (3 * t) / 1000) < 1e-9, `x at ${t}`);
        assert.ok(x > previous);
        previous = x;
    }
});

test('late data extrapolates briefly then holds; yaw wraps the short way', () => {
    const buffer = new PoseBuffer();
    buffer.push(0, pose(0, 170));
    buffer.push(100, pose(1, -170));
    assert.ok(Math.abs(buffer.sample(50).yaw - 180) < 1e-9, 'wraps through 180°');
    assert.ok(Math.abs(buffer.sample(150).p[0] - 1.5) < 1e-9, 'short extrapolation');
    assert.ok(buffer.sample(10_000).p[0] <= 1.5 + 1e-9, 'holds after the limit');
    assert.equal(buffer.sample(-50).p[0], 0);
});

test('interpolation preserves discrete stance and switches only at its authoritative sample time', () => {
    const buffer = new PoseBuffer();
    buffer.push(100, pose(0));
    buffer.push(200, { ...pose(1), crouched: true });
    assert.equal(buffer.sample(150).crouched, undefined, 'do not predict a future crouch transition');
    assert.equal(buffer.sample(200).crouched, true, 'the transition reaches remote pose output');
    assert.equal(buffer.sample(250).crouched, true, 'late extrapolation retains the newest stance');
    buffer.push(300, pose(2));
    assert.equal(buffer.sample(250).crouched, true);
    assert.equal(buffer.sample(300).crouched, undefined, 'standing is restored at the next sample');
});

test('server clock estimate converges on the true offset despite jitter', () => {
    const clock = new ServerClock();
    const offset = 5_000;
    for (let i = 0; i < 200; i++) {
        const local = i * 50;
        const latency = 20 + ((i * 37) % 60); // 20–80 ms
        clock.observe(local + offset - latency, local);
    }
    const estimate = clock.toServer(0);
    assert.ok(estimate <= offset && estimate > offset - 30, `${estimate}`);
});
