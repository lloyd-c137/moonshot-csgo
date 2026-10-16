import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import {
    cleanName,
    HEAL_SECONDS,
    MAX_HP,
    parseClientMessage,
    PROTOCOL_VERSION,
    RESPAWN_SECONDS
} from '../src/net/protocol.ts';

const harness = () => {
    const inbox = new Map();
    const closed = new Set();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: (id) => closed.add(id)
        },
        24
    );
    const join = (id, name, now = 0) => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name }, now);
        return inbox.get(id);
    };
    const pose = (id, p, now) => room.message(id, { type: 'pose', pose: { p, yaw: 0, pitch: 0 } }, now);
    return { room, inbox, closed, join, pose };
};

test('players join one shared room with cleaned, unique nicknames', () => {
    const { join, inbox } = harness();
    const a = join('a', '  小明\u0000<b>  ');
    assert.equal(a[0].type, 'welcome');
    assert.equal(a[0].name, '小明b');
    const b = join('b', '小明b');
    assert.equal(b[0].name, '小明b2');
    assert.deepEqual(
        b[0].players.map((player) => player.id),
        ['a', 'b']
    );
    assert.ok(inbox.get('a').some((message) => message.type === 'joined' && message.player.id === 'b'));
    const c = join('c', '');
    assert.match(c[0].name, /^飞盘手\d{3}$/);
});

test('wrong protocol versions and garbage are rejected', () => {
    const { room, inbox, closed } = harness();
    inbox.set('x', []);
    room.connect('x');
    room.message('x', { type: 'hello', version: PROTOCOL_VERSION + 1, name: 'x' }, 0);
    assert.deepEqual(inbox.get('x')[0], { type: 'rejected', reason: 'version' });
    assert.ok(closed.has('x'));
    assert.equal(parseClientMessage('{"type":"pose","pose":{"p":[1,2],"yaw":0,"pitch":0}}'), null);
    assert.equal(parseClientMessage('not json'), null);
    assert.equal(parseClientMessage('x'.repeat(5000)), null);
    assert.equal(cleanName('a'.repeat(40)).length, 16);
});

test('two valid hits eliminate (one per disc), score 1 + 1 + 2, then the server respawns at full health', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    pose('a', [0, 0.9, 0], 100);
    pose('b', [8, 0.9, 0], 100);
    const throwAndHit = (id, at) => {
        room.message('a', { type: 'throw', throw: { id, o: [0.3, 1.5, 0], v: [18, 1, 0], tilt: 0 } }, at);
        room.message('a', { type: 'hit', throwId: id, target: 'b', at: [8, 1.2, 0] }, at + 500);
    };
    throwAndHit(1, 1000);
    assert.ok(inbox.get('b').some((message) => message.type === 'thrown' && message.from === 'a'));
    let struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual([struck.length, struck[0].hp, struck[0].out, struck[0].scores.a], [1, 1, false, [1, 0, 0]]);
    // The same disc cannot score twice.
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [8, 1.2, 0] }, 1600);
    assert.equal(inbox.get('b').filter((message) => message.type === 'struck').length, 1);
    throwAndHit(2, 2000);
    struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual(
        [struck[1].hp, struck[1].out, struck[1].scores.a, struck[1].scores.b],
        [0, true, [4, 1, 0], [0, 0, 1]]
    );
    // Eliminated players cannot be hit again.
    throwAndHit(3, 3000);
    assert.equal(inbox.get('b').filter((message) => message.type === 'struck').length, 2);
    room.tick(2500 + RESPAWN_SECONDS * 1000 + 10);
    const respawn = inbox.get('b').find((message) => message.type === 'respawn');
    assert.equal(respawn.id, 'b');
    assert.ok(respawn.spawn >= 0 && respawn.spawn < 24);
    room.message('b', { type: 'respawned', pose: { p: [1, 0.9, 1], yaw: 0, pitch: 0 } }, 6000);
    assert.deepEqual([room.players.get('b').alive, room.players.get('b').hp], [true, MAX_HP]);
});

