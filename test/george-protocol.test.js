import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import { GEORGE_TERMINAL } from '../src/config/george.ts';
import { parseClientMessage, PROTOCOL_VERSION, RESPAWN_SECONDS } from '../src/net/protocol.ts';

const makeRoom = () => {
    const inbox = new Map();
    const closed = new Set();
    const room = new Room({
        to: (id, message) => inbox.get(id)?.push(message),
        all: (message, except) => { for (const [id, list] of inbox) if (id !== except) list.push(message); },
        close: (id) => closed.add(id)
    }, 24);
    room.startAmmo = 30;
    const join = (id, now = 0, name = id) => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name }, now);
    };
    const pose = (id, p, now) => room.message(id, { type: 'pose', pose: { p, yaw: 0, pitch: 0 }, tp: true }, now);
    return { room, inbox, closed, join, pose };
};

const killTenThroughRoom = ({ room, join, pose }) => {
    join('attacker', 0, 'Attacker');
    join('target', 0, 'Target');
    const attacker = room.players.get('attacker');
    attacker.ammo = 30; // Isolated fixture setup; every elimination still passes the real throw/hit validator.
    for (let index = 0; index < 10; index++) {
        const at = 2_000 + index * 5_000;
        pose('attacker', [0, 0.9, 0], at - 1);
        pose('target', [8, 0.9, 0], at - 1);
        room.players.get('target').hp = 1; // Prepare a one-hit target without bypassing the lethal hit path.
        const throwId = index + 1;
        room.message('attacker', { type: 'throw', throw: { id: throwId, o: [0.3, 1.5, 0], v: [18, 1, 0], tilt: 0 } }, at);
        room.message('attacker', { type: 'hit', throwId, target: 'target', at: [8, 1.2, 0] }, at + 500);
        if (index < 9) {
            const respawnAt = at + 500 + RESPAWN_SECONDS * 1000 + 5;
            room.tick(respawnAt);
            room.message('target', { type: 'respawned', pose: { p: [8, 0.9, 0], yaw: 0, pitch: 0 } }, respawnAt + 1);
        }
    }
    return { attacker, now: 2_000 + 9 * 5_000 + 500 };
};

test('George protocol inputs validate six-digit credentials and bounded request ids', () => {
    assert.ok(parseClientMessage(JSON.stringify({ type: 'georgeLogin', requestId: 'a', code: '012345' })));
    assert.equal(parseClientMessage(JSON.stringify({ type: 'georgeLogin', requestId: 'a', code: '12345x' })), null);
    assert.equal(parseClientMessage(JSON.stringify({ type: 'georgeStart', requestId: 'x'.repeat(81) })), null);
});

test('ten genuine lethal Room hits issue one private six-digit credential and absolute progress', () => {
    const context = makeRoom();
    const { attacker } = killTenThroughRoom(context);
    const own = context.inbox.get('attacker');
    const other = context.inbox.get('target');
    const credentialMessage = own.find((message) => message.type === 'georgeCredential' && message.credential);
    assert.match(credentialMessage.credential.code, /^\d{6}$/);
    assert.equal(attacker.georgeStreak, 10);
    assert.equal(attacker.georgeIssued, true);
    assert.deepEqual(own.filter((message) => message.type === 'georgeProgress').at(-1).progress, {
        streak: 10, required: 10, unlocked: true, issuedThisRound: true, credentialAvailable: true
    });
    assert.equal(other.some((message) => message.type === 'georgeCredential' && message.credential?.code === credentialMessage.credential.code), false);
    assert.equal(other.filter((message) => message.type === 'georgeSecurityAlert').length, 1);

});

test('a real lethal hit resets the victim streak and revokes their issued credential', () => {
    const context = makeRoom();
    context.join('a', 0, 'A');
    context.join('b', 0, 'B');
    const victim = context.room.players.get('a');
    victim.georgeStreak = 10;
    victim.georgeIssued = true;
    victim.georgeCredential = { id: 'fixture-credential', code: '004201', status: 'available' };
    victim.hp = 1;
    context.pose('a', [0, 0.9, 0], 2_000);
    context.pose('b', [8, 0.9, 0], 2_000);
    context.room.message('b', { type: 'throw', throw: { id: 1, o: [8, 1.5, 0], v: [-18, 1, 0], tilt: 0 } }, 2_001);
    context.room.message('b', { type: 'hit', throwId: 1, target: 'a', at: [0, 1.2, 0] }, 2_501);
    assert.equal(victim.alive, false);
    assert.equal(victim.georgeStreak, 0);
    assert.equal(victim.georgeCredential, null);
    assert.equal(victim.georgeIssued, true, 'the one-per-round issuance entitlement remains spent');
});

