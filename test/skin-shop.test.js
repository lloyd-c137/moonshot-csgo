import assert from 'node:assert/strict';
import test from 'node:test';

import { Accounts, MemoryAccountDb } from '../server/accounts.ts';
import { Room } from '../server/room.ts';
import { purchasePrice, SKIN_POINTS, SKINS, skinById } from '../src/config/skins.ts';
import { PROTOCOL_VERSION } from '../src/net/protocol.ts';

const harness = (accounts) => {
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
        accounts
    );
    room.startAmmo = 9;
    const join = (id, token, now = 0) => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name: '', token }, now);
    };
    const pose = (id, p, now) => room.message(id, { type: 'pose', pose: { p, yaw: 0, pitch: 0 } }, now);
    return { room, inbox, join, pose };
};

test('the catalogue: ten skins, unique ids, prices rise with the tier, counter editions cost half again', () => {
    assert.equal(SKINS.length, 10);
    assert.equal(new Set(SKINS.map((skin) => skin.id)).size, 10);
    const order = ['standard', 'deluxe', 'rare', 'epic', 'legendary'];
    for (let i = 1; i < SKINS.length; i++) {
        assert.ok(order.indexOf(SKINS[i].tier) >= order.indexOf(SKINS[i - 1].tier));
        assert.ok(SKINS[i].price >= SKINS[i - 1].price);
    }
    for (const skin of SKINS) assert.equal(skin.counterPrice, Math.round((skin.price * 0.5) / 5) * 5);
    const steel = skinById('steel');
    assert.equal(purchasePrice(steel, undefined, false), 30);
    assert.equal(purchasePrice(steel, undefined, true), 45);
    assert.equal(purchasePrice(steel, { counter: false, kills: 0 }, true), 15);
    assert.equal(purchasePrice(steel, { counter: true, kills: 0 }, true), null);
    assert.deepEqual(SKIN_POINTS, { kill: 1, win: 10 });
});

test('buying needs enough points, equips the skin, and the counter upgrade keeps it; equip needs ownership', async () => {
    const db = new MemoryAccountDb();
    const accounts = new Accounts(db);
    await accounts.register('买家', 'secret1', 0);
    const poor = accounts.buySkin('买家', 'steel', false);
    assert.equal(poor.ok, false);
    assert.equal(poor.status, 402);
    accounts.record('买家', { points: 60 });
    const bought = accounts.buySkin('买家', 'steel', false);
    assert.equal(bought.ok, true);
    assert.deepEqual([bought.account.points, bought.account.equippedSkin, bought.account.skins], [30, 'steel', { steel: { counter: false, kills: 0 } }]);
    assert.equal(accounts.buySkin('买家', 'steel', false).status, 409, 'already owned');
    const upgraded = accounts.buySkin('买家', 'steel', true);
    assert.deepEqual([upgraded.account.points, upgraded.account.skins.steel.counter], [15, true]);
    assert.equal(accounts.buySkin('买家', 'nope', false).status, 400);
    assert.equal(accounts.equipSkin('买家', 'gilded').ok, false, 'not owned');
    assert.equal(accounts.equipSkin('买家', null).account.equippedSkin, null);
    assert.equal(accounts.equipSkin('买家', 'steel').account.equippedSkin, 'steel');
    // Malformed stored skins are ignored, not trusted.
    db.users.get('买家').skins = '{"steel":{"counter":true,"kills":-3},"fake":{"counter":true}}';
    assert.deepEqual(accounts.equipSkin('买家', 'steel').account.skins, { steel: { counter: true, kills: 0 } });
});

test('an elimination earns a point and ticks the thrower’s 计数器; a round win earns ten', async () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const a = await accounts.register('甲同学', 'secret1', 0);
    const b = await accounts.register('乙同学', 'secret1', 0);
    accounts.record('甲同学', { points: 100 });
    assert.equal(accounts.buySkin('甲同学', 'magma', true).ok, false, 'magma 计数器 costs 375');
    assert.equal(accounts.resolve(a.token, 1).points, 100);
    accounts.buySkin('甲同学', 'classic', true);
    assert.equal(accounts.resolve(a.token, 1).points, 70);
    const { room, inbox, join, pose } = harness(accounts);
    join('a', a.token);
    join('b', b.token);
    room.gold = { holder: null, at: [500, 0.92, 500] };
    assert.deepEqual([room.players.get('a').skin, room.players.get('a').skinCounter, room.players.get('a').skinKills], ['classic', true, 0]);
    pose('a', [0, 0.9, 0], 100);
    pose('b', [8, 0.9, 0], 100);
    for (const [id, at] of [[1, 1000], [2, 2000], [3, 3000]]) {
        room.message('a', { type: 'throw', throw: { id, o: [0.3, 1.5, 0], v: [18, 1, 0], tilt: 0 } }, at);
        room.message('a', { type: 'hit', throwId: id, target: 'b', at: [8, 1.2, 0] }, at + 500);
    }
    const struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.equal(struck.length, 3);
    assert.equal(struck[0].skin, 'classic');
    assert.equal(struck[0].counter, undefined, 'only eliminations count');
    assert.equal(struck[2].out, true);
    assert.equal(struck[2].counter, 1);
    assert.equal(room.players.get('a').skinKills, 1);
    const after = accounts.resolve(a.token, 4000);
    assert.equal(after.points, 70 + SKIN_POINTS.kill);
    assert.equal(after.skins.classic.kills, 1);
    // Winning the round: +10.
    room.gold = { holder: 'a', at: [0, 0.92, 0] };
    room.tick(room.round.endsAt);
    assert.equal(accounts.resolve(a.token, room.round.nextAt).points, 70 + SKIN_POINTS.kill + SKIN_POINTS.win);
    assert.equal(accounts.resolve(b.token, room.round.nextAt).points, 0);
});

test('equipping from the shop reaches everyone in the room', async () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const a = await accounts.register('甲同学', 'secret1', 0);
    accounts.record('甲同学', { points: 30 });
    const { room, inbox, join } = harness(accounts);
    join('a', a.token);
    join('b', (await accounts.register('乙同学', 'secret1', 0)).token);
    const result = accounts.buySkin('甲同学', 'steel', false);
    room.updateSkin(result.account);
    const update = inbox.get('b').findLast((message) => message.type === 'ability' && message.id === 'a');
    assert.deepEqual([update.player.skin, update.player.skinCounter, update.player.skinKills], ['steel', false, 0]);
});
