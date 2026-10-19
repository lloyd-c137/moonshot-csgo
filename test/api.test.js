import assert from 'node:assert/strict';
import test from 'node:test';

import { Accounts, MemoryAccountDb } from '../server/accounts.ts';
import { handleApi } from '../server/api.ts';
import { Room } from '../server/room.ts';

const fixture = () => {
    const accounts = new Accounts(new MemoryAccountDb());
    const files = new Map();
    const avatars = {
        get: async (key) => files.get(key) ?? null,
        put: async (key, bytes) => void files.set(key, bytes.slice()),
        delete: async (key) => void files.delete(key)
    };
    const room = new Room(
        { to: () => undefined, all: () => undefined, close: () => undefined },
        24,
        accounts,
        Math.random,
        true
    );
    const deps = {
        accounts,
        room,
        avatars,
        clientAddress: 'test-client',
        combatTestEnabled: false,
        failures: new Map(),
        avatarUploads: new Map()
    };
    const call = (path, init = {}) => handleApi(new Request(`http://campus${path}`, init), new URL(`http://campus${path}`), deps);
    return { accounts, call, deps, files };
};

const vp8x = (width, height) => {
    const bytes = new Uint8Array(30);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    view.setUint32(4, bytes.length - 8, true);
    bytes.set(new TextEncoder().encode('WEBP'), 8);
    bytes.set(new TextEncoder().encode('VP8X'), 12);
    view.setUint32(16, 10, true);
    bytes[24] = (width - 1) & 255;
    bytes[25] = ((width - 1) >> 8) & 255;
    bytes[26] = ((width - 1) >> 16) & 255;
    bytes[27] = (height - 1) & 255;
    bytes[28] = ((height - 1) >> 8) & 255;
    bytes[29] = ((height - 1) >> 16) & 255;
    return bytes;
};

test('shared API registers, signs in, returns account and leaderboard, and rejects bad passwords', async () => {
    const { call } = fixture();
    const registered = await call('/api/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'CampusUser', password: 'secret1' })
    });
    assert.equal(registered.status, 200);
    const { token } = await registered.json();
    assert.equal(typeof token, 'string');
    assert.equal((await call('/api/me', { headers: { authorization: `Bearer ${token}` } })).status, 200);
    const badPassword = await call('/api/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'CampusUser', password: 'wrong-password' })
    });
    assert.equal(badPassword.status, 400);
    assert.deepEqual(await badPassword.json(), { error: '密码不正确（该用户名已被注册）' });
    const board = await call('/api/leaderboard');
    assert.equal(board.status, 200);
    assert.equal((await board.json()).top[0].name, 'CampusUser');
});

test('shared API returns 401 for missing account and preserves avatar storage unavailable response', async () => {
    const { call, deps } = fixture();
    assert.equal((await call('/api/me')).status, 401);
    deps.avatars = null;
    const response = await call('/api/avatar', { method: 'POST' });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: '头像存储暂不可用' });
});

test('shared API validates avatar format and request size, then saves a valid WebP', async () => {
    const { call, files } = fixture();
    const auth = await call('/api/signin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'AvatarUser', password: 'secret1' })
    });
    const { token } = await auth.json();
    const headers = { authorization: `Bearer ${token}` };
    const wrongFormat = await call('/api/avatar', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'image/png' },
        body: new Uint8Array([1, 2, 3])
    });
    assert.equal(wrongFormat.status, 400);
    const tooLarge = await call('/api/avatar', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'image/webp' },
        body: new Uint8Array(250_001)
    });
    assert.equal(tooLarge.status, 413);
    const invalidWebp = await call('/api/avatar', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'image/webp' },
        body: new Uint8Array([1, 2, 3])
    });
    assert.equal(invalidWebp.status, 400);
    const saved = await call('/api/avatar', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'image/webp' },
        body: vp8x(64, 64)
    });
    assert.equal(saved.status, 200);
    assert.equal(files.size, 1);
    const { account } = await saved.json();
    const publicAvatar = await call(`/api/avatars/${account.avatarId}`);
    assert.equal(publicAvatar.status, 200);
    assert.equal(publicAvatar.headers.get('content-type'), 'image/webp');
    assert.equal(publicAvatar.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});
