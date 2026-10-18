import assert from 'node:assert/strict';
import test from 'node:test';

import { activeCutscene, CUTSCENE_SECONDS, cutsceneShot, inCutscene } from '../src/gameplay/cutscenes/cutscenes.ts';
import { guardAt } from '../src/gameplay/guard.ts';
import { ROUND } from '../src/net/protocol.ts';

const none = { pulledAt: null };

test('the lights-out cutscene runs from the blackout for its length', () => {
    assert.equal(activeCutscene(999, 1000, none), null);
    assert.deepEqual(activeCutscene(1000, 1000, none), { kind: 'blackout', at: 1000, t: 0 });
    assert.equal(activeCutscene(1000 + CUTSCENE_SECONDS.blackout * 1000 - 1, 1000, none)?.kind, 'blackout');
    assert.equal(inCutscene(1000 + CUTSCENE_SECONDS.blackout * 1000, 1000, none), false);
});

test('the breaker cutscene runs from the pull', () => {
    const power = { pulledAt: 5000 };
    assert.equal(activeCutscene(5000 + 100, null, power)?.kind, 'breaker');
    assert.equal(activeCutscene(5000 + CUTSCENE_SECONDS.breaker * 1000, null, power), null);
});

test('the golden-disc and final-duel moments have shared 3–4 s windows and seekable camera shots', () => {
    for (const [kind, seconds] of [['gold-first', 3.6], ['last-two', 3.4]]) {
        const moment = { id: `test-${kind}`, kind, at: 7000, focus: [-8, 0.92, 4], secondary: [-5, 0.92, 4] };
        assert.equal(CUTSCENE_SECONDS[kind], seconds);
        assert.deepEqual(activeCutscene(7000, null, none, moment), { kind, at: 7000, t: 0, moment });
        assert.equal(activeCutscene(7000 + seconds * 1000, null, none, moment), null);
        for (const t of [0, seconds / 2, seconds - 0.1]) {
            const shot = cutsceneShot(kind, t, { x: 0, z: 0, yaw: 0, walking: false }, [0, 0, 0], moment);
            assert.ok([...shot.eye, ...shot.target, shot.fov].every(Number.isFinite));
            assert.ok(shot.fov >= 45 && shot.fov <= 70);
        }
    }
});

test('the guard waits at his post through the close-up, then sets off on camera', () => {
    const blackout = 10_000;
    const before = guardAt(blackout + ROUND.guardNightDelaySeconds * 1000 - 1, blackout);
    assert.equal(before.walking, false);
    const later = guardAt(blackout + CUTSCENE_SECONDS.blackout * 1000, blackout);
    assert.ok(Math.hypot(later.x - before.x, later.z - before.z) > 1, 'the guard has not moved by the end');
    assert.ok(ROUND.guardNightDelaySeconds < CUTSCENE_SECONDS.blackout);
});

test('every shot is finite and frames its subject from a sensible distance', () => {
    const cabinet = [-51.95, 1.25, -13.08];
    for (const kind of ['blackout', 'breaker']) {
        for (let t = 0; t < CUTSCENE_SECONDS[kind]; t += 0.1) {
            const guard = guardAt(10_000 + t * 1000, kind === 'blackout' ? 10_000 : null, kind === 'breaker' ? { pulledAt: 10_000 } : none);
            const shot = cutsceneShot(kind, t, guard, cabinet);
            assert.ok([...shot.eye, ...shot.target, shot.fov].every(Number.isFinite));
            const distance = Math.hypot(shot.eye[0] - shot.target[0], shot.eye[1] - shot.target[1], shot.eye[2] - shot.target[2]);
            assert.ok(distance > 1 && distance < 9, `${kind} at ${t.toFixed(1)}: ${distance.toFixed(1)} m`);
        }
    }
});
