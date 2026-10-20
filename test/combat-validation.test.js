import assert from 'node:assert/strict';
import test from 'node:test';

import {
    contactNearCapsule,
    flightClear,
    implausibleMove,
    judgeHit,
    LAG_ALLOWANCE,
    MAX_REWIND,
    PoseHistory,
    rewindTime
} from '../server/combatValidation.ts';
import { Room } from '../server/room.ts';
import { RENDER_DELAY } from '../src/net/interpolation.ts';
import { parseClientMessage, PROTOCOL_VERSION, ROUND } from '../src/net/protocol.ts';

const at = (x, y = 0.92, z = -3) => ({ p: [x, y, z], yaw: 0, pitch: 0 });

test('pose history interpolates, clamps to its ends and forgets across teleports', () => {
    const history = new PoseHistory();
    history.push(1000, at(0));
    history.push(1100, at(1));
    assert.deepEqual(history.at(1050), [0.5, 0.92, -3]);
    assert.deepEqual(history.at(500), [0, 0.92, -3]);
    assert.deepEqual(history.at(5000), [1, 0.92, -3]);
    history.push(1100, at(9));
    assert.deepEqual(history.at(1100), [1, 0.92, -3], 'out-of-order samples are ignored');
    history.reset(1200, at(40));
    assert.deepEqual(history.at(1050), [40, 0.92, -3], 'no rewind across a teleport');
});

test('pose history keeps stance discrete at the accepted pose timestamp', () => {
    const history = new PoseHistory();
    history.push(1000, { ...at(0), crouched: false });
    history.push(1100, { ...at(0, 0.62), crouched: true });
    assert.equal(history.atPose(1099)?.crouched, false);
    assert.equal(history.atPose(1100)?.crouched, true);
    assert.deepEqual(history.atPose(1050)?.p, [0, 0.77, -3]);
});

test('hit judgement uses the target stance at the rewound hit time', () => {
    const history = new PoseHistory();
    history.push(1000, { ...at(0, 0.92, 0), crouched: false });
    history.push(1100, { ...at(0, 0.62, 0), crouched: true });
    const options = {
        history,
        now: 1200,
        claimedTime: 1100,
        origin: [-1, 1.5, 0],
        contact: [0, 1.3, 0],
        bounces: [],
        reach: 3
    };
    assert.equal(judgeHit(options).ok, true);
    assert.equal(judgeHit({ ...options, claimedTime: 1050 }).head, false, 'the crouched-height contact is body height at the earlier standing stance');
    assert.equal(judgeHit(options).head, true, 'the crouched head band is evaluated at the historical stance');
});

test('rewind uses the claimed view time, defaults to the render delay and is capped at 200 ms of lag', () => {
    assert.equal(MAX_REWIND, RENDER_DELAY + LAG_ALLOWANCE);
    assert.equal(LAG_ALLOWANCE, 200);
    assert.equal(rewindTime(10_000, 9_800), 9_800);
    assert.equal(rewindTime(10_000, undefined), 10_000 - RENDER_DELAY);
    assert.equal(rewindTime(10_000, 9_000), 10_000 - MAX_REWIND, 'older views are judged at the cap');
    assert.equal(rewindTime(10_000, 12_000), 10_000, 'never in the future');
});

test('contacts must touch the rewound capsule, not merely come within metres of it', () => {
    assert.ok(contactNearCapsule([0.8, 1, 0], [0, 0.92, 0]));
    assert.equal(contactNearCapsule([2, 1, 0], [0, 0.92, 0]), false, 'the old 3.5 m slack accepted this');
    assert.ok(contactNearCapsule([0, 2.2, 0], [0, 0.92, 0]), 'top of the head');
    assert.equal(contactNearCapsule([0, 3, 0], [0, 0.92, 0]), false);
});

test('a moving target is judged where the thrower saw it; beyond the cap the claim fails', () => {
    const history = new PoseHistory();
    // Target strafes 6 m/s across the arena; samples every 50 ms from t = 10 000.
    for (let t = 10_000; t <= 10_600; t += 50) history.push(t, at(-4 + ((t - 10_000) / 1000) * 6));
    const claim = (seenAt, contactX) =>
        judgeHit({
            history,
            now: 10_600,
            claimedTime: seenAt,
            origin: [-18, 1.5, -3],
            contact: [contactX, 1.2, -3],
            bounces: [],
            reach: 40
        });
    // Seen at 10 400 (200 ms back): the target was at -4 + 2.4 = -1.6.
    assert.equal(claim(10_400, -1.6).ok, true);
    // Judged at the target's present position instead, this contact is 1.2 m off: it would have been unfair.
    assert.equal(contactNearCapsule([-1.6, 1.2, -3], history.at(10_600)), false);
    // Claiming a view from 600 ms ago is clamped to 350 ms: the target was elsewhere.
    assert.deepEqual(claim(10_000, -4), { ok: false, reason: 'contact' });
});

