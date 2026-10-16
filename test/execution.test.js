import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import { canExecute, executionFrame, executionLineClear, EXECUTION } from '../src/gameplay/execution.ts';
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

test('paired action samples change both characters and finish in a readable defeated pose', () => {
    const initial = executionFrame(0),
        reach = executionFrame(0.25),
        strike = executionFrame(0.5),
        end = executionFrame(1);
    assert.notEqual(initial.attackerArm, reach.attackerArm);
    assert.notEqual(reach.attackerArm, strike.attackerArm);
    assert.ok(end.targetLean > 70);
    assert.equal(end.fall, 1);
    assert.equal(end.recover, 1);
    for (let t = 0; t <= 1; t += 0.01)
        assert.ok(Object.values(executionFrame(t)).every((v) => typeof v === 'boolean' || Number.isFinite(v)));
});
