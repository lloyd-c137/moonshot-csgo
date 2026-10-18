import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import { SOUTH_GATE } from '../src/config/gameplay.ts';
import { ITEM_RULES, ITEM_SPAWNS, NPC_SPAWNS } from '../src/config/gameplayItems.ts';
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
    const join = (id, name, now = 0, phase = 'playing') => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name, phase }, now);
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

test('three body hits eliminate (one per disc), scoring one point for the elimination, then respawn at full health', () => {
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
    assert.deepEqual([struck.length, struck[0].hp, struck[0].out, struck[0].scores.a], [1, 2, false, [0, 0, 0]]);
    assert.equal(struck[0].throwId, 1);
    // The same disc cannot score twice.
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [8, 1.2, 0] }, 1600);
    assert.equal(inbox.get('b').filter((message) => message.type === 'struck').length, 1);
    assert.ok(inbox.get('a').some((message) => message.type === 'hitRejected' && message.throwId === 1));
    throwAndHit(2, 2000);
    struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual([struck[1].hp, struck[1].out], [1, false]);
    throwAndHit(3, 3000);
    struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual(
        [struck[2].hp, struck[2].out, struck[2].scores.a, struck[2].scores.b],
        [0, true, [1, 1, 0], [0, 0, 1]]
    );
    // Eliminated players cannot be hit again.
    throwAndHit(4, 4000);
    assert.equal(inbox.get('b').filter((message) => message.type === 'struck').length, 3);
    room.tick(3500 + RESPAWN_SECONDS * 1000 + 10);
    const respawn = inbox.get('b').find((message) => message.type === 'respawn');
    assert.equal(respawn.id, 'b');
    assert.ok(respawn.spawn >= 0 && respawn.spawn < 24);
    room.message('b', { type: 'respawned', pose: { p: [1, 0.9, 1], yaw: 0, pitch: 0 } }, 7000);
    assert.deepEqual([room.players.get('b').alive, room.players.get('b').hp], [true, MAX_HP]);
});

