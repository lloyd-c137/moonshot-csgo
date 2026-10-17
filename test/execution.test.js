import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import {
    canExecute,
    canStartGlobalFinisher,
    executionFrame,
    executionLineClear,
    EXECUTION_TIMELINE
} from '../src/gameplay/execution.ts';
import { GLOBAL_FINISHER_CONFIG } from '../src/gameplay/finisher/FinisherTypes.ts';
import { PROTOCOL_VERSION, ROUND, parseClientMessage } from '../src/net/protocol.ts';

const pose = (x = -44, yaw = 90, z = 39.6) => ({ p: [x, 0.92, z], yaw, pitch: 0 });
const harness = () => {
    const messages = new Map();
    const stats = new Map();
    const account = (name) => ({
        name,
        kills: 0,
        deaths: 0,
        hits: 0,
        score: 0,
        wins: 0,
        rounds: 0,
        losses: 0,
        ...stats.get(name)
    });
    const room = new Room(
        {
            to: (id, message) => messages.get(id)?.push(message),
            all: (message) => {
                for (const list of messages.values()) list.push(message);
            },
            close: () => undefined
        },
        24,
        {
            resolve: (token) => (token ? account(token) : null),
            king: () => null,
            challenge: () => null,
            record: (name, delta) => {
                const result = account(name);
                for (const key in delta) result[key] += delta[key];
                stats.set(name, result);
                return result;
            }
        },
        () => 0
    );
    const join = (id, name = id, now = 0) => {
        messages.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name, token: name }, now);
        return messages.get(id).find((message) => message.type === 'welcome');
    };
    const move = (id, at = pose(), now = 2000) => room.message(id, { type: 'pose', pose: at }, now);
    const prepare = (id = 'a', target = 'b', requestId = `request-${id}`, now = 2001) =>
        room.message(id, { type: 'executionPrepare', target, requestId }, now);
    const commit = (id = 'a', requestId = `request-${id}`, now = 2401) =>
        room.message(id, { type: 'executionCommit', requestId }, now);
    join('a');
    join('b');
    join('c');
    move('a');
    move('b', pose(-45));
    move('c', pose(-43.8));
    return { room, messages, stats, join, move, prepare, commit };
};

test('GLOBAL FINISHER uses the specified distance, angle, height, occlusion and hold defaults', () => {
    assert.deepEqual(GLOBAL_FINISHER_CONFIG, {
        minDistance: 0.6,
        maxDistance: 1.3,
        maxHeightDifference: 0.4,
        rearHalfAngleDeg: 40,
        attackerFacingHalfAngleDeg: 35,
        holdDurationMs: 400,
        cinematicDurationMs: 2600,
        initialSyncLeadMs: 800,
        globalCooldownMs: 90000,
        maxPerPlayerPerRound: 1,
        maxPerRound: 4
    });
    assert.equal(canExecute(pose(), pose(-45)), true);
    assert.equal(canStartGlobalFinisher(pose(), pose(-45)), true);
    assert.equal(canStartGlobalFinisher(pose(-44.5), pose(-45)), false, 'too close');
    assert.equal(canStartGlobalFinisher(pose(-43.69), pose(-45)), false, 'too far');
    assert.equal(canStartGlobalFinisher(pose(), { ...pose(-45), p: [-45, 1.33, 39.6] }), false, 'height');
    assert.equal(canStartGlobalFinisher(pose(-44, -90), pose(-45)), false, 'attacker faces away');
    assert.equal(canStartGlobalFinisher(pose(), pose(-45, -90)), false, 'not behind target');
    assert.equal(executionLineClear([22.5, 0.92, -3], [19.5, 0.92, -3]), false, 'source wall blocks staging');
    assert.equal(
        parseClientMessage('{"type":"executionPrepare","target":"b","requestId":"x"}').type,
        'executionPrepare'
    );
    assert.equal(parseClientMessage('{"type":"executionCommit","requestId":"x"}').type, 'executionCommit');
    assert.equal(parseClientMessage('{"type":"execute","target":"b"}'), null, 'old bypass message removed');
});