test('a damaged player heals to full after a quiet spell', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    pose('a', [0, 0.9, 0], 0);
    pose('b', [6, 0.9, 0], 0);
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 3000);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [6, 1, 0] }, 3400);
    assert.equal(room.players.get('b').hp, MAX_HP - 1);
    room.tick(3400 + (HEAL_SECONDS - 1) * 1000);
    assert.equal(room.players.get('b').hp, MAX_HP - 1);
    room.tick(3400 + (HEAL_SECONDS + 1) * 1000);
    assert.equal(room.players.get('b').hp, MAX_HP);
    assert.ok(inbox.get('b').some((message) => message.type === 'healed' && message.id === 'b'));
});

test('implausible claims are ignored: out of reach, unknown throw, self-hit, cooldown, launch far away', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    pose('a', [0, 0.9, 0], 0);
    pose('b', [60, 0.9, 0], 0);
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 1000);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [60, 1, 0] }, 1200); // 60 m in 0.2 s
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [5, 1, 0] }, 9000); // claimed contact far from the target
    room.message('a', { type: 'hit', throwId: 9, target: 'b', at: [60, 1, 0] }, 1200); // unknown throw
    room.message('a', { type: 'hit', throwId: 1, target: 'a', at: [0, 1, 0] }, 1200); // self
    room.message('a', { type: 'throw', throw: { id: 2, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 1100); // cooldown
    room.message('a', { type: 'throw', throw: { id: 3, o: [30, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 3000); // far
    room.message('a', { type: 'throw', throw: { id: 4, o: [0, 1.5, 0], v: [90, 0, 0], tilt: 0 } }, 3000); // too fast
    const all = inbox.get('b');
    assert.equal(all.filter((message) => message.type === 'struck').length, 0);
    assert.deepEqual(
        all.filter((message) => message.type === 'thrown').map((message) => message.throw.id),
        [1]
    );
});

test('snapshots carry live players and leaving is broadcast', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    pose('a', [1, 0.9, 2], 0);
    pose('b', [500, 0.9, 2], 0); // out of bounds: ignored
    room.tick(100);
    const snapshot = inbox.get('b').findLast((message) => message.type === 'snapshot');
    assert.deepEqual(Object.keys(snapshot.poses), ['a']);
    room.disconnect('a');
    assert.ok(inbox.get('b').some((message) => message.type === 'left' && message.id === 'a'));
});

test('players get clearly different colours', () => {
    const { join, room } = harness();
    for (const id of ['a', 'b', 'c', 'd']) join(id, id);
    const hues = [...room.players.values()].map((player) => player.colour);
    for (let i = 0; i < hues.length; i++) {
        for (let j = i + 1; j < hues.length; j++) {
            const gap = Math.abs(hues[i] - hues[j]);
            assert.ok(Math.min(gap, 360 - gap) >= 60, `${hues}`);
        }
    }
});

test('players cannot be hit during spawn protection, and snapshots carry server receive times', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A', 0);
    join('b', 'B', 10_000); // b just (re)spawned at t = 10 s
    pose('a', [0, 0.9, 0], 10_000);
    pose('b', [6, 0.9, 0], 10_100);
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 10_200);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [6, 1, 0] }, 10_600);
    assert.equal(room.players.get('b').hp, MAX_HP, 'protected');
    room.message('a', { type: 'throw', throw: { id: 2, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 12_000);
    room.message('a', { type: 'hit', throwId: 2, target: 'b', at: [6, 1, 0] }, 12_400);
    assert.equal(room.players.get('b').hp, MAX_HP - 1, 'protection over');
    room.tick(12_500);
    const snapshot = inbox.get('a').findLast((message) => message.type === 'snapshot');
    assert.equal(snapshot.poses.b.t, 10_100);
    const thrown = inbox.get('b').find((message) => message.type === 'thrown');
    assert.equal(thrown.t, 10_200);
});