test('a lethal hit during a manual breaker outage sends the target to spectating without a respawn', () => {
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
    assert.equal(room.players.get('b').hp, MAX_HP - 1);

    // Pulled a while ago (past the breaker cutscene, during which nobody can be hit), the outage still on.
    room.power = { pulledAt: 2000 - ROUND.breakerCutsceneSeconds * 1000 - 200 };
    throwAndHit(2, 2000);
    assert.equal(room.players.get('b').hp, MAX_HP - 2);
    throwAndHit(3, 3000);

    const target = room.players.get('b');
    const elimination = inbox.get('b').filter((message) => message.type === 'struck').at(-1);
    assert.equal(target.alive, false);
    assert.equal(target.spectating, true);
    assert.equal(target.respawnAt, 0);
    assert.equal(elimination.final, true);

    room.tick(2000 + RESPAWN_SECONDS * 1000 + 1);
    assert.equal(inbox.get('b').some((message) => message.type === 'respawn'), false);
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

test('three-point health takes three ordinary body hits while a head hit remains immediately lethal', () => {
    const { room, join, pose } = harness();
    join('a', 'A');
    join('b', 'B');
    pose('a', [0, 0.9, 0], 0);
    pose('b', [6, 0.9, 0], 0);
    assert.equal(room.players.get('b').hp, 3);

    for (const [id, at] of [[1, 3000], [2, 4000]]) {
        room.message('a', { type: 'throw', throw: { id, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, at);
        room.message('a', { type: 'hit', throwId: id, target: 'b', at: [6, 1, 0] }, at + 400);
        assert.equal(room.players.get('b').hp, 3 - id);
        assert.equal(room.players.get('b').alive, true);
    }

    room.message('a', { type: 'throw', throw: { id: 3, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, 5000);
    room.message('a', { type: 'hit', throwId: 3, target: 'b', at: [6, 1, 0] }, 5400);
    assert.equal(room.players.get('b').hp, 0);
    assert.equal(room.players.get('b').spectating, false, 'ordinary elimination respawns after the delay');
});

test('item pickups are server-authoritative, bounded to the room point, and the revive armor prevents one lethal hit', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    const revive = ITEM_SPAWNS.find((item) => item.kind === 'revive');
    pose('a', [revive.at[0] - 8, 0.92, revive.at[2]], 3000);
    pose('b', [revive.at[0], 0.92, revive.at[2]], 3000);
    room.message('b', { type: 'interact', target: revive.id }, 3300);
    assert.equal(room.players.get('b').hasReviveArmor, true);
    assert.equal(room.items.get(revive.id).available, false);
    room.players.get('b').hp = 1;
    // Move both players to a known unobstructed test lane after pickup, then exercise the real hit path.
    pose('a', [0, 0.9, 0], 5000);
    pose('b', [8, 0.9, 0], 5000);
    room.message('a', { type: 'throw', throw: { id: 1, o: [0.3, 1.5, 0], v: [18, 1, 0], tilt: 0 } }, 5000);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [8, 1.2, 0] }, 5500);
    assert.equal(room.players.get('b').alive, true);
    assert.equal(room.players.get('b').hp, MAX_HP);
    assert.ok(inbox.get('b').some((message) => message.type === 'revived'));
});

test('picking a new active skill drops the previous one at the player and Michael talent remains separate', () => {
    const { room, join, pose } = harness();
    join('a', 'A');
    const eye = ITEM_SPAWNS.find((item) => item.kind === 'eye');
    const frc = ITEM_SPAWNS.find((item) => item.kind === 'frc');
    const coach = NPC_SPAWNS.find((npc) => npc.id === 'coach-michael');

    pose('a', eye.at, 1000);
    room.message('a', { type: 'interact', target: eye.id }, 1300);
    assert.equal(room.players.get('a').hasEye, true);

    pose('a', [frc.at[0] + 0.25, 0.92, frc.at[2]], 1600);
    room.message('a', { type: 'interact', target: frc.id }, 1900);
    assert.equal(room.players.get('a').hasEye, false);
    assert.equal(room.players.get('a').hasFrc, true);
    assert.deepEqual(
        [room.items.get(eye.id).available, room.items.get(eye.id).holder, room.items.get(eye.id).at],
        [true, null, [frc.at[0] + 0.25, 0.02, frc.at[2]]]
    );

    pose('a', coach.at, 2200);
    room.message('a', { type: 'interact', target: coach.id }, 2500);
    assert.equal(room.players.get('a').hasFrc, true);
    assert.equal(room.players.get('a').coachGift, true);
    assert.equal(room.players.get('a').ammoCapacity, 5);
});

test('dropped revive armor cannot be reclaimed by its former holder during the same round', () => {
    const { room, join, pose } = harness();
    join('a', 'A');
    const revive = ITEM_SPAWNS.find((item) => item.kind === 'revive');
    const eye = ITEM_SPAWNS.find((item) => item.kind === 'eye');
    pose('a', revive.at, 1000);
    room.message('a', { type: 'interact', target: revive.id }, 1300);
    pose('a', eye.at, 1600);
    room.message('a', { type: 'interact', target: eye.id }, 1900);
    assert.equal(room.players.get('a').hasReviveArmor, false);
    assert.equal(room.players.get('a').reviveTaken, true);
    assert.equal(room.items.get(revive.id).available, true);
    pose('a', room.items.get(revive.id).at, 2200);
    room.message('a', { type: 'interact', target: revive.id }, 2500);
    assert.equal(room.players.get('a').hasReviveArmor, false);
    assert.equal(room.players.get('a').hasEye, true);
});

test('FRC is unlimited, lethal, cooldown follows its dropped pickup, and stealth omits player snapshots', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    const frc = ITEM_SPAWNS.find((item) => item.kind === 'frc');
    pose('a', [frc.at[0], 0.92, frc.at[2]], 1000);
    room.message('a', { type: 'interact', target: frc.id }, 1300);
    room.message('a', { type: 'toggleFrc' }, 1600);
    const player = room.players.get('a');
    const ammoBefore = player.ammo;
    room.message('a', { type: 'throw', throw: { id: 1, o: [frc.at[0] + 0.3, 1.5, frc.at[2]], v: [15, 0, 0], tilt: 0, frc: true } }, 2000);
    assert.equal(player.ammo, ammoBefore);
    assert.equal(player.frcCooldownUntil, 2000 + ITEM_RULES.frcCooldownMs);
    assert.equal(room.items.get(frc.id).cooldownUntil, player.frcCooldownUntil);
    const eye = ITEM_SPAWNS.find((item) => item.kind === 'eye');
    pose('a', [eye.at[0], 0.92, eye.at[2]], 2300);
    room.message('a', { type: 'interact', target: eye.id }, 2600);
    assert.equal(player.hasFrc, false);
    assert.equal(player.hasEye, true);
    assert.equal(player.frcCooldownUntil, 0);
    assert.equal(room.items.get(frc.id).cooldownUntil, 2000 + ITEM_RULES.frcCooldownMs);
    room.disconnect('a', 2700);
    assert.equal(room.items.get(frc.id).available, true);
    pose('b', [...room.items.get(frc.id).at.slice(0, 1), 0.92, room.items.get(frc.id).at[2]], 2800);
    room.message('b', { type: 'interact', target: frc.id }, 3100);
    assert.equal(room.players.get('b').frcCooldownUntil, 2000 + ITEM_RULES.frcCooldownMs);

    // Pick up the stealth power in another room and confirm its position is absent from another player's snapshot.
    const stealth = ITEM_SPAWNS.find((item) => item.kind === 'stealth');
    pose('b', [stealth.at[0], 0.92, stealth.at[2]], 4000);
    room.message('b', { type: 'interact', target: stealth.id }, 4300);
    room.message('b', { type: 'activateStealth' }, 4600);
    room.tick(4700);
    const snapshot = inbox.get('c').filter((message) => message.type === 'snapshot').at(-1);
    assert.equal(snapshot.poses.b, undefined);
});

test('Michael grants five-disc capacity and Mark grants creation power only once per round', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    const michael = NPC_SPAWNS.find((npc) => npc.id === 'coach-michael').at;
    pose('a', michael, 1000);
    room.message('a', { type: 'interact', target: 'coach-michael' }, 1300);
    assert.equal(room.players.get('a').ammoCapacity, 5);
    assert.equal(room.players.get('a').coachGift, true);
    const mark = NPC_SPAWNS.find((npc) => npc.id === 'mark').at;
    pose('a', mark, 2000);
    room.message('a', { type: 'interact', target: 'mark' }, 2300);
    assert.equal(room.players.get('a').hasCreation, true);
    assert.equal(room.items.get('item-creation').holder, 'a');
    pose('b', mark, 2600);
    room.message('b', { type: 'interact', target: 'mark' }, 2900);
    assert.equal(room.players.get('b').hasCreation, false);
    assert.ok(inbox.get('b').some((message) => message.type === 'interactionDenied' && message.reason.includes('已经交给别人')));
});

test('eye, stealth, and Mark abilities drop at the holder position and can be picked up again', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    join('anchor', 'Anchor'); // Keep the room alive while holders disconnect and their items are dropped.
    const eye = ITEM_SPAWNS.find((item) => item.kind === 'eye');
    pose('a', [eye.at[0], 0.92, eye.at[2]], 1000);
    room.message('a', { type: 'interact', target: eye.id }, 1300);
    assert.equal(room.players.get('a').hasEye, true);
    pose('a', [eye.at[0] + 0.4, 0.92, eye.at[2]], 1600);
    room.disconnect('a', 1700);
    assert.equal(room.items.get(eye.id).available, true);
    assert.deepEqual(room.items.get(eye.id).at, [eye.at[0] + 0.4, 0.02, eye.at[2]]);
    pose('b', [eye.at[0] + 0.4, 0.92, eye.at[2]], 2000);
    room.message('b', { type: 'interact', target: eye.id }, 2300);
    assert.equal(room.players.get('b').hasEye, true);

    const stealth = ITEM_SPAWNS.find((item) => item.kind === 'stealth');
    pose('b', [stealth.at[0], 0.92, stealth.at[2]], 2700);
    room.message('b', { type: 'interact', target: stealth.id }, 3000);
    assert.equal(room.players.get('b').hasStealth, true);
    pose('b', [stealth.at[0] + 0.3, 0.92, stealth.at[2]], 3400);
    room.disconnect('b', 3500);
    assert.equal(room.items.get(stealth.id).available, true);
    assert.deepEqual(room.items.get(stealth.id).at, [stealth.at[0] + 0.3, 0.02, stealth.at[2]]);

    join('c', 'C', 4000);
    const mark = NPC_SPAWNS.find((npc) => npc.id === 'mark');
    pose('c', mark.at, 4500);
    room.message('c', { type: 'interact', target: mark.id }, 4800);
    room.disconnect('c', 5000);
    assert.equal(room.items.get('item-creation').available, true);
    assert.deepEqual(room.items.get('item-creation').at, [mark.at[0], 0.02, mark.at[2]]);
    join('d', 'D', 6000);
    pose('d', [mark.at[0], 0.92, mark.at[2]], 6500);
    room.message('d', { type: 'interact', target: 'item-creation' }, 6800);
    assert.equal(room.players.get('d').hasCreation, true);
    assert.equal(room.items.get('item-creation').holder, 'd');
    room.disconnect('d', 7000);
    assert.equal(room.items.get('item-creation').available, true);
    assert.deepEqual(room.items.get('item-creation').at, [mark.at[0], 0.02, mark.at[2]]);
    join('e', 'E', 7500);
    pose('e', [mark.at[0], 0.92, mark.at[2]], 7800);
    room.message('e', { type: 'interact', target: 'item-creation' }, 8100);
    assert.equal(room.players.get('e').hasCreation, true);
    assert.equal(room.items.get('item-creation').holder, 'e');
    assert.ok(inbox.get('e').some((message) => message.type === 'ability' && message.player.hasCreation));

    join('b', 'B', 8200);
    pose('b', [mark.at[0] + 6, 0.92, mark.at[2]], 8200);
    for (const [id, at] of [[1, 9000], [2, 10000], [3, 11000]]) {
        room.message('b', {
            type: 'throw',
            throw: { id, o: [mark.at[0] + 5.7, 1.5, mark.at[2]], v: [-18, 0, 0], tilt: 0 }
        }, at);
        room.message('b', { type: 'hit', throwId: id, target: 'e', at: [mark.at[0], 1.2, mark.at[2]] }, at + 500);
    }
    assert.equal(room.players.get('e').alive, false, 'a lethal hit should eliminate the creation-power holder');
    assert.equal(room.players.get('e').hasCreation, false);
    assert.equal(room.items.get('item-creation').holder, null);
    assert.equal(room.items.get('item-creation').available, true);
    assert.deepEqual(room.items.get('item-creation').at, [mark.at[0], 0.02, mark.at[2]]);

    join('f', 'F', 12000);
    pose('f', [mark.at[0], 0.92, mark.at[2]], 12300);
    room.message('f', { type: 'interact', target: 'item-creation' }, 12600);
    assert.equal(room.players.get('f').hasCreation, true, 'another player can pick up Mark power after a kill-drop');
    assert.equal(room.items.get('item-creation').holder, 'f');
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

test('lobby players are visible and can chat, but cannot fight, score or join outside the gate', () => {
    const { room, join, pose, inbox } = harness();
    join('lobby', '大厅玩家', 0, 'lobby');
    join('player', '场内玩家', 0, 'playing');
    pose('lobby', [SOUTH_GATE.spawn.x, 0.92, SOUTH_GATE.spawn.z], 1000);
    const lobbyStart = [...room.players.get('lobby').pose.p];
    pose('lobby', [-20, 0.92, 60], 1050);
    assert.deepEqual(room.players.get('lobby').pose.p, lobbyStart, 'outdoor plaza and campus interior are rejected');
    assert.ok(inbox.get('lobby').some((message) => message.type === 'positionCorrected'));
    pose('lobby', [SOUTH_GATE.spawn.x, 0.92, SOUTH_GATE.spawn.z], 1300);
    pose('player', [SOUTH_GATE.spawn.x, 0.92, SOUTH_GATE.line + 0.4], 1300);
    room.tick(1350);
    assert.equal(inbox.get('player').at(-1).type, 'snapshot');
    assert.ok('lobby' in inbox.get('player').at(-1).poses, 'lobby pose replicates to other clients');

    room.message('player', { type: 'throw', throw: { id: 9, o: [SOUTH_GATE.spawn.x, 1.5, SOUTH_GATE.line + 0.4], v: [0, 0, 15], tilt: 0 } }, 1400);
    room.message('player', { type: 'hit', throwId: 9, target: 'lobby', at: [SOUTH_GATE.spawn.x, 1, SOUTH_GATE.spawn.z] }, 1800);
    assert.equal(room.players.get('lobby').hp, MAX_HP, 'lobby occupants cannot be damaged');
    assert.ok(inbox.get('player').some((message) => message.type === 'hitRejected' && message.throwId === 9));

    room.message('lobby', { type: 'chat', text: '等待中' }, 1900);
    assert.ok(inbox.get('player').some((message) => message.type === 'chat' && message.line.text === '等待中'));
    room.message('lobby', { type: 'throw', throw: { id: 1, o: [0, 1, 0], v: [10, 0, 0], tilt: 0 } }, 2000);
    assert.equal(room.players.get('lobby').throws.size, 0);
    assert.equal(room.players.get('lobby').ammo, room.startAmmo);
    assert.equal(room.roundParticipants.size, 0, 'lobby account is not counted into this round');

    room.message('lobby', { type: 'joinRound' }, 2100);
    assert.equal(room.players.get('lobby').phase, 'lobby');
    assert.ok(inbox.get('lobby').some((message) => message.type === 'joinRoundDenied'));

    pose('lobby', [(SOUTH_GATE.x0 + SOUTH_GATE.x1) / 2, 0.92, SOUTH_GATE.line - 0.55], 2600);
    room.message('lobby', { type: 'joinRound' }, 2700);
    assert.equal(room.players.get('lobby').phase, 'playing');
    assert.ok(inbox.get('player').some((message) => message.type === 'phaseChanged' && message.id === 'lobby'));
});

test('production rooms ignore a client hello claim to start inside; only gate join changes phase', () => {
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
        Math.random,
        true
    );
    inbox.set('spoof', []);
    room.connect('spoof');
    room.message('spoof', { type: 'hello', version: PROTOCOL_VERSION, name: 'Spoof', phase: 'playing' }, 0);
    assert.equal(inbox.get('spoof').find((message) => message.type === 'welcome').players[0].phase, 'lobby');
});

test('the first golden pickup starts one server-timed cutscene and freezes gameplay messages', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    const [x, y, z] = room.gold.at;
    pose('a', [x, y, z], 1000);
    assert.equal(room.gold.holder, 'a');
    const event = inbox.get('a').find((message) => message.type === 'momentCutsceneStarted');
    assert.equal(event?.cutscene.kind, 'gold-first');
    assert.equal(inbox.get('b').filter((message) => message.type === 'momentCutsceneStarted').length, 1);
    const before = room.players.get('a').pose;
    pose('a', [x + 2, y, z], 2000);
    assert.deepEqual(room.players.get('a').pose, before, 'movement is rejected during the cutscene');
    room.message('a', { type: 'chat', text: 'during film' }, 2000);
    assert.equal(inbox.get('b').some((message) => message.type === 'chat' && message.line.text === 'during film'), false);
    pose('a', [x + 2, y, z], 4600);
    assert.deepEqual(room.players.get('a').pose.p, [x + 2, y, z], 'gameplay resumes after the shared window');
});

