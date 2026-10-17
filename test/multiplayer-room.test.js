import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import { PE_OFFICE } from '../src/config/office.ts';
import { SPAWN_POINTS } from '../src/config/spawns.ts';
import {
    AMMO,
    cleanName,
    HEAL_SECONDS,
    MAX_HP,
    parseClientMessage,
    PROTOCOL_VERSION,
    RESPAWN_SECONDS,
    ROUND
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
    room.startAmmo = 9;
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
    assert.equal(b[0].name, '小明b·2');
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

test('two valid hits eliminate (one per disc), scoring one point for the elimination, then the server respawns at full health', () => {
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
    assert.deepEqual([struck.length, struck[0].hp, struck[0].out, struck[0].scores.a], [1, 1, false, [0, 0, 0]]);
    assert.equal(struck[0].throwId, 1);
    // The same disc cannot score twice.
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [8, 1.2, 0] }, 1600);
    assert.equal(inbox.get('b').filter((message) => message.type === 'struck').length, 1);
    assert.ok(inbox.get('a').some((message) => message.type === 'hitRejected' && message.throwId === 1));
    throwAndHit(2, 2000);
    struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual(
        [struck[1].hp, struck[1].out, struck[1].scores.a, struck[1].scores.b],
        [0, true, [1, 1, 0], [0, 0, 1]]
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

test('pose stamps follow the sender clock, not network jitter', async () => {
    const { stampPose } = await import('../server/room.ts');
    const player = { clockSamples: [], clockOffset: null, poseAt: 0 };
    const stamps = [];
    // Sent every 50 ms by the sender's clock; arrivals jitter by up to 40 ms on top of a 1000 ms clock gap.
    const jitter = [0, 35, 5, 40, 12, 0, 28, 3, 39, 0, 20, 1];
    for (let i = 0; i < jitter.length; i++) {
        const ct = 5000 + i * 50;
        const arrival = 6000 + i * 50 + jitter[i];
        stamps.push(stampPose(player, ct, arrival));
        player.poseAt = stamps[stamps.length - 1];
    }
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    for (const gap of gaps) assert.ok(gap > 45 && gap < 55, `even spacing (${gaps.join(',')})`);
    // Never in the future of the arrival; a missing sender clock falls back to arrival time.
    assert.ok(stamps.every((t, i) => t <= 6000 + i * 50 + jitter[i]));
    assert.equal(stampPose({ clockSamples: [], clockOffset: null, poseAt: 0 }, undefined, 777), 777);
});

test('a sniper disc to the head eliminates outright; a slow throw cannot claim the sniper flag', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: () => undefined
        },
        24
    );
    room.startAmmo = 9;
    for (const id of ['a', 'b']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id.toUpperCase() }, 0);
    }
    room.message('a', { type: 'pose', pose: { p: [0, 0.9, 0], yaw: 0, pitch: 0, aim: 1 } }, 3000);
    room.message('b', { type: 'pose', pose: { p: [20, 0.9, 0], yaw: 0, pitch: 0 } }, 3000);
    const struck = () => inbox.get('b').filter((message) => message.type === 'struck');
    // Claims sniper at normal speed: honoured as a normal throw, one point of damage to the body.
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [20, 0, 0], tilt: 0, sniper: true } }, 4000);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [20, 1.2, 0] }, 4900);
    assert.deepEqual(
        struck().map((m) => [m.hp, m.out, m.head, m.sniper]),
        [[1, false, false, false]]
    );
    room.players.get('b').hp = MAX_HP;
    // A real sniper throw to the head: out in one from full health.
    room.message('a', { type: 'throw', throw: { id: 2, o: [0, 1.5, 0], v: [34, 0, 0], tilt: 0, sniper: true } }, 5000);
    room.message('a', { type: 'hit', throwId: 2, target: 'b', at: [20, 1.5, 0] }, 5600);
    assert.deepEqual(struck()[1], { ...struck()[1], hp: 0, out: true, head: true, sniper: true });
    // The aim level travels with the pose so others can see the scope glint.
    const snapshot = room.players.get('a').pose;
    assert.equal(snapshot.aim, 1);
});

