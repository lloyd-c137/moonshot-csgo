import assert from 'node:assert/strict';
import test from 'node:test';

import { createMedalTracker } from '../src/gameplay/medals.ts';

const ids = (awards) => awards.map((award) => award.id);

test('first kill of the match is first blood; a quick second is a double', () => {
    const medals = createMedalTracker(() => 'me');
    assert.deepEqual(ids(medals.kill({ time: 1, killer: 'me', victim: 'a' })), ['first-blood']);
    assert.deepEqual(ids(medals.kill({ time: 3, killer: 'me', victim: 'b' })), ['multi-2']);
    assert.deepEqual(ids(medals.kill({ time: 20, killer: 'me', victim: 'c' })), []);
});

test('first blood belongs to whoever drew it, not only to me', () => {
    const medals = createMedalTracker(() => 'me');
    assert.deepEqual(medals.kill({ time: 1, killer: 'x', victim: 'a' }), []);
    assert.deepEqual(ids(medals.kill({ time: 2, killer: 'me', victim: 'x' })), []);
});

test('revenge on whoever last eliminated me, once', () => {
    const medals = createMedalTracker(() => 'me');
    medals.kill({ time: 1, killer: 'x', victim: 'me' });
    assert.ok(ids(medals.kill({ time: 10, killer: 'me', victim: 'x' })).includes('revenge'));
    assert.ok(!ids(medals.kill({ time: 30, killer: 'me', victim: 'x' })).includes('revenge'));
});

test('ending a streak, beating the leader and special kills', () => {
    const medals = createMedalTracker(() => 'me');
    for (const [time, victim] of [
        [1, 'a'],
        [10, 'b'],
        [20, 'c']
    ])
        medals.kill({ time, killer: 'x', victim });
    medals.setLeader('x');
    const awards = ids(medals.kill({ time: 40, killer: 'me', victim: 'x', head: true }));
    assert.ok(awards.includes('buzzkill'));
    assert.ok(awards.includes('kingslayer'));
    assert.ok(awards.length <= 3);
});

test('legendary medals come first and the list never floods', () => {
    const medals = createMedalTracker(() => 'me');
    const awards = medals.kill({
        time: 1,
        killer: 'me',
        victim: 'a',
        execution: true,
        head: true,
        bank: true,
        distance: 40,
        frc: true
    });
    assert.equal(awards[0].tier, 'legend');
    assert.equal(awards.length, 3);
});

test('a long throw reports its distance', () => {
    const medals = createMedalTracker(() => 'me');
    medals.kill({ time: 0, killer: 'x', victim: 'y' });
    const [award] = medals.kill({ time: 1, killer: 'me', victim: 'a', distance: 31.4 });
    assert.equal(award.id, 'longshot');
    assert.equal(award.detail, '31 米');
});
