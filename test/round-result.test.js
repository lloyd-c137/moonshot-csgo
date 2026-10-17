import assert from 'node:assert/strict';
import test from 'node:test';

import { roundResultCopy } from '../src/ui/roundResult.ts';

test('round result copy distinguishes golden-disc wins, last-survivor wins and draws', () => {
    assert.deepEqual(roundResultCopy({ outcome: 'golden-disc', winner: 'A', mine: true }), {
        kicker: '金飞盘守擂',
        title: '你赢得了本局！'
    });
    assert.deepEqual(roundResultCopy({ outcome: 'golden-disc', winner: 'A', mine: false }), {
        kicker: '金飞盘守擂',
        title: 'A 赢得本局'
    });
    assert.deepEqual(roundResultCopy({ outcome: 'last-survivor', winner: 'B', mine: true }), {
        kicker: '最终幸存者',
        title: '你赢得了本局！'
    });
    assert.deepEqual(roundResultCopy({ outcome: 'last-survivor', winner: 'B', mine: false }), {
        kicker: '最终幸存者',
        title: 'B 赢得本局'
    });
    assert.deepEqual(roundResultCopy({ outcome: 'draw', winner: null, mine: false }), {
        kicker: '本局平局',
        title: '没有胜者'
    });
});