test('ordinary and golden head hits eliminate full health; spawn protection and one-hit-per-disc remain', () => {
    for (const golden of [false, true]) {
        const { room, join, pose, inbox } = harness();
        join('a', 'A');
        join('b', 'B');
        pose('a', [0, 0.9, 0], 100);
        pose('b', [6, 0.9, 0], 100);
        if (golden) room.gold.holder = 'a';
        room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [20, 0, 0], tilt: 0 } }, 1000);
        const hit = { type: 'hit', throwId: 1, target: 'b', at: [6, 1.5, 0] };
        room.message('a', hit, 1300);
        assert.equal(room.players.get('b').hp, MAX_HP, 'protected');
        room.message('a', hit, 1600);
        room.message('a', hit, 1700);
        const struck = inbox.get('a').filter((message) => message.type === 'struck');
        assert.equal(struck.length, 1);
        assert.deepEqual([struck[0].hp, struck[0].out, struck[0].head, struck[0].gold], [0, true, true, golden]);
        assert.equal(room.players.get('a').kills, 1);
    }
});

test('rounds: the golden disc spawns, is picked up, drops on elimination, and its holder wins at time', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: () => undefined
        },
        24,
        null,
        () => 0 // golden disc at the first spawn point
    );
    room.startAmmo = 9;
    for (const id of ['a', 'b']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id.toUpperCase() }, 0);
    }
    const welcome = inbox.get('a')[0];
    assert.equal(welcome.type, 'welcome');
    assert.deepEqual(welcome.round, { phase: 'playing', endsAt: ROUND.roundSeconds * 1000 });
    assert.deepEqual(welcome.gold, { holder: null, at: [SPAWN_POINTS[0][0], 0.92, SPAWN_POINTS[0][1]] });
    const goldEvents = () =>
        inbox
            .get('b')
            .filter((m) => m.type === 'gold')
            .map((m) => [m.event, m.gold.holder]);
    // Too far: nothing. Walking onto it: taken.
    room.message(
        'a',
        { type: 'pose', pose: { p: [SPAWN_POINTS[0][0] + 5, 0.92, SPAWN_POINTS[0][1]], yaw: 0, pitch: 0 } },
        2000
    );
    assert.deepEqual(goldEvents(), []);
    room.message(
        'a',
        { type: 'pose', pose: { p: [SPAWN_POINTS[0][0] + 1, 0.92, SPAWN_POINTS[0][1]], yaw: 0, pitch: 0 } },
        2100
    );
    assert.deepEqual(goldEvents(), [['taken', 'a']]);
    // B eliminates A: the disc drops where A fell, and B picks it up after the short delay.
    const [ax, , az] = room.players.get('a').pose.p;
    room.message('b', { type: 'pose', pose: { p: [ax + 6, 0.92, az], yaw: 0, pitch: 0 } }, 3000);
    for (const [id, at] of [
        [1, 4000],
        [2, 5000]
    ]) {
        room.message('b', { type: 'throw', throw: { id, o: [ax + 6, 1.5, az], v: [-15, 0, 0], tilt: 0 } }, at);
        room.message('b', { type: 'hit', throwId: id, target: 'a', at: [ax, 1.0, az] }, at + 300);
    }
    assert.deepEqual(goldEvents().slice(1), [['dropped', null]]);
    room.message('b', { type: 'pose', pose: { p: [ax + 0.5, 0.92, az], yaw: 0, pitch: 0 } }, 5400);
    assert.equal(goldEvents().length, 2, 'not straight away');
    room.message('b', { type: 'pose', pose: { p: [ax + 0.5, 0.92, az], yaw: 0, pitch: 0 } }, 6500);
    assert.deepEqual(goldEvents().at(-1), ['taken', 'b']);
    // Kills score one point each.
    assert.deepEqual(room.summaries().find((p) => p.id === 'b').score, 1);
    // Time runs out: B holds it and wins; a new round follows after the intermission with scores reset.
    room.tick(ROUND.roundSeconds * 1000 + 1);
    const ended = inbox
        .get('a')
        .filter((m) => m.type === 'round')
        .at(-1);
    assert.equal(ended.round.phase, 'ended');
    assert.equal(ended.round.winner, 'B');
    assert.equal(ended.round.outcome, 'golden-disc');
    room.tick(ROUND.roundSeconds * 1000 + ROUND.intermissionSeconds * 1000 + 2);
    const next = inbox
        .get('a')
        .filter((m) => m.type === 'round')
        .at(-1);
    assert.equal(next.round.phase, 'playing');
    assert.deepEqual(next.scores.b, [0, 0, 0]);
    assert.deepEqual(goldEvents().at(-1), ['spawned', null]);
    // Latency probe is echoed.
    room.message('a', { type: 'ping', c: 42 }, 1);
    assert.deepEqual(inbox.get('a').at(-1), { type: 'pong', c: 42 });
});