test('a matching skip request ends the shared moment cutscene exactly once', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    const [x, y, z] = room.gold.at;
    pose('a', [x, y, z], 1000);
    const event = inbox.get('a').find((message) => message.type === 'momentCutsceneStarted');
    assert.ok(event);
    room.message('b', { type: 'skipMomentCutscene', id: event.cutscene.id }, 1100);
    assert.equal(inbox.get('a').filter((message) => message.type === 'momentCutsceneEnded').length, 1);
    assert.equal(inbox.get('b').filter((message) => message.type === 'momentCutsceneEnded').length, 1);
    pose('a', [x + 2, y, z], 1200);
    assert.deepEqual(room.players.get('a').pose.p, [x + 2, y, z]);
    room.message('b', { type: 'skipMomentCutscene', id: event.cutscene.id }, 1300);
    assert.equal(inbox.get('a').filter((message) => message.type === 'momentCutsceneEnded').length, 1);
});

test('the room starts one final-duel cutscene when an established round reaches two survivors', () => {
    const { room, join, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    join('c', 'C');
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
        const player = room.players.get(id);
        player.pose = { p: [-8 + i, 0.92, 4], yaw: 0, pitch: 0 };
        player.poseAt = 1000;
    }
    const eliminated = room.players.get('c');
    eliminated.alive = false;
    eliminated.spectating = true;
    room.fallen(eliminated, 1100);
    const event = inbox.get('a').find((message) => message.type === 'momentCutsceneStarted');
    assert.equal(event?.cutscene.kind, 'last-two');
    assert.deepEqual(event?.cutscene.focus, [-8, 0.92, 4]);
    assert.deepEqual(event?.cutscene.secondary, [-7, 0.92, 4]);
    assert.equal(inbox.get('b').filter((message) => message.type === 'momentCutsceneStarted').length, 1);
    room.fallen(eliminated, 1200);
    assert.equal(inbox.get('a').filter((message) => message.type === 'momentCutsceneStarted').length, 1);
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
    // The golden disc spawns at a random spawn point; keep it away so neither pose picks it up (that would start
    // the gold-first cutscene, during which throws are refused).
    room.gold = { holder: null, at: [500, 0.92, 500] };
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
    // Across the open arena (the room rejects flights through walls).
    room.message('a', { type: 'pose', pose: { p: [-18, 0.9, -3], yaw: 0, pitch: 0, aim: 1 } }, 3000);
    room.message('b', { type: 'pose', pose: { p: [2, 0.9, -3], yaw: 0, pitch: 0 } }, 3000);
    const struck = () => inbox.get('b').filter((message) => message.type === 'struck');
    // Claims sniper at normal speed: honoured as a normal throw, one point of damage to the body.
    room.message(
        'a',
        { type: 'throw', throw: { id: 1, o: [-18, 1.5, -3], v: [20, 0, 0], tilt: 0, sniper: true } },
        4000
    );
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [2, 1.2, -3] }, 4900);
    assert.deepEqual(
        struck().map((m) => [m.hp, m.out, m.head, m.sniper]),
        [[MAX_HP - 1, false, false, false]]
    );
    room.players.get('b').hp = MAX_HP;
    // A real sniper throw to the head: out in one from full health.
    room.message(
        'a',
        { type: 'throw', throw: { id: 2, o: [-18, 1.5, -3], v: [34, 0, 0], tilt: 0, sniper: true } },
        5000
    );
    room.message('a', { type: 'hit', throwId: 2, target: 'b', at: [2, 1.7, -3] }, 5600);
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
        const hit = { type: 'hit', throwId: 1, target: 'b', at: [6, 1.7, 0] };
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