test('server requires a prepared 400 ms hold, freezes every client mutation and settles once on shared end time', () => {
    const { room, messages, stats, join, move, prepare, commit } = harness();
    prepare('a', 'b', 'hold-a', 2001);
    assert.equal(messages.get('a').at(-1).type, 'executionPrepared');
    commit('a', 'hold-a', 2100);
    room.tick(2400);
    assert.equal(room.globalFinisher, null, 'commit cannot bypass the server hold timer');
    room.tick(2401);
    const finisher = room.globalFinisher;
    assert.ok(finisher);
    assert.equal(finisher.pauseAt, 2401);
    assert.equal(finisher.startsAt - finisher.pauseAt, GLOBAL_FINISHER_CONFIG.initialSyncLeadMs);
    assert.equal(finisher.endsAt - finisher.startsAt, GLOBAL_FINISHER_CONFIG.cinematicDurationMs);
    assert.equal(finisher.phase, 'pending');
    assert.deepEqual(
        messages.get('a').find((message) => message.type === 'globalFinisherStarted'),
        messages.get('c').find((message) => message.type === 'globalFinisherStarted')
    );

    const frozenPose = room.players.get('c').pose;
    room.message('c', { type: 'pose', pose: pose(-30) }, 2500);
    room.message('c', { type: 'throw', throw: { id: 1, o: [-43.8, 1.2, 39.6], v: [-18, 0, 0], tilt: 0 } }, 2501);
    room.message('c', { type: 'hit', throwId: 1, target: 'a', at: [-44, 1.1, 39.6] }, 2502);
    room.message('c', { type: 'landed', throwId: 1, at: [-43.8, 0.02, 39.6] }, 2503);
    room.message('c', { type: 'chat', text: 'should be dropped' }, 2504);
    room.message('c', { type: 'pullBreaker' }, 2505);
    room.message('c', { type: 'spotted' }, 2506);
    room.message('c', { type: 'executionPrepare', requestId: 'during', target: 'b' }, 2507);
    room.message('c', { type: 'ping', c: 10 }, 2508);
    assert.equal(room.players.get('c').pose, frozenPose);
    assert.equal(room.players.get('c').throws.size, 0);
    assert.equal(room.players.get('a').hp, 2);
    assert.equal(room.power.pulledAt, null);
    assert.equal(
        messages.get('c').filter((message) => message.type === 'chat' && message.line?.text === 'should be dropped')
            .length,
        0
    );
    assert.ok(messages.get('c').some((message) => message.type === 'pong'));
    room.tick(finisher.endsAt - 1);
    assert.equal(room.players.get('b').alive, true);
    room.tick(finisher.endsAt);
    assert.equal(room.globalFinisher, null);
    assert.equal(room.players.get('b').alive, false);
    assert.equal(room.players.get('b').spectating, true);
    assert.equal(room.players.get('a').kills, 1);
    assert.equal(stats.get('a').kills, 1);
    assert.equal(stats.get('a').hits, 0);
    assert.equal(stats.get('b').deaths, 1);
    room.tick(finisher.endsAt + 5000);
    assert.equal(room.players.get('a').kills, 1, 'duplicate completion cannot score twice');
    assert.equal(room.round.endsAt, ROUND.roundSeconds * 1000, 'match deadline is held in match-time domain');
    assert.equal(
        messages.get('a').filter((message) => message.type === 'globalFinisherCompleted' && message.id === finisher.id)
            .length,
        1
    );

    join('late', 'late', finisher.endsAt + 1);
    const lateWelcome = messages.get('late').find((message) => message.type === 'welcome');
    assert.equal(lateWelcome.globalFinisher, null);
    assert.equal(lateWelcome.matchTime, 2402, 'late join receives the paused/resumed match clock');
    move('c', pose(), finisher.endsAt + 2);
    move('a', pose(-45), finisher.endsAt + 2);
    prepare('c', 'a', 'cooldown', finisher.endsAt + 3);
    assert.ok(
        messages
            .get('c')
            .some(
                (message) =>
                    message.type === 'executionPrepareDenied' &&
                    message.requestId === 'cooldown' &&
                    /冷却/.test(message.reason)
            ),
        JSON.stringify(messages.get('c').slice(-5))
    );
});

