import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import {
    canExecute,
    executionFrame,
    executionLineClear,
    EXECUTION,
    EXECUTION_TIMELINE
} from '../src/gameplay/execution.ts';
import { PROTOCOL_VERSION, ROUND, parseClientMessage } from '../src/net/protocol.ts';

const pose = (x = -44, yaw = 90, z = 39.6) => ({ p: [x, 0.92, z], yaw, pitch: 0 });
const harness = () => {
    const messages = new Map(),
        stats = new Map();
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
            to: (id, m) => messages.get(id)?.push(m),
            all: (m) => {
                for (const list of messages.values()) list.push(m);
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
    };
    const move = (id, p = pose(), now = 2000) => room.message(id, { type: 'pose', pose: p }, now);
    const execute = (a = 'a', b = 'b', now = 2001) => room.message(a, { type: 'execute', target: b }, now);
    join('a');
    join('b');
    join('c');
    move('a');
    move('b', pose(-45));
    move('c', pose(-43.8));
    return { room, messages, stats, join, move, execute };
};

test('rear proximity, facing, height and real campus occlusion gate execution', () => {
    assert.ok(canExecute(pose(), pose(-45)));
    assert.equal(canExecute(pose(), pose(-45, -90)), false, 'front');
    assert.equal(canExecute(pose(-42), pose(-45)), false, 'distance');
    assert.equal(canExecute({ ...pose(), p: [-44, 2, 39.6] }, pose(-45)), false, 'height');
    assert.equal(canExecute(pose(-44, -90), pose(-45)), false, 'attacker looks away');
    assert.equal(executionLineClear([22.5, 0.92, -3], [19.5, 0.92, -3]), false, 'actual source wall');
    assert.equal(executionLineClear([100, 0.92, 100], [101, 0.92, 100]), false);
    assert.equal(parseClientMessage('{"type":"execute","target":42}'), null);
    assert.deepEqual(parseClientMessage('{"type":"execute","target":"b"}'), { type: 'execute', target: 'b' });
});

test('server locks one pair, broadcasts one shared clock and settles only after the complete animation', () => {
    const { room, messages, stats, move, execute } = harness();
    execute();
    const entry = [...room.executions.values()][0];
    assert.ok(entry);
    assert.equal(entry.endsAt - entry.startsAt, EXECUTION.durationMs);
    assert.deepEqual(
        messages.get('a').find((m) => m.type === 'executionStarted'),
        messages.get('b').find((m) => m.type === 'executionStarted')
    );
    execute('c', 'b', 2002);
    assert.equal(room.executions.size, 1, 'target reservation');
    move('a', pose(-20), 2100);
    assert.equal(room.players.get('a').pose.p[0], -44, 'cannot move during animation');
    const ammo = room.players.get('a').ammo;
    room.message('a', { type: 'throw', throw: { id: 1, o: [-44, 1.2, 39.6], v: [-18, 0, 0], tilt: 0 } }, 2200);
    assert.equal(room.players.get('a').ammo, ammo);
    room.tick(entry.endsAt - 1);
    assert.equal(room.players.get('b').alive, true);
    assert.equal(room.players.get('a').kills, 0);
    room.tick(entry.endsAt);
    assert.equal(room.players.get('b').alive, false);
    assert.equal(room.players.get('b').spectating, true);
    assert.equal(room.players.get('a').kills, 1);
    assert.equal(stats.get('a').hits, 0, 'execution is not a disc hit');
    assert.equal(stats.get('a').kills, 1);
    assert.equal(stats.get('b').deaths, 1);
    room.message('b', { type: 'respawned', pose: pose(-45) }, entry.endsAt + 3000);
    room.tick(entry.endsAt + 4000);
    assert.equal(room.players.get('b').alive, false, 'no respawn even before night');
    room.tick(entry.endsAt + 8000);
    assert.equal(room.players.get('a').kills, 1, 'no duplicate settlement');
});