test('discs are ammunition: throws spend them, landed discs are picked up, the PE office hands out more', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: () => undefined
        },
        24,
        null,
        () => 0.5
    );
    inbox.set('a', []);
    room.connect('a');
    room.message('a', { type: 'hello', version: PROTOCOL_VERSION, name: 'A' }, 0);
    assert.equal(inbox.get('a')[0].ammo, AMMO.max, 'a full load on joining');
    room.players.get('a').ammo = 1; // down to the last disc
    const pose = (x, at) => room.message('a', { type: 'pose', pose: { p: [x, 0.92, 0], yaw: 0, pitch: 0 } }, at);
    pose(0, 100);
    const thrown = () => [...room.players.get('a').throws.keys()];
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [10, 0, 0], tilt: 0 } }, 1000);
    room.message('a', { type: 'throw', throw: { id: 2, o: [0, 1.5, 0], v: [10, 0, 0], tilt: 0 } }, 2000);
    assert.deepEqual(thrown(), [1], 'no disc left for the second throw');
    assert.deepEqual(
        inbox
            .get('a')
            .filter((m) => m.type === 'ammo')
            .map((m) => m.ammo),
        [0]
    );
    // It lands 12 m away and lies there; walking over picks it up again.
    room.message('a', { type: 'landed', throwId: 1, at: [12, 0.05, 0] }, 3000);
    assert.equal(room.discs.length, 1);
    pose(6, 3500);
    assert.equal(room.discs.length, 1, 'too far');
    pose(11.5, 4000);
    assert.equal(room.discs.length, 0);
    assert.equal(
        inbox
            .get('a')
            .filter((m) => m.type === 'ammo')
            .at(-1).ammo,
        1
    );
    // An implausible landing far beyond the throw is ignored.
    room.message('a', { type: 'throw', throw: { id: 3, o: [11.5, 1.5, 0], v: [5, 0, 0], tilt: 0 } }, 5000);
    room.message('a', { type: 'landed', throwId: 3, at: [70, 0.05, 60] }, 6000);
    assert.equal(room.discs.length, 0);
    // The PE office puts out a disc every minute.
    room.tick(5000 + AMMO.officeSeconds * 1000 + 1);
    const office = inbox
        .get('a')
        .filter((m) => m.type === 'discs')
        .at(-1);
    assert.equal(office.added.office, true);
    assert.ok(Math.hypot(office.discs[0].at[0] - PE_OFFICE.x, office.discs[0].at[2] - PE_OFFICE.z) < 1);
    // The golden disc's holder throws without spending anything.
    room.gold = { holder: 'a', at: [0, 0.92, 0] };
    room.message('a', { type: 'throw', throw: { id: 4, o: [11.5, 1.5, 0], v: [5, 0, 0], tilt: 0 } }, 70_000);
    assert.ok(thrown().includes(4));
    assert.equal(room.players.get('a').ammo, 0);
});

test("the golden disc's throws leave an ordinary disc where they come down, without spending the holder's", () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: () => undefined
        },
        24,
        null,
        () => 0 // the drop chance always hits
    );
    inbox.set('a', []);
    room.connect('a');
    room.message('a', { type: 'hello', version: PROTOCOL_VERSION, name: 'A' }, 0);
    room.message('a', { type: 'pose', pose: { p: [0, 0.92, 0], yaw: 0, pitch: 0 } }, 100);
    room.gold = { holder: 'a', at: [0, 0.92, 0] };
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [10, 0, 0], tilt: 0 } }, 1000);
    room.message('a', { type: 'landed', throwId: 1, at: [10, 0.02, 0] }, 2000);
    assert.deepEqual(
        room.discs.map((disc) => disc.at),
        [[10, 0.02, 0]]
    );
    assert.equal(room.players.get('a').ammo, AMMO.start);
});

