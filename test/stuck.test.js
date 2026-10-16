import assert from 'node:assert/strict';
import test from 'node:test';

import { StuckDetector } from '../src/gameplay/stuck.ts';

const run = (detector, seconds, position, trying, start = 0) => {
    let stuck = false;
    for (let t = start; t < start + seconds; t += 1 / 60) stuck = detector.update(1 / 60, t, position(t), trying);
    return stuck;
};

test('pushing against something without moving for 2 s counts as stuck; walking does not', () => {
    const wedged = new StuckDetector();
    assert.equal(
        run(wedged, 1.5, () => [0, 0.9, 0], true),
        false,
        'not yet'
    );
    assert.equal(
        run(wedged, 0.7, () => [0.05, 0.9, 0], true, 1.5),
        true
    );
    const walking = new StuckDetector();
    assert.equal(
        run(walking, 5, (t) => [t * 3, 0.9, 0], true),
        false
    );
    const idle = new StuckDetector();
    assert.equal(
        run(idle, 5, () => [0, 0.9, 0], false),
        false,
        'standing still on purpose'
    );
});

test('sinking below the floor counts as stuck even without input; reset clears it', () => {
    const detector = new StuckDetector();
    assert.equal(
        run(detector, 1.2, () => [0, 0.2, 0], false),
        true
    );
    detector.reset();
    assert.equal(detector.update(1 / 60, 10, [0, 0.9, 0], false), false);
});

test('detention suppresses and resets the stuck timer, so release starts a fresh window', () => {
    const detector = new StuckDetector();
    let stuck = false;
    for (let t = 0; t < 8; t += 1 / 60) {
        stuck = detector.update(1 / 60, t, [0, 0.92, 0], true, true);
    }
    assert.equal(stuck, false);
    for (let t = 8; t < 9.5; t += 1 / 60) {
        stuck = detector.update(1 / 60, t, [0, 0.92, 0], true);
    }
    assert.equal(stuck, false, 'the pre-detention timer must not resume');
    for (let t = 9.5; t < 10.2; t += 1 / 60) {
        stuck = detector.update(1 / 60, t, [0, 0.92, 0], true);
    }
    assert.equal(stuck, true, 'the normal 2 s window resumes after release');
});