test('revive armor prevents death and preserves George streak progress', () => {
    const context = makeRoom();
    context.join('a', 0, 'A');
    context.join('b', 0, 'B');
    const target = context.room.players.get('b');
    target.hp = 1;
    target.hasReviveArmor = true;
    target.georgeStreak = 7;
    context.pose('a', [0, 0.9, 0], 2_000);
    context.pose('b', [8, 0.9, 0], 2_000);
    context.room.message('a', { type: 'throw', throw: { id: 1, o: [0.3, 1.5, 0], v: [18, 1, 0], tilt: 0 } }, 2_001);
    context.room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [8, 1.2, 0] }, 2_501);
    assert.equal(target.alive, true);
    assert.equal(target.georgeStreak, 7);
    assert.equal(context.inbox.get('b').some((message) => message.type === 'georgeCredential' && message.credential), false);
});

test('password authentication is owner- and terminal-bound; server reboot countdown can be held-aborted once', () => {
    const context = makeRoom();
    const { attacker, now } = killTenThroughRoom(context);
    const code = attacker.georgeCredential.code;
    const terminal = [GEORGE_TERMINAL.x, GEORGE_TERMINAL.y, GEORGE_TERMINAL.z];
    context.pose('attacker', terminal, now + 1);
    context.join('defender', now + 1, 'Defender');
    context.pose('defender', terminal, now + 1);
    assert.equal(attacker.phase, 'playing');
    assert.equal(context.room.round.phase, 'playing');
    assert.deepEqual(attacker.pose.p, terminal);
    assert.equal(now + 2 - attacker.poseAt, 1);
    context.room.message('attacker', { type: 'georgeLogin', requestId: 'bad', code: '111111' }, now + 2);
    assert.equal(context.inbox.get('attacker').filter((message) => message.type === 'georgeResult').at(-1).result, 'denied');
    context.room.message('defender', { type: 'georgeLogin', requestId: 'theft', code }, now + 700);
    assert.equal(context.inbox.get('defender').filter((message) => message.type === 'georgeResult').at(-1).result, 'denied');
    context.pose('attacker', terminal, now + 1_299);
    context.room.message('attacker', { type: 'georgeLogin', requestId: 'good', code }, now + 1_300);
    assert.equal(context.inbox.get('attacker').filter((message) => message.type === 'georgeResult').at(-1).result, 'granted');
    context.room.message('attacker', { type: 'georgeStart', requestId: 'start' }, now + 1_301);
    assert.equal(context.room.georgeReboot.phase, 'pending');
    const reboot = context.room.georgeReboot;
    assert.equal(reboot.endsAt - reboot.startsAt, GEORGE_TERMINAL.rebootMs);
    assert.ok(context.inbox.get('target').some((message) => message.type === 'georgeReboot' && message.state.phase === 'pending'));
    assert.equal(attacker.georgeCredential.status, 'used');

    context.pose('defender', terminal, now + 1_599);
    context.room.message('defender', { type: 'georgeDisarmBegin', requestId: 'hold-start' }, now + 1_600);
    assert.equal(context.room.georgeReboot.disarmerId, 'defender');
    for (let step = 1; step <= 12; step++) {
        context.pose('defender', terminal, now + 1_600 + step * 150 - 1);
        context.room.message('defender', { type: 'georgeDisarmBegin', requestId: `hold-${step}` }, now + 1_600 + step * 150);
    }
    context.room.tick(now + 3_599);
    assert.equal(context.room.georgeReboot.phase, 'pending', 'less than two seconds cannot abort');
    context.pose('defender', terminal, now + 3_549);
    context.room.message('defender', { type: 'georgeDisarmBegin', requestId: 'hold-13' }, now + 3_550);
    context.room.tick(now + 3_600);
    assert.equal(context.room.georgeReboot.phase, 'resolved');
    assert.equal(context.room.georgeReboot.outcome, 'aborted');
    assert.ok(context.room.round.endsAt > reboot.endsAt, 'ordinary round time resumes with the paused duration restored');
    context.room.message('attacker', { type: 'georgeStart', requestId: 'duplicate-start' }, now + 3_500);
    assert.equal(context.room.georgeReboot.outcome, 'aborted');
});