test('blackout: eliminations are final, the guard can spot players, the last one standing wins; deaths drop a disc', async () => {
    const { guardAt } = await import('../src/gameplay/guard.ts');
    const inbox = new Map();
    let roll = 0.9;
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: () => undefined
        },
        24,
        null,
        () => roll
    );
    room.startAmmo = 9;
    for (const id of ['a', 'b', 'c']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id.toUpperCase() }, 0);
    }
    const blackout = room.blackoutAt();
    assert.equal(ROUND.blackoutSecondsLeft, 180);
    assert.equal(blackout, 420_000);
    // Golden throws leave a disc only sometimes (here: the roll misses).
    room.gold = { holder: 'a', at: [0, 0.92, 0] };
    room.message('a', { type: 'pose', pose: { p: [0, 0.92, 0], yaw: 0, pitch: 0 } }, 100);
    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [10, 0, 0], tilt: 0 } }, 1000);
    room.message('a', { type: 'landed', throwId: 1, at: [10, 0.02, 0] }, 2000);
    assert.equal(room.discs.length, 0);
    roll = 0.1;
    room.message('a', { type: 'throw', throw: { id: 2, o: [0, 1.5, 0], v: [10, 0, 0], tilt: 0 } }, 3000);
    room.message('a', { type: 'landed', throwId: 2, at: [10, 0.02, 0] }, 4000);
    assert.equal(room.discs.length, 1);
    room.gold = { holder: null, at: [0, 0.92, 0] };
    // Before the blackout a spotted claim does nothing.
    const g0 = guardAt(blackout - 1, blackout);
    room.message('b', { type: 'pose', pose: { p: [g0.x, 0.92, g0.z - 3], yaw: 0, pitch: 0 } }, blackout - 500);
    room.message('b', { type: 'spotted' }, blackout - 400);
    assert.equal(room.players.get('b').alive, true);
    // After it: B is caught by the flashlight — out for the round, and a disc drops where B stood.
    const discsBefore = room.discs.length;
    const g = guardAt(blackout + 1000, blackout);
    room.message('b', { type: 'pose', pose: { p: [g.x, 0.92, g.z - 3], yaw: 0, pitch: 0 } }, blackout + 900);
    room.message('b', { type: 'spotted' }, blackout + 1000);
    const struck = inbox
        .get('a')
        .filter((m) => m.type === 'struck')
        .at(-1);
    assert.deepEqual([struck.target, struck.by, struck.final], ['b', 'guard', true]);
    assert.equal(room.discs.length, discsBefore + 1);
    room.tick(blackout + 10_000);
    assert.equal(room.players.get('b').alive, false, 'no respawn after the blackout');
    // C is eliminated by A's discs: A is the last one standing and wins straight away.
    room.message('a', { type: 'pose', pose: { p: [0, 0.92, 0], yaw: 0, pitch: 0 } }, blackout + 11_000);
    room.message('c', { type: 'pose', pose: { p: [6, 0.92, 0], yaw: 0, pitch: 0 } }, blackout + 11_000);
    for (const [id, at] of [
        [3, blackout + 12_000],
        [4, blackout + 13_000]
    ]) {
        room.message('a', { type: 'throw', throw: { id, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, at);
        room.message('a', { type: 'hit', throwId: id, target: 'c', at: [6, 1.0, 0] }, at + 300);
    }
    const ended = inbox
        .get('b')
        .filter((m) => m.type === 'round')
        .at(-1);
    assert.equal(ended.round.phase, 'ended');
    assert.equal(ended.round.winner, 'A');
    assert.equal(ended.round.outcome, 'last-survivor');
    // The next round brings everyone back.
    room.tick(blackout + 13_300 + ROUND.intermissionSeconds * 1000 + 1);
    room.tick(blackout + 13_300 + ROUND.intermissionSeconds * 1000 + 100);
    assert.ok([...room.players.values()].every((p) => !p.spectating));
    const respawned = inbox
        .get('a')
        .filter((m) => m.type === 'respawn')
        .map((m) => m.id);
    assert.ok(respawned.includes('b') && respawned.includes('c'), 'the watchers are respawned');
});

test('a round that ends without a gold holder or final survivor is reported as a draw', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(message);
            },
            close: () => undefined
        },
        24,
        null,
        () => 0
    );
    for (const id of ['a', 'b']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id.toUpperCase() }, 0);
    }
    room.tick(ROUND.roundSeconds * 1000 + 1);
    const ended = inbox
        .get('a')
        .filter((message) => message.type === 'round')
        .at(-1);
    assert.equal(ended.round.winnerId, null);
    assert.equal(ended.round.outcome, 'draw');
});
