import assert from 'node:assert/strict';
import test from 'node:test';

import { FINISHER_STRIKE } from '../src/gameplay/finisher/finisherTiming.ts';
import {
    TOSS,
    tossApproach,
    tossArmKeys,
    tossDisc,
    tossVictimKeys,
    tossWalkWeight
} from '../src/gameplay/finisher/tossTimeline.ts';

// A still hand 1.2 m behind the target's back, both facing +Z (the target looks away from the attacker).
const victim = [0, 0, 0],
    forward = [0, 0, 1],
    hand = [0.25, 1.3, -1.2];
const disc = (frame) => tossDisc(frame, hand, hand, hand, victim, forward).at;
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('the toss goes up overhead and comes back to the hand', () => {
    assert.deepEqual(disc(TOSS.tossRelease - 1), hand);
    const top = disc((TOSS.tossRelease + TOSS.tossCatch) / 2);
    assert.ok(top[1] > hand[1] + 1.2, 'well above the head');
    assert.ok(gap(disc(TOSS.tossCatch - 0.01), hand) < 0.05, 'caught');
});

test('the throw loops out ahead of the target and returns onto its neck at the strike', () => {
    const far = Math.max(
        ...Array.from(
            { length: 40 },
            (_, i) => disc(TOSS.throwRelease + (i * (TOSS.strike - TOSS.throwRelease)) / 40)[2]
        )
    );
    assert.ok(far > 5, `flies well out ahead (${far.toFixed(1)} m)`);
    const strike = disc(TOSS.strike - 0.001);
    assert.ok(gap(strike, [0, 1.5, 0]) < 0.1, 'hits the neck');
    assert.ok(gap(disc(TOSS.homeCatch - 0.01), hand) < 0.1, 'flies home to the hand');
    assert.ok(Math.abs(FINISHER_STRIKE - TOSS.strike / TOSS.frames) < 1e-12, 'bullet time lands on the hit');
});

test('the disc never jumps between frames of a flight', () => {
    for (const [from, to] of [
        [TOSS.tossRelease, TOSS.tossCatch],
        [TOSS.throwRelease, TOSS.homeCatch]
    ]) {
        let previous = disc(from);
        for (let f = from + 0.05; f < to; f += 0.05) {
            const now = disc(f);
            assert.ok(gap(now, previous) < 0.45, `jump at frame ${f.toFixed(2)}`);
            previous = now;
        }
    }
});

test('the attacker strolls in and stops; key poses are in order', () => {
    assert.equal(tossApproach(0), 0);
    assert.equal(tossApproach(TOSS.walkEndFrame), 1);
    for (let f = 1; f <= TOSS.frames; f++) assert.ok(tossApproach(f) >= tossApproach(f - 1));
    assert.equal(tossWalkWeight(0), 1);
    assert.equal(tossWalkWeight(TOSS.throwRelease + 1), 0);
    for (const keys of [tossArmKeys, tossVictimKeys]) {
        for (let i = 1; i < keys.length; i++) assert.ok(keys[i][0] >= keys[i - 1][0]);
        assert.equal(keys.at(-1)[0], TOSS.frames);
    }
});
