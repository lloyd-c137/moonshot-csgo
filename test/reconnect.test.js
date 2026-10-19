import assert from 'node:assert/strict';
import test from 'node:test';

import { Accounts, MemoryAccountDb } from '../server/accounts.ts';
import { Room } from '../server/room.ts';
import { AMMO, PROTOCOL_VERSION, RESPAWN_SECONDS, ROUND } from '../src/net/protocol.ts';

const harness = async (names = ['attacker', 'victim']) => {
    const accounts = new Accounts(new MemoryAccountDb());
    const tokens = new Map();
    for (const name of names) tokens.set(name, (await accounts.register(name, 'secret1', 0)).token);
    const inbox = new Map();
    const closed = new Set();
    const room = new Room(
        {
            to: (id, message) => inbox.get(id)?.push(message),
            all: (message, except) => {
                for (const [id, messages] of inbox) if (id !== except) messages.push(message);
            },
            close: (id) => closed.add(id)
        },
        24,
        accounts,
        () => 0
    );
    room.startAmmo = 9;
    const join = (id, name, now) => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name, token: tokens.get(name) }, now);
        return inbox.get(id).find((message) => message.type === 'welcome');
    };
    const pose = (id, p, now) =>
        room.message(id, { type: 'pose', pose: { p, yaw: 0, pitch: 0 } }, now);
    return { room, inbox, closed, join, pose, tokens };
};

const bodyHit = (room, at, targetId = 'b', throwId = 1) => {
    room.message('a', { type: 'throw', throw: { id: throwId, o: [0, 1.5, 0], v: [18, 0, 0], tilt: 0 } }, at);
    room.message('a', { type: 'hit', throwId, target: targetId, at: [6, 1, 0] }, at + 400);
};

test('ordinary elimination reconnect keeps score and the remaining respawn deadline', async () => {
    const { room, join, pose } = await harness();
    join('a', 'attacker', 0);
    join('b', 'victim', 0);
    pose('a', [0, 0.92, 0], 100);
    pose('b', [6, 0.92, 0], 100);
    bodyHit(room, 2000, 'b', 1);
    bodyHit(room, 3000, 'b', 2);
    bodyHit(room, 4000, 'b', 3);
    const original = room.players.get('b');
    assert.equal(original.alive, false);
    assert.equal(original.spectating, false);
    assert.equal(original.deaths, 1);
    assert.equal(room.players.get('a').kills, 1);
    const originalRespawnAt = original.respawnAt;
    const roundId = room.roundId;
    const endsAt = room.round.endsAt;
    room.disconnect('b', 4500);
    const welcome = join('b2', 'victim', 5500);
    const restored = welcome.players.find((player) => player.id === 'b2');
    assert.equal(room.roundId, roundId);
    assert.equal(room.round.endsAt, endsAt);
    assert.deepEqual([restored.alive, restored.spectating, restored.hp, restored.deaths], [false, false, 0, 1]);
    assert.equal(restored.respawnAt, originalRespawnAt);
    assert.equal(restored.respawnAt - welcome.matchTime, RESPAWN_SECONDS * 1000 - 1100);
    assert.equal(welcome.players.find((player) => player.id === 'a').score, 1);
});

test('blackout elimination remains a spectator after refresh', async () => {
    const { room, join } = await harness();
    join('a', 'attacker', 0);
    join('b', 'victim', 0);
    const time = room.blackoutAt() + ROUND.blackoutCutsceneSeconds * 1000 + 1000;
    room.players.get('b').hp = 1;
    room.players.get('a').pose = { p: [0, 0.92, 0], yaw: 0, pitch: 0 };
    room.players.get('b').pose = { p: [6, 0.92, 0], yaw: 0, pitch: 0 };
    room.players.get('a').poseAt = time;
    room.players.get('b').poseAt = time;
    room.players.get('b').history.push(time, room.players.get('b').pose);
    bodyHit(room, time);
    assert.equal(room.players.get('b').spectating, true);
    room.disconnect('b', time + 500);
    const welcome = join('b2', 'victim', time + 1000);
    const restored = welcome.players.find((player) => player.id === 'b2');
    assert.equal(restored.alive, false);
    assert.equal(restored.spectating, true);
});