test('shoulder-height contact damages the body while a head-band contact eliminates', () => {
    const { room, join, pose, inbox } = harness();
    join('a', 'A');
    join('b', 'B');
    pose('a', [0, 0.9, 0], 100);
    pose('b', [6, 0.9, 0], 100);

    room.message('a', { type: 'throw', throw: { id: 1, o: [0, 1.5, 0], v: [20, 0, 0], tilt: 0 } }, 1000);
    room.message('a', { type: 'hit', throwId: 1, target: 'b', at: [6, 1.5, 0] }, 1600);
    const shoulder = inbox.get('b').find((message) => message.type === 'struck');
    assert.deepEqual([shoulder.hp, shoulder.out, shoulder.head], [MAX_HP - 1, false, false]);

    room.message('a', { type: 'throw', throw: { id: 2, o: [0, 1.5, 0], v: [20, 0, 0], tilt: 0 } }, 2000);
    room.message('a', { type: 'hit', throwId: 2, target: 'b', at: [6, 1.7, 0] }, 2600);
    const strikes = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual([strikes[1].hp, strikes[1].out, strikes[1].head], [0, true, true]);
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
    // Along the corridor the spawn lies in (the room rejects flights through walls).
    room.message('b', { type: 'pose', pose: { p: [ax, 0.92, az - 6], yaw: 0, pitch: 0 } }, 6000);
    for (const [id, at] of [
        [1, 7000],
        [2, 8000],
        [3, 9000]
    ]) {
        room.message('b', { type: 'throw', throw: { id, o: [ax, 1.5, az - 6], v: [0, 0, 15], tilt: 0 } }, at);
        room.message('b', { type: 'hit', throwId: id, target: 'a', at: [ax, 1.0, az] }, at + 300);
    }
    assert.deepEqual(goldEvents().slice(1), [['dropped', null]]);
    room.message('b', { type: 'pose', pose: { p: [ax + 0.5, 0.92, az], yaw: 0, pitch: 0 } }, 10_000);
    assert.equal(goldEvents().length, 2, 'not straight away');
    room.message('b', { type: 'pose', pose: { p: [ax + 0.5, 0.92, az], yaw: 0, pitch: 0 } }, 11_000);
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
    assert.equal(ROUND.blackoutSecondsLeft, 240);
    assert.equal(blackout, 360_000);
    room.goldCutscenePlayed = true; // this scenario starts after the round's first-pickup presentation
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
    // (During the lights-out cutscene nobody can be caught.)
    const gCut = guardAt(blackout + 1000, blackout);
    room.message('b', { type: 'pose', pose: { p: [gCut.x, 0.92, gCut.z - 3], yaw: 0, pitch: 0 } }, blackout + 900);
    room.message('b', { type: 'spotted' }, blackout + 1000);
    assert.equal(room.players.get('b').alive, true);
    const g = guardAt(blackout + 6000, blackout);
    room.message('b', { type: 'pose', pose: { p: [g.x, 0.92, g.z - 3], yaw: 0, pitch: 0 } }, blackout + 5900);
    room.message('b', { type: 'spotted' }, blackout + 6000);
    const struck = inbox
        .get('a')
        .filter((m) => m.type === 'struck')
        .at(-1);
    assert.deepEqual([struck.target, struck.by, struck.final], ['b', 'guard', true]);
    assert.equal(room.discs.length, discsBefore + 1);
    room.tick(blackout + 10_000);
    assert.equal(room.players.get('b').alive, false, 'no respawn after the blackout');
    // C is eliminated by A's discs: A is the last one standing and wins straight away.
    room.message('a', { type: 'pose', pose: { p: [0, 0.92, 0], yaw: 0, pitch: 0 } }, blackout + 14_000);
    room.message('c', { type: 'pose', pose: { p: [6, 0.92, 0], yaw: 0, pitch: 0 } }, blackout + 14_000);
    for (const [id, at] of [
        [3, blackout + 15_000],
        [4, blackout + 16_000],
        [5, blackout + 17_000]
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
    room.tick(blackout + 17_300 + ROUND.intermissionSeconds * 1000 + 1);
    room.tick(blackout + 17_300 + ROUND.intermissionSeconds * 1000 + 100);
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