test('head or body is decided against the rewound height (a target that jumped afterwards)', () => {
    const history = new PoseHistory();
    history.push(1000, at(0));
    history.push(1050, at(0));
    history.push(1200, at(0, 1.9));
    const judge = (seenAt) =>
        judgeHit({
            history,
            now: 1200,
            claimedTime: seenAt,
            origin: [-10, 1.6, -3],
            contact: [-0.3, 1.7, -3],
            bounces: [],
            reach: 30
        });
    const seen = judge(1050);
    assert.deepEqual([seen.ok, seen.head, seen.centre], [true, true, [0, 0.92, -3]]);
    const present = judge(1200);
    assert.equal(present.ok && present.head, false, 'at the present height the same contact is no head hit');
});

test('flights through real campus walls are rejected; open and banked flights pass', () => {
    assert.equal(
        flightClear([
            [22.5, 0.9, -3],
            [19.5, 0.9, -3]
        ]),
        false,
        'source wall'
    );
    assert.equal(
        flightClear([
            [-18, 1.5, -3],
            [2, 1.7, -3]
        ]),
        true,
        'open arena'
    );
    assert.equal(
        flightClear([
            [-18, 1.5, -3],
            [-8, 1.5, -10],
            [2, 1.6, -3]
        ]),
        true,
        'reported bounce path'
    );
    const history = new PoseHistory();
    history.push(0, at(19.5, 0.92, -3));
    assert.deepEqual(
        judgeHit({
            history,
            now: 100,
            claimedTime: 0,
            origin: [22.5, 1.5, -3],
            contact: [19.8, 1.2, -3],
            bounces: [],
            reach: 30
        }),
        { ok: false, reason: 'wall' }
    );
    assert.deepEqual(
        judgeHit({
            history: (() => {
                const h = new PoseHistory();
                h.push(0, at(2));
                return h;
            })(),
            now: 100,
            claimedTime: 0,
            origin: [-18, 1.5, -3],
            contact: [1.7, 1.2, -3],
            bounces: [],
            reach: 12
        }),
        { ok: false, reason: 'reach' },
        'a 20 m flight cannot be claimed for a 12 m reach'
    );
});

test('implausible moves are detected (log-only); in-game teleports reset history instead', () => {
    assert.equal(implausibleMove(null, 0, [0, 0, 0]), false);
    assert.equal(implausibleMove({ t: 0, p: [0, 0.92, 0] }, 50, [1, 0.92, 0]), false, 'sprint step');
    assert.equal(implausibleMove({ t: 0, p: [0, 0.92, 0] }, 50, [10, 0.92, 0]), true, 'teleport');
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, m) => inbox.get(id)?.push(m),
            all: (m) => {
                for (const list of inbox.values()) list.push(m);
            },
            close: () => undefined
        },
        24
    );
    inbox.set('a', []);
    room.connect('a');
    room.message('a', { type: 'hello', version: PROTOCOL_VERSION, name: 'A' }, 0);
    const warn = console.warn;
    console.warn = () => undefined;
    try {
        room.message('a', { type: 'pose', pose: at(0) }, 1000);
        room.message('a', { type: 'pose', pose: at(30), tp: true }, 1050);
        assert.equal(room.players.get('a').suspiciousMoves, 0, 'a flagged teleport is not suspicious');
        room.message('a', { type: 'pose', pose: at(60) }, 1100);
        assert.equal(room.players.get('a').suspiciousMoves, 1);
        assert.deepEqual(room.players.get('a').pose.p, [60, 0.92, -3], 'log-only: the move is not reverted');
    } finally {
        console.warn = warn;
    }
});

test('throws and hit claims outside a playing round are refused', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, m) => inbox.get(id)?.push(m),
            all: (m, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(m);
            },
            close: () => undefined
        },
        24
    );
    room.startAmmo = 9;
    for (const id of ['a', 'b']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id }, 0);
    }
    room.message('a', { type: 'pose', pose: at(-18) }, 3000);
    room.message('b', { type: 'pose', pose: at(2) }, 3000);
    room.message('a', { type: 'throw', throw: { id: 1, o: [-18, 1.5, -3], v: [20, 0, 0], tilt: 0 } }, 4000);
    room.tick(ROUND.roundSeconds * 1000 + 1);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [2, 1.2, -3] }, ROUND.roundSeconds * 1000 + 50);
    assert.ok(inbox.get('a').some((m) => m.type === 'hitRejected' && m.throwId === 1));
    const ammo = room.players.get('a').ammo;
    room.message(
        'a',
        { type: 'throw', throw: { id: 2, o: [-18, 1.5, -3], v: [20, 0, 0], tilt: 0 } },
        ROUND.roundSeconds * 1000 + 900
    );
    assert.equal(room.players.get('a').ammo, ammo, 'intermission throws spend nothing and are not recorded');
    assert.equal(room.players.get('a').throws.has(2), false);
});