test('a manual breaker outage elimination is recorded as final for the round', async () => {
    const { room, join } = await harness();
    join('a', 'attacker', 0);
    join('b', 'victim', 0);
    const time = ROUND.breakerCutsceneSeconds * 1000 + 3000;
    room.power = { pulledAt: 0 };
    room.players.get('b').hp = 1;
    room.players.get('a').pose = { p: [0, 0.92, 0], yaw: 0, pitch: 0 };
    room.players.get('b').pose = { p: [6, 0.92, 0], yaw: 0, pitch: 0 };
    room.players.get('a').poseAt = time;
    room.players.get('b').poseAt = time;
    room.players.get('b').history.push(time, room.players.get('b').pose);
    bodyHit(room, time);
    assert.equal(room.players.get('b').spectating, true);
    room.disconnect('b', time + 500);
    const welcome = join('b2', 'victim', time + 1000);
    const restored = welcome.players.find((player) => player.id === 'b2');
    assert.equal(restored.alive, false);
    assert.equal(restored.spectating, true);
});

test('completed execution and a disconnect during the global finisher cannot evade final elimination', async () => {
    const { room, join, pose } = await harness(['alpha', 'bravo', 'charlie']);
    join('a', 'alpha', 0);
    join('b', 'bravo', 0);
    join('c', 'charlie', 0);
    const execPose = (x) => ({ p: [x, 0.92, 39.6], yaw: 90, pitch: 0 });
    pose('a', execPose(-44).p, 2000);
    pose('b', execPose(-45).p, 2000);
    room.players.get('a').pose = execPose(-44);
    room.players.get('b').pose = execPose(-45);
    room.players.get('a').poseAt = 2000;
    room.players.get('b').poseAt = 2000;
    room.message('a', { type: 'executionPrepare', requestId: 'reconnect-exec', target: 'b' }, 2001);
    room.message('a', { type: 'executionCommit', requestId: 'reconnect-exec' }, 2001);
    room.tick(2401);
    assert.ok(room.globalFinisher);
    const finisherEnd = room.globalFinisher.endsAt;
    room.disconnect('b', 2500);
    assert.equal(room.globalFinisher, null, 'disconnect releases the cinematic lock');
    assert.equal(room.players.get('a').kills, 1, 'attacker receives the completed execution');
    assert.equal(room.roundStanding.get('bravo').finalOut, true);
    const welcome = join('b2', 'bravo', 3000);
    assert.equal(welcome.players.find((player) => player.id === 'b2').spectating, true);
    assert.ok(finisherEnd > 0);

    const completed = await harness(['delta', 'echo', 'foxtrot']);
    completed.join('d', 'delta', 0);
    completed.join('e', 'echo', 0);
    completed.join('f', 'foxtrot', 0);
    completed.room.players.get('d').pose = execPose(-44);
    completed.room.players.get('e').pose = execPose(-45);
    completed.room.players.get('d').poseAt = 2000;
    completed.room.players.get('e').poseAt = 2000;
    completed.room.message('d', { type: 'executionPrepare', requestId: 'completed-exec', target: 'e' }, 2001);
    completed.room.message('d', { type: 'executionCommit', requestId: 'completed-exec' }, 2001);
    completed.room.tick(2401);
    const completesAt = completed.room.globalFinisher.endsAt;
    completed.room.tick(completesAt);
    assert.equal(completed.room.players.get('e').spectating, true);
    completed.room.disconnect('e', completesAt + 1);
    const afterComplete = completed.join('e2', 'echo', completesAt + 2);
    assert.equal(afterComplete.players.find((player) => player.id === 'e2').spectating, true);
});