test('third-party hits and disconnects interrupt, restore both roles and award no execution kill', () => {
    const { room, messages, execute } = harness();
    execute();
    room.message('c', { type: 'throw', throw: { id: 2, o: [-43.8, 1.2, 39.6], v: [-18, 0, 0], tilt: 0 } }, 2200);
    room.message('c', { type: 'hit', throwId: 2, target: 'a', at: [-44, 1.1, 39.6] }, 2400);
    assert.equal(room.executions.size, 0);
    assert.equal(room.players.get('a').hp, 1);
    assert.equal(room.players.get('b').hp, 2);
    assert.ok(messages.get('b').some((m) => m.type === 'executionEnded' && !m.completed));
    execute('a', 'b', 2500);
    assert.equal(room.executions.size, 1);
    room.disconnect('a', 2600);
    assert.equal(room.executions.size, 0);
    room.tick(6000);
    assert.equal(room.players.get('b').alive, true);
});

test('executed accounts stay spectating after reconnect; new rounds reset them; protection and stale poses reject', () => {
    const { room, messages, join, move, execute } = harness();
    execute('a', 'b', 100);
    assert.equal(room.executions.size, 0, 'spawn protection');
    execute('a', 'b', 3500);
    assert.equal(room.executions.size, 0, 'stale poses');
    move('a', pose(), 3600);
    move('b', pose(-45), 3600);
    execute('a', 'b', 3601);
    const entry = [...room.executions.values()][0];
    room.tick(entry.endsAt);
    room.disconnect('b', entry.endsAt + 1);
    join('b2', 'b', entry.endsAt + 2);
    assert.equal(messages.get('b2')[0].players.find((p) => p.id === 'b2').spectating, true);
    room.tick(ROUND.roundSeconds * 1000 + 1);
    room.tick(ROUND.roundSeconds * 1000 + ROUND.intermissionSeconds * 1000 + 2);
    assert.equal(room.players.get('b2').spectating, false);
    move('b2', pose(-45), 610003);
    assert.equal(room.players.get('b2').alive, false, 'must acknowledge server respawn');
    room.message('b2', { type: 'respawned', pose: pose(-45) }, 610004);
    assert.equal(room.players.get('b2').alive, true);
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
    const { room, messages, move, execute } = harness();
    const attacker = near(2),
        target = near(1);
    move('a', attacker, 2000);
    move('b', target, 2000);
    execute('a', 'b', now);
    assert.equal(room.executions.size, 0);
    assert.ok(messages.get('a').some((m) => m.type === 'executionDenied' && m.reason.includes('纪老师')));
});

test('finisher clips: one swing whose middle lands on the impact, then a full, unclipped fall', async () => {
    const { finisherClips, finisherLingerMs, FINISHER_CLIPS } = await import('../src/gameplay/execution.ts');
    const D = EXECUTION.durationMs / 1000;
    const at = (u) => finisherClips(u, D);
    assert.equal(at(0.05).attacker.clip, 'Idle_Loop');
    const swing = [0.2, 0.44, 0.7].map((u) => at(u).attacker);
    assert.ok(swing.every((cue) => cue.clip === 'Sword_Attack' && cue.speed === swing[0].speed));
    // The swing reaches the end of its clip exactly when the recovery begins: never cut part-way.
    const last = finisherClips(EXECUTION_TIMELINE.recover - 1e-9, D).attacker;
    assert.ok(Math.abs(last.offset - FINISHER_CLIPS.Sword_Attack) < 1e-6);
    // Offsets advance with progress at the clip's speed (smooth for late joiners).
    const a = at(0.3).attacker,
        b = at(0.31).attacker;
    assert.ok(Math.abs(b.offset - a.offset - 0.01 * D * a.speed) < 1e-9);
    assert.equal(at(0.43).target.clip, 'Idle_Loop', 'the target does not react before the blow');
    assert.equal(at(0.45).target.clip, 'Hit_Chest');
    assert.equal(at(0.9).target.clip, 'Death01');
    // The fall finishes after the move; the remaining clip time is covered by the linger.
    const end = at(1).target;
    const remaining = (FINISHER_CLIPS.Death01 - end.offset) / end.speed;
    assert.ok(Math.abs(finisherLingerMs(D) / 1000 - remaining) < 1e-9);
    assert.ok(finisherLingerMs(D) > 0 && finisherLingerMs(D) < 1500);
});
