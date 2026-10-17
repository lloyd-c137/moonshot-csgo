import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioVoicePool } from '../src/gameplay/feedback/AudioVoicePool.ts';

class FakeVoice {
    ended;
    stopCount = 0;

    addEventListener(_type, listener) {
        this.ended = listener;
    }

    stop() {
        this.stopCount++;
    }

    finish() {
        const ended = this.ended;
        this.ended = undefined;
        ended?.();
    }
}

test('audio voice pools cap each bus independently by stopping its oldest source', () => {
    const pool = new AudioVoicePool({ combat: 2, confirmation: 1 });
    const oldest = new FakeVoice();
    const second = new FakeVoice();
    const next = new FakeVoice();
    const confirmation = new FakeVoice();

    pool.track('combat', oldest, () => undefined);
    pool.track('combat', second, () => undefined);
    pool.track('confirmation', confirmation, () => undefined);
    pool.track('combat', next, () => undefined);

    assert.equal(oldest.stopCount, 1);
    assert.equal(second.stopCount, 0);
    assert.equal(confirmation.stopCount, 0);
    assert.equal(pool.count(), 3);
});

test('ended voices release exactly one slot and run their resource cleanup', () => {
    const pool = new AudioVoicePool({ combat: 1 });
    const ended = new FakeVoice();
    let cleanups = 0;
    pool.track('combat', ended, () => cleanups++);

    ended.finish();
    ended.finish();

    assert.equal(pool.count(), 0);
    assert.equal(cleanups, 1);
});

test('low-priority voices cannot evict elimination confirmations from a full bus', () => {
    const pool = new AudioVoicePool({ confirmation: 2 });
    const bodyHit = new FakeVoice();
    const elimination = new FakeVoice();
    const headHit = new FakeVoice();
    const anotherBodyHit = new FakeVoice();
    let rejectedCleanup = 0;

    pool.track('confirmation', bodyHit, () => undefined, 1);
    pool.track('confirmation', elimination, () => undefined, 5);
    pool.track('confirmation', headHit, () => undefined, 2);
    assert.equal(bodyHit.stopCount, 1, 'the oldest lowest-priority voice is evicted first');
    assert.equal(elimination.stopCount, 0);
    assert.equal(headHit.stopCount, 0);

    const accepted = pool.track('confirmation', anotherBodyHit, () => rejectedCleanup++, 1);
    assert.equal(accepted, false, 'a low-priority arrival is dropped when all active voices outrank it');
    assert.equal(anotherBodyHit.stopCount, 1);
    assert.equal(rejectedCleanup, 1);
    assert.equal(elimination.stopCount, 0);
    assert.equal(headHit.stopCount, 0);
    assert.equal(pool.count(), 2);
});

test('an incoming critical cue can evict the lowest-priority active voice', () => {
    const pool = new AudioVoicePool({ confirmation: 2 });
    const bodyHit = new FakeVoice();
    const elimination = new FakeVoice();
    const roundResult = new FakeVoice();
    pool.track('confirmation', bodyHit, () => undefined, 2);
    pool.track('confirmation', elimination, () => undefined, 4);

    assert.equal(
        pool.track('confirmation', roundResult, () => undefined, 5),
        true
    );
    assert.equal(bodyHit.stopCount, 1);
    assert.equal(elimination.stopCount, 0);
    assert.equal(pool.count(), 2);
});
