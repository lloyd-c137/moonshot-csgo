import assert from 'node:assert/strict';
import test from 'node:test';

import { Accounts, MemoryAccountDb, validUsername } from '../server/accounts.ts';
import { Room } from '../server/room.ts';
import { CHAT, PROTOCOL_VERSION, ROUND } from '../src/net/protocol.ts';

test('register, log in, resolve sessions; names are unique case-insensitively; bad input is refused', async () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const created = await accounts.register('Lloyd', 'secret1', 1000);
    assert.equal(created.ok, true);
    assert.equal(created.account.name, 'Lloyd');
    assert.deepEqual(accounts.resolve(created.token, 2000), {
        name: 'Lloyd',
        kills: 0,
        deaths: 0,
        hits: 0,
        score: 0,
        wins: 0,
        rounds: 0,
        losses: 0,
        avatarId: null,
        avatarVersion: null
    });
    assert.equal((await accounts.register('lloyd', 'another1', 1000)).ok, false, 'taken');
    assert.equal((await accounts.register('x', 'secret1', 1000)).ok, false, 'too short');
    assert.equal((await accounts.register('ok_name', '123', 1000)).ok, false, 'weak password');
    assert.equal((await accounts.login('LLOYD', 'wrong', 1000)).ok, false);
    const login = await accounts.login('lloyd', 'secret1', 3000);
    assert.equal(login.ok, true);
    assert.notEqual(login.token, created.token);
    accounts.logout(login.token);
    assert.equal(accounts.resolve(login.token, 4000), null);
    assert.equal(accounts.resolve(created.token, 40 * 86_400_000), null, 'expired');
    assert.equal(validUsername('飞盘王_01'), '飞盘王_01');
    assert.equal(validUsername('a b'), null);
});

test('one-step sign-in registers unknown names and logs in known ones', async () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const first = await accounts.signIn('飞盘手', 'secret1', 0);
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    const again = await accounts.signIn('飞盘手', 'secret1', 10);
    assert.equal(again.ok, true);
    assert.equal(again.created, undefined);
    assert.notEqual(again.token, first.token);
    const wrong = await accounts.signIn('飞盘手', 'nope123', 20);
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /密码不正确/);
    assert.equal((await accounts.signIn('x', 'secret1', 0)).ok, false, 'invalid name');
    assert.equal((await accounts.signIn('新人', '12', 0)).ok, false, 'weak password');
});

test('the 淘汰王 stands until someone has strictly more lifetime eliminations', () => {
    const db = new MemoryAccountDb();
    const accounts = new Accounts(db);
    for (const name of ['甲', '乙'])
        db.insertUser({
            key: name,
            name,
            salt: '',
            hash: '',
            kills: 0,
            deaths: 0,
            hits: 0,
            score: 0,
            wins: 0,
            rounds: 0,
            losses: 0,
            created: 0
        });
    const a = accounts.record('甲', { kills: 3 });
    assert.deepEqual(accounts.challenge(a, 10), { king: { name: '甲', kills: 3, since: 10 }, isNew: true });
    const b = accounts.record('乙', { kills: 3 });
    assert.equal(accounts.challenge(b, 20), null, 'a tie does not dethrone');
    const b2 = accounts.record('乙', { kills: 1 });
    assert.deepEqual(accounts.challenge(b2, 30), { king: { name: '乙', kills: 4, since: 30 }, isNew: true });
    assert.deepEqual(accounts.king(), { name: '乙', kills: 4, since: 30 });
    assert.deepEqual(
        accounts.leaderboard(2).map((row) => row.name),
        ['乙', '甲']
    );
});

const harness = (accounts) => {
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
        24,
        accounts
    );
    room.startAmmo = 9;
    const join = (id, name, token, now = 0) => {
        inbox.set(id, []);
        room.connect(id);
        room.message(id, { type: 'hello', version: PROTOCOL_VERSION, name, token }, now);
        return inbox.get(id);
    };
    return { room, inbox, closed, join };
};

test('round stats persist once, deduplicate reconnects, include leavers and exclude late spectators', async () => {
    const db = new MemoryAccountDb();
    const accounts = new Accounts(db);
    const tokens = {};
    for (const name of ['winner', 'leaver', 'viewer', 'loser']) {
        tokens[name] = (await accounts.register(name, 'secret1', 0)).token;
    }
    const { room, join, inbox } = harness(accounts);
    join('a', '', tokens.winner);
    join('b', '', tokens.leaver);
    join('d', '', tokens.loser);
    room.disconnect('b', 1000);
    join('b2', '', tokens.leaver, 2000);
    room.disconnect('b2', 3000);
    const blackout = room.blackoutAt();
    join('c', '', tokens.viewer, blackout + 1);
    assert.equal(room.players.get('c').spectating, true);
    room.gold.holder = 'a';
    const end = room.round.endsAt;
    room.tick(end);
    room.tick(end + 1);
    assert.equal(room.round.winner, 'winner');
    const stats = (name) => accounts.resolve(tokens[name], end + 2);
    assert.deepEqual([stats('winner').wins, stats('winner').rounds], [1, 1]);
    for (const name of ['leaver', 'loser'])
        assert.deepEqual([stats(name).wins, stats(name).rounds, stats(name).losses], [0, 1, 1]);
    assert.equal(stats('winner').losses, 0, 'winning leaves the display baseline unchanged');
    assert.deepEqual([stats('viewer').wins, stats('viewer').rounds], [0, 0]);
    assert.equal(
        inbox
            .get('a')
            .filter((m) => m.type === 'account')
            .at(-1).account.wins,
        1
    );
    // A completed draw counts for its participants; former spectators participate in the new round.
    room.tick(end + ROUND.intermissionSeconds * 1000);
    room.gold.holder = null;
    room.tick(room.round.endsAt);
    assert.deepEqual([stats('winner').wins, stats('winner').rounds, stats('winner').losses], [1, 2, 0]);
    assert.deepEqual([stats('viewer').wins, stats('viewer').rounds], [0, 1]);
    assert.equal(stats('leaver').rounds, 1);
    // Persistence survives an Accounts service being reconstructed.
    assert.equal(new Accounts(db).resolve(tokens.winner, end + 2).rounds, 2);
});