test('hit claims carry an optional view time and a short bounce path', () => {
    assert.deepEqual(
        parseClientMessage('{"type":"hit","throwId":1,"target":"b","at":[0,1,0],"rt":5,"path":[[1,1,1]]}'),
        { type: 'hit', throwId: 1, target: 'b', at: [0, 1, 0], rt: 5, path: [[1, 1, 1]] }
    );
    assert.equal(parseClientMessage('{"type":"hit","throwId":1,"target":"b","at":[0,1,0],"rt":"x"}'), null);
    const long = JSON.stringify(Array.from({ length: 9 }, () => [0, 0, 0]));
    assert.equal(parseClientMessage(`{"type":"hit","throwId":1,"target":"b","at":[0,1,0],"path":${long}}`), null);
    assert.equal(parseClientMessage('{"type":"pose","pose":{"p":[0,1,0],"yaw":0,"pitch":0},"tp":1}'), null);
});

test('eliminated spectators chat among themselves while the round plays; everyone hears them between rounds', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, m) => inbox.get(id)?.push(m),
            all: (m, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(m);
            },
            close: () => undefined
        },
        24
    );
    for (const id of ['alive', 'dead1', 'dead2']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id }, 0);
    }
    room.players.get('dead1').spectating = true;
    room.players.get('dead2').spectating = true;
    const lines = (id) =>
        inbox
            .get(id)
            .filter((m) => m.type === 'chat')
            .map((m) => [m.line.text, !!m.line.dead]);
    room.message('dead1', { type: 'chat', text: '他在S308' }, 1000);
    assert.deepEqual(lines('alive'), [], 'the living never see dead chat');
    assert.deepEqual(lines('dead2'), [['他在S308', true]]);
    assert.deepEqual(lines('dead1'), [['他在S308', true]], 'the sender sees their own line');
    room.message('alive', { type: 'chat', text: '加油' }, 1100);
    assert.deepEqual(lines('dead2').at(-1), ['加油', false], 'spectators still read the living');
    room.tick(ROUND.roundSeconds * 1000 + 1);
    room.message('dead1', { type: 'chat', text: 'gg' }, ROUND.roundSeconds * 1000 + 100);
    assert.deepEqual(lines('alive').at(-1), ['gg', false], 'after the round everyone talks again');
});

test('lag-compensation history keeps the real room clock across a global-finisher pause', () => {
    const inbox = new Map();
    const room = new Room(
        {
            to: (id, m) => inbox.get(id)?.push(m),
            all: (m, except) => {
                for (const [id, list] of inbox) if (id !== except) list.push(m);
            },
            close: () => undefined
        },
        24
    );
    room.startAmmo = 9;
    for (const id of ['a', 'b']) {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: id }, 0);
    }
    // Pretend a 3 s finisher pause already happened: the match clock now trails the real clock by 3 s.
    room.matchClockOffset = 3000;
    room.message('a', { type: 'pose', pose: at(-18) }, 10_000);
    room.message('b', { type: 'pose', pose: at(2) }, 10_000);
    room.message('b', { type: 'pose', pose: at(2) }, 10_050);
    room.message('a', { type: 'throw', throw: { id: 1, o: [-18, 1.5, -3], v: [20, 0, 0], tilt: 0 } }, 10_100);
    // The client claims the real room time it saw (snapshot clock), as it does in play.
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [1.7, 1.2, -3], rt: 10_000 }, 10_900);
    assert.ok(
        inbox.get('b').some((m) => m.type === 'struck'),
        'judged on the same clock the client reports'
    );
});

test('bank shots and long shots are recognised from the reported flight', async () => {
    const { wallBounces } = await import('../server/combatValidation.ts');
    assert.equal(wallBounces([[-8, 0.1, -10]]), 0, 'a floor skid is not a bank shot');
    assert.equal(wallBounces([[-8, 1.2, -10]]), 1);
    const history = new PoseHistory();
    history.push(0, at(2));
    const verdict = (bounces) =>
        judgeHit({
            history,
            now: 100,
            claimedTime: 0,
            origin: [-18, 1.5, -3],
            contact: [1.7, 1.2, -3],
            bounces,
            reach: 60
        });
    const straight = verdict([]);
    assert.equal(straight.ok && straight.bank, false);
    assert.ok(straight.ok && Math.abs(straight.range - 19.7) < 0.2);
    const banked = verdict([[-8, 1.3, -10]]);
    assert.equal(banked.ok && banked.bank, true);
    assert.ok(banked.ok && banked.range > straight.range, 'range follows the bounce path');
});
