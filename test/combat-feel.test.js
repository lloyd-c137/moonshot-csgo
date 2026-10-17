import assert from 'node:assert/strict';
import test from 'node:test';

import {
    aimTarget,
    endsRound,
    HIT_STOP_MS
} from '../src/gameplay/combatFeel.ts';
import { killIcons, streakName } from '../src/ui/killFeed.ts';

test('aim target: the nearest body on the view ray, in range, in front', () => {
    const bodies = [
        ['far', [0, 1.6, -20]],
        ['near', [0.2, 1.6, -8]],
        ['beside', [3, 1.6, -5]],
        ['behind', [0, 1.6, 5]]
    ];
    assert.deepEqual(aimTarget([0, 1.6, 0], [0, 0, -1], bodies, 30)?.id, 'near');
    assert.equal(aimTarget([0, 1.6, 0], [0, 0, -1], [['far', [0, 1.6, -40]]], 30), null, 'out of range');
    assert.equal(aimTarget([0, 1.6, 0], [0, 0, -1], [['beside', [3, 1.6, -5]]], 30), null);
});

test('hit-stop is reserved for heads and eliminations; slow motion only for the round-ending one', () => {
    assert.equal(HIT_STOP_MS.hit, 0);
    assert.ok(HIT_STOP_MS.head > 0 && HIT_STOP_MS.kill > HIT_STOP_MS.head);
    assert.equal(endsRound(true, 1), true);
    assert.equal(endsRound(true, 3), false);
    assert.equal(endsRound(false, 1), false, 'a respawning elimination never ends the round');
});

test('kill icons: weapon first, then how; each icon has one meaning', () => {
    const base = { head: false, sniper: false, gold: false, execution: false, guard: false, bank: false, range: 8 };
    assert.deepEqual(killIcons(base), ['disc']);
    assert.deepEqual(killIcons({ ...base, head: true, bank: true, range: 26 }), ['disc', 'head', 'bank', 'long']);
    assert.deepEqual(killIcons({ ...base, sniper: true, head: true }), ['sniper', 'head']);
    assert.deepEqual(killIcons({ ...base, gold: true }), ['gold']);
    assert.deepEqual(killIcons({ ...base, execution: true, head: true }), ['execution']);
    assert.deepEqual(killIcons({ ...base, guard: true }), ['guard']);
    assert.deepEqual(killIcons({ ...base, range: null }), ['disc']);
    assert.equal(streakName(2), '双杀');
    assert.equal(streakName(7), '7 连淘汰');
});