test('an abandoned empty round records no result and cannot carry participants into a later round', async () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const { token } = await accounts.register('abandoned', 'secret1', 0);
    const { room, join } = harness(accounts);
    join('a', '', token);
    room.disconnect('a', 1000);
    assert.equal(room.round, null);
    join('b', '', token, 2000);
    room.gold.holder = 'b';
    room.tick(room.round.endsAt);
    assert.deepEqual(
        accounts.leaderboard().map(({ wins, rounds }) => [wins, rounds]),
        [[1, 1]]
    );
});

test('only signed-in players may join; they play under their username, keep stats and crown the king', async () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const { token } = await accounts.register('甲同学', 'secret1', 0);
    const { token: tokenB } = await accounts.register('乙同学', 'secret2', 0);
    const { room, join, inbox, closed } = harness(accounts);
    const a = join('a', 'ignored nickname', token);
    assert.equal(a[0].name, '甲同学');
    assert.deepEqual(a[0].account, {
        name: '甲同学',
        kills: 0,
        deaths: 0,
        hits: 0,
        score: 0,
        wins: 0,
        rounds: 0,
        losses: 0,
        avatarId: null,
        avatarVersion: null
    });
    assert.equal(a[0].king, null);
    // No guests: a hello without a valid session is refused.
    assert.deepEqual(join('guest', '甲同学'), [{ type: 'rejected', reason: 'auth' }]);
    assert.ok(closed.has('guest'));
    assert.equal(join('b', 'whatever', tokenB)[0].name, '乙同学');
    room.message('a', { type: 'pose', pose: { p: [0, 0.9, 0], yaw: 0, pitch: 0 } }, 3000);
    room.message('b', { type: 'pose', pose: { p: [6, 0.9, 0], yaw: 0, pitch: 0 } }, 3000);
    for (const [id, at, contact] of [
        [1, 4000, [6, 1.0, 0]],
        [2, 5000, [6, 1.7, 0]]
    ]) {
        room.message('a', { type: 'throw', throw: { id, o: [0, 1.5, 0], v: [15, 0, 0], tilt: 0 } }, at);
        room.message('a', { type: 'hit', throwId: id, target: 'b', at: contact }, at + 300);
    }
    const struck = inbox.get('b').filter((message) => message.type === 'struck');
    assert.deepEqual(
        struck.map((message) => [message.hp, message.out, message.head]),
        [
            [2, false, false],
            [0, true, true]
        ]
    );
    assert.deepEqual(accounts.resolve(token, 6000), {
        name: '甲同学',
        kills: 1,
        deaths: 0,
        hits: 2,
        score: 1,
        wins: 0,
        rounds: 0,
        losses: 0,
        avatarId: null,
        avatarVersion: null
    });
    assert.deepEqual(inbox.get('b').find((message) => message.type === 'king').king.name, '甲同学');
    assert.ok(inbox.get('b').some((message) => message.type === 'chat' && message.line.system));
    // Signing in again elsewhere replaces the old connection.
    join('a2', '', token, 7000);
    assert.ok(closed.has('a'));
    assert.equal([...room.players.values()].filter((player) => player.name === '甲同学').length, 1);
});

test('world chat: cleaned, rate-limited, broadcast, and replayed to newcomers', () => {
    const { room, join, inbox } = harness(null);
    join('a', 'A');
    join('b', 'B');
    room.message('a', { type: 'chat', text: '  你好\u0007  世界  ' }, 1000);
    room.message('a', { type: 'chat', text: '   ' }, 1001);
    room.message('a', { type: 'chat', text: 'x'.repeat(500) }, 1002);
    for (let i = 0; i < 10; i++) room.message('a', { type: 'chat', text: `spam ${i}` }, 1003 + i);
    const lines = inbox
        .get('b')
        .filter((message) => message.type === 'chat')
        .map((message) => message.line);
    assert.equal(lines[0].text, '你好 世界');
    assert.equal(lines[0].name, 'A');
    assert.equal(lines[1].text.length, CHAT.max);
    assert.equal(lines.length, CHAT.burst, 'burst limit');
    room.message('a', { type: 'chat', text: 'later' }, 1003 + CHAT.windowSeconds * 1000);
    const c = join('c', 'C', undefined, 9000);
    assert.deepEqual(c[0].chat.map((line) => line.text).at(-1), 'later');
});