test('survivor refresh restores HP, ammo, score, kills and deaths while carried world items drop', async () => {
    const { room, join, pose } = await harness();
    join('a', 'attacker', 0);
    join('b', 'victim', 0);
    const player = room.players.get('b');
    pose('b', [6, 0.92, 3], 100);
    Object.assign(player, { hp: 2, score: 17, kills: 4, deaths: 2, ammo: 1, coachGift: true, ammoCapacity: 5 });
    player.hasFrc = true;
    const frc = room.items.get('item-frc');
    frc.holder = 'b';
    frc.available = false;
    room.disconnect('b', 1000);
    assert.equal(frc.holder, null);
    const welcome = join('b2', 'victim', 2000);
    const restored = welcome.players.find((entry) => entry.id === 'b2');
    assert.deepEqual([restored.alive, restored.hp, restored.score, restored.kills, restored.deaths], [true, 2, 17, 4, 2]);
    assert.equal(welcome.ammo, 1);
    assert.equal(restored.coachGift, true);
    assert.equal(restored.ammoCapacity, 5);
    assert.equal(restored.hasFrc, false, 'dropped item is never duplicated on reconnect');
});

test('the final connected player can refresh within the grace period without resetting the round', async () => {
    const { room, join } = await harness(['solo']);
    join('a', 'solo', 0);
    const roundId = room.roundId;
    const round = structuredClone(room.round);
    room.disconnect('a', 1000);
    const welcome = join('b', 'solo', 1000 + ROUND.emptyRoomGraceSeconds * 1000 - 1);
    assert.equal(room.roundId, roundId);
    assert.deepEqual(room.round, round);
    assert.equal(welcome.round.endsAt, round.endsAt);
});

test('after the empty-room grace expires, a returning account starts a new round', async () => {
    const { room, join } = await harness(['solo']);
    join('a', 'solo', 0);
    const oldRoundId = room.roundId;
    const oldEndsAt = room.round.endsAt;
    room.disconnect('a', 1000);
    const welcome = join('b', 'solo', 1001 + ROUND.emptyRoomGraceSeconds * 1000);
    assert.ok(room.roundId > oldRoundId);
    assert.notEqual(room.round.endsAt, oldEndsAt);
    assert.equal(welcome.players.find((player) => player.id === 'b').alive, true);
});

test('a second connection for the same account replaces the old socket and resumes its standing', async () => {
    const { room, join, closed } = await harness(['solo']);
    join('first', 'solo', 0);
    Object.assign(room.players.get('first'), { hp: 1, score: 8, kills: 3, deaths: 2, ammo: 2 });
    join('second', 'solo', 1000);
    const restored = room.players.get('second');
    assert.equal(closed.has('first'), true);
    assert.equal(room.players.has('first'), false);
    assert.deepEqual([restored.hp, restored.score, restored.kills, restored.deaths, restored.ammo], [1, 8, 3, 2, 2]);
});

test('starting the next round clears prior standings and brings a final spectator back', async () => {
    const { room, join } = await harness(['acctA', 'acctB']);
    join('a', 'acctA', 0);
    join('b', 'acctB', 0);
    const b = room.players.get('b');
    b.alive = false;
    b.spectating = true;
    b.hp = 0;
    room.executedAccounts.add('acctB');
    room['saveStanding'](b, 1000);
    assert.equal(room.roundStanding.size, 2);
    const endAt = room.round.endsAt;
    room.tick(endAt);
    room.tick(endAt + ROUND.intermissionSeconds * 1000);
    assert.equal(room.roundStanding.size, 0);
    assert.equal(b.spectating, false);
    assert.equal(b.respawnAt, 0, 'the scheduled respawn is already dispatched to the client');
    room.message('b', { type: 'respawned', pose: { p: [0, 0.92, 0], yaw: 0, pitch: 0 } }, endAt + ROUND.intermissionSeconds * 1000 + 1);
    assert.equal(b.alive, true);
    assert.equal(b.respawnAt, 0);
});

test('a golden-disc holder drops it on refresh and does not regain it', async () => {
    const { room, join, pose } = await harness(['solo']);
    join('a', 'solo', 0);
    pose('a', [4, 0.92, 6], 100);
    room.gold = { holder: 'a', at: [4, 0.92, 6] };
    room.disconnect('a', 1000);
    assert.equal(room.gold.holder, null);
    assert.deepEqual(room.gold.at, [4, 0.92, 6]);
    const welcome = join('b', 'solo', 2000);
    assert.equal(welcome.gold.holder, null);
    assert.deepEqual(welcome.gold.at, [4, 0.92, 6]);
    assert.equal(welcome.players.find((player) => player.id === 'b').alive, true);
    assert.equal(AMMO.start, 3);
});