test('George shutdown is a simulated round outcome and settles only once without adding eliminations', () => {
    const context = makeRoom();
    context.join('a', 0, 'A');
    context.join('b', 0, 'B');
    const a = context.room.players.get('a');
    a.georgeStreak = 10;
    a.georgeIssued = true;
    a.georgeCredential = { id: 'fixture-credential', code: '004201', status: 'available' };
    const terminal = [GEORGE_TERMINAL.x, GEORGE_TERMINAL.y, GEORGE_TERMINAL.z];
    context.pose('a', terminal, 10_000);
    context.room.message('a', { type: 'georgeLogin', requestId: 'login', code: '004201' }, 10_001);
    context.room.message('a', { type: 'georgeStart', requestId: 'start' }, 10_002);
    const state = context.room.georgeReboot;
    context.room.tick(state.endsAt);
    assert.equal(context.room.georgeReboot.phase, 'shutdown');
    assert.equal(context.inbox.get('b').filter((message) => message.type === 'georgeShutdown').length, 1);
    context.room.tick(state.endsAt + 1_800);
    assert.equal(context.room.round.phase, 'ended');
    assert.equal(context.room.round.outcome, 'george-reboot');
    assert.equal(context.room.round.winnerId, 'a');
    assert.equal(context.room.players.get('a').kills, 0);
    assert.equal(context.room.players.get('b').kills, 0);
    context.room.tick(state.endsAt + 5_000);
    assert.equal(context.inbox.get('b').filter((message) => message.type === 'georgeShutdown').length, 1);
});

test('the initiating account keeps ownership and victory after reconnecting during reboot', () => {
    const inbox = new Map();
    const accounts = {
        resolve: (token) => token ? { name: token } : null,
        king: () => null,
        record: () => null
    };
    const room = new Room({
        to: (id, message) => inbox.get(id)?.push(message),
        all: (message) => { for (const messages of inbox.values()) messages.push(message); },
        close: () => { /* no-op transport for this isolated Room test */ }
    }, 24, accounts);
    room.startAmmo = 9;
    const join = (id, token, now) => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: token, token, phase: 'playing' }, now);
    };
    join('owner-old', 'owner', 0);
    join('defender', 'defender', 0);
    const owner = room.players.get('owner-old');
    owner.georgeStreak = 10;
    owner.georgeIssued = true;
    owner.georgeCredential = { id: 'credential', code: '012345', status: 'available' };
    const terminal = [GEORGE_TERMINAL.x, GEORGE_TERMINAL.y, GEORGE_TERMINAL.z];
    room.message('owner-old', { type: 'pose', pose: { p: terminal, yaw: 0, pitch: 0 } }, 5_000);
    room.message('owner-old', { type: 'georgeLogin', requestId: 'login', code: '012345' }, 5_001);
    room.message('owner-old', { type: 'georgeStart', requestId: 'start' }, 5_002);
    room.disconnect('owner-old', 5_100);
    join('owner-new', 'owner', 5_200);
    room.message('owner-new', { type: 'pose', pose: { p: terminal, yaw: 0, pitch: 0 } }, 5_201);
    assert.equal(room.georgeReboot.initiatorId, 'owner-new');
    room.message('defender', { type: 'georgeDisarmBegin', requestId: 'owner-cannot-disarm' }, 5_202);
    assert.equal(room.georgeReboot.disarmerId, null);
    room.tick(room.georgeReboot.endsAt);
    room.tick(room.georgeReboot.resolvedAt + 1_800);
    assert.equal(room.round.outcome, 'george-reboot');
    assert.equal(room.round.winnerId, 'owner-new');
});
