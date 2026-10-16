import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import { BREAKER_ROUTE } from '../src/config/breakerRoute.ts';
import { GUARD_ROUTE } from '../src/config/guardRoute.ts';
import { guardAt } from '../src/gameplay/guard.ts';
import {
    nearBreaker,
    powerOut,
    powerPhase,
    POWER_TRAVEL_MS,
    POWER_RESTORE_MS,
    POWER_RETURN_MS
} from '../src/gameplay/power.ts';
import { parseClientMessage, PROTOCOL_VERSION, ROUND } from '../src/net/protocol.ts';

const setup = () => {
    const messages = new Map();
    const room = new Room(
        {
            to: (id, m) => messages.get(id)?.push(m),
            all: (m) => {
                for (const list of messages.values()) list.push(m);
            },
            close: () => undefined
        },
        24
    );
    const join = (id, now = 0) => {
        messages.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id }, now);
    };
    const pose = (id, now, p = [...BREAKER_ROUTE.at(-1)]) =>
        room.message(id, { type: 'pose', pose: { p: [p[0], 0.92, p[1]], yaw: 0, pitch: 0 } }, now);
    const pull = (id, now) => room.message(id, { type: 'pullBreaker' }, now);
    return { room, messages, join, pose, pull };
};

test('breaker requires nearby fresh living player; the first claimant consumes the whole round allowance', () => {
    const { room, messages, join, pose, pull } = setup();
    join('a');
    join('b');
    assert.deepEqual(parseClientMessage('{"type":"pullBreaker"}'), { type: 'pullBreaker' });
    pull('a', 100);
    assert.equal(room.power.pulledAt, null);
    pose('a', 100, [0, 0]);
    pull('a', 110);
    assert.equal(room.power.pulledAt, null);
    pose('a', 100);
    pull('a', 1200);
    assert.equal(room.power.pulledAt, null, 'stale pose');
    pose('a', 1300);
    room.players.get('a').alive = false;
    pull('a', 1301);
    assert.equal(room.power.pulledAt, null, 'dead');
    room.players.get('a').alive = true;
    pull('a', 1302);
    assert.equal(room.power.pulledAt, 1302);
    pose('b', 1303);
    pull('b', 1304);
    assert.equal(room.power.pulledAt, 1302, 'shared race');
    assert.equal(messages.get('b').filter((m) => m.type === 'power' && m.power.pulledAt !== null).length, 1);
    join('c', 2000);
    assert.deepEqual(messages.get('c')[0].power, { pulledAt: 1302 }, 'late join retains blackout');
    pose('b', 1302 + POWER_RETURN_MS + 1);
    pull('b', 1302 + POWER_RETURN_MS + 2);
    assert.equal(room.power.pulledAt, 1302, 'restored does not replenish');
    room.tick(ROUND.roundSeconds * 1000 + 1);
    room.tick(ROUND.roundSeconds * 1000 + ROUND.intermissionSeconds * 1000 + 2);
    assert.equal(room.power.pulledAt, null, 'new round resets');
    pose('b', 610003);
    pull('b', 610004);
    assert.equal(room.power.pulledAt, 610004);
});

test('power is restored only after arrival and repair; guard returns to the original position continuously', () => {
    const start = 1000,
        power = { pulledAt: start };
    assert.equal(powerOut(start - 1, power), false);
    assert.equal(powerPhase(start, power), 'outbound');
    assert.equal(powerPhase(start + POWER_TRAVEL_MS, power), 'repairing');
    assert.equal(powerOut(start + POWER_RESTORE_MS - 1, power), true);
    assert.equal(powerOut(start + POWER_RESTORE_MS, power), false);
    assert.equal(powerPhase(start + POWER_RESTORE_MS, power), 'returning');
    const at = guardAt(start + POWER_TRAVEL_MS, null, power);
    assert.deepEqual([at.x, at.z], BREAKER_ROUTE.at(-1));
    assert.equal(at.walking, false);
    const after = guardAt(start + POWER_RETURN_MS + 1, null, power);
    assert.deepEqual([after.x, after.z], GUARD_ROUTE[0]);
    let previous = guardAt(start, null, power);
    for (let t = 10; t < POWER_RETURN_MS; t += 10) {
        const next = guardAt(start + t, null, power);
        assert.ok(Math.hypot(next.x - previous.x, next.z - previous.z) <= 0.0281, 'no jump or fast segment');
        previous = next;
    }
    const midnight = start + POWER_RESTORE_MS - 500;
    const resumed = guardAt(start + POWER_RETURN_MS + 1, midnight, power);
    assert.ok(
        Math.hypot(resumed.x - GUARD_ROUTE[0][0], resumed.z - GUARD_ROUTE[0][1]) < 0.01,
        'night patrol starts after return'
    );
    assert.equal(nearBreaker([BREAKER_ROUTE.at(-1)[0], 4, BREAKER_ROUTE.at(-1)[1]]), false);
});

test('manual outage does not enable final-night deaths; night and intermission reject pulls', () => {
    const { room, join, pose, pull } = setup();
    join('a');
    join('b');
    pose('a', 1000);
    pull('a', 1001);
    room.message('a', { type: 'spotted' }, 1002);
    assert.equal(room.players.get('a').alive, true);
    room.power = { pulledAt: null };
    const night = room.blackoutAt();
    pose('a', night);
    pull('a', night);
    assert.equal(room.power.pulledAt, null);
    room.tick(600001);
    pose('a', 600002);
    pull('a', 600003);
    assert.equal(room.power.pulledAt, null);
});