test('welcome during the global lock reconstructs the same cinematic; participant disconnect cancels without elimination', () => {
    const { room, messages, join, move, prepare, commit } = harness();
    prepare('a', 'b', 'hold', 2001);
    commit('a', 'hold', 2401);
    const finisher = room.globalFinisher;
    assert.ok(finisher);
    const welcome = join('late', 'late', 2600);
    assert.equal(welcome.globalFinisher.id, finisher.id);
    assert.equal(welcome.globalFinisher.startsAt, finisher.startsAt);
    assert.equal(welcome.matchTime, 2401);
    move('late', pose(-60), 2700);
    assert.equal(room.players.get('late').pose, null, 'new player is connected but frozen during the film');
    room.disconnect('a', 2800);
    assert.equal(room.globalFinisher, null);
    assert.equal(room.players.get('b').alive, true);
    assert.equal(room.players.get('b').deaths, 0);
    assert.equal(room.players.get('b').kills, 0);
    assert.ok(
        messages.get('b').some((message) => message.type === 'globalFinisherCancelled' && message.id === finisher.id)
    );
    join('after', 'after', 2801);
    assert.equal(messages.get('after').find((message) => message.type === 'welcome').matchTime, 2402);
});

test('commit without prepare and cancelled preparation cannot start a global event', () => {
    const { room, messages, prepare, commit } = harness();
    commit('a', 'forged', 9999);
    assert.ok(
        messages.get('a').some((message) => message.type === 'executionPrepareDenied' && /失效/.test(message.reason))
    );
    prepare('a', 'b', 'released', 2001);
    room.message('a', { type: 'executionCancel', requestId: 'released' }, 2100);
    commit('a', 'released', 2401);
    room.tick(3000);
    assert.equal(room.globalFinisher, null);
    assert.equal(room.players.get('a').ammo, room.startAmmo);
});

test('the finisher timeline runs approach → grab → strike → fall → recover, with one impact moment', () => {
    const phases = [];
    let impactAt = null;
    for (let t = 0; t <= 1.0001; t += 0.01) {
        const frame = executionFrame(t);
        if (phases.at(-1) !== frame.phase) phases.push(frame.phase);
        if (frame.impact && impactAt === null) impactAt = t;
        assert.ok(Object.values(frame).every((v) => typeof v !== 'number' || Number.isFinite(v)));
    }
    assert.deepEqual(phases, ['approach', 'grab', 'strike', 'fall', 'recover']);
    assert.ok(Math.abs(impactAt - EXECUTION_TIMELINE.impact) < 0.011);
    assert.equal(executionFrame(EXECUTION_TIMELINE.impact - 0.001).fall, 0, 'no fall before the blow');
    const end = executionFrame(1);
    assert.equal(end.fall, 1);
    assert.equal(end.recover, 1);
    assert.equal(end.close, 1);
});

test('no execution inside 纪老师 watch circle (owner rule), on the client gate and in the room', async () => {
    const { teacherAt, TEACHER } = await import('../src/gameplay/teacher.ts');
    const { executionWatched } = await import('../src/gameplay/execution.ts');
    const now = 2001;
    const teacher = teacherAt(now);
    const near = (dx) => ({ p: [teacher.x + dx, 0.92, teacher.z], yaw: 90, pitch: 0 });
    assert.equal(executionWatched(now, near(3), near(2)), true);
    const far = TEACHER.range + 5;
    assert.equal(executionWatched(now, near(far + 1), near(far)), false);
    // In the room: an otherwise valid pair placed in his circle is refused with a reason; nothing starts.
    const { room, messages, move, prepare } = harness();
    move('a', near(2), 2000);
    move('b', { ...near(1), yaw: 90 }, 2000);
    prepare('a', 'b', 'request-a', now);
    assert.equal(room.executions.size, 0);
    assert.ok(
        messages.get('a').some((m) => m.type === 'executionPrepareDenied' && m.reason.includes('纪老师')),
        'refused because of 纪老师'
    );
});
