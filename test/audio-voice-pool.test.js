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
