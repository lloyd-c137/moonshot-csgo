import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brotliCompressSync } from 'node:zlib';

import { WebSocket } from 'ws';

import { createCampusServer } from '../server/node/main.ts';
import { SOUTH_GATE } from '../src/config/gameplay.ts';
import { PROTOCOL_VERSION } from '../src/net/protocol.ts';

const until = (socket, predicate, timeout = 5000) =>
    new Promise((resolve, reject) => {
        const previous = socket.messages?.find(predicate);
        if (previous) return resolve(previous);
        const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for WebSocket message; received: ${socket.messages.map((message) => message.type).join(', ')}`)),
            timeout
        );
        const listener = (data) => {
            const message = JSON.parse(data.toString());
            if (!predicate(message)) return;
            clearTimeout(timer);
            socket.off('message', listener);
            resolve(message);
        };
        socket.on('message', listener);
    });

const connect = (url, origin) =>
    new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { origin });
        socket.messages = [];
        socket.on('message', (data) => {
            const message = JSON.parse(data.toString());
            socket.messages.push(message);
            if (message.type === 'snapshotFull' || message.type === 'snapshotDelta' || (message.type === 'snapshot' && message.seq))
                socket.send(JSON.stringify({ type: 'snapshotAck', seq: message.seq }));
        });
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });

const auth = async (base, name) => {
    const response = await fetch(`${base}/api/signin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ name, password: 'secret1' })
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
};

test('Node campus server serves static/API, hosts authoritative multiplayer, rejects bad Origin and persists accounts', async (t) => {
    const temp = await mkdtemp(join(tmpdir(), 'moonshot-campus-test-'));
    const dist = join(temp, 'dist');
    await mkdir(join(dist, 'build'), { recursive: true });
    await mkdir(join(dist, 'ammo'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<html>campus</html>');
    await writeFile(join(dist, 'build', 'app.js'), 'export const ok = true;');
    await writeFile(join(dist, 'build', 'app.js.br'), brotliCompressSync('export const ok = true;'));
    await writeFile(join(dist, 'ammo', 'test.wasm'), new Uint8Array([0, 97, 115, 109]));
    const config = {
        PORT: 0,
        HOST: '127.0.0.1',
        DATA_DIR: join(temp, 'data'),
        DIST_DIR: dist,
        ALLOWED_ORIGINS: '127.0.0.1,localhost'
    };
    let server = await createCampusServer({ cwd: temp, config });
    await server.listen();
    t.after(async () => {
        await server.close().catch(() => undefined);
        await rm(temp, { recursive: true, force: true });
    });
    const port = server.httpServer.address().port;
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');
    const script = await fetch(`${base}/build/app.js`);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal(script.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const compressed = await fetch(`${base}/build/app.js`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(compressed.headers.get('content-encoding'), 'br');
    assert.match(compressed.headers.get('vary'), /Accept-Encoding/i);
    assert.equal(compressed.headers.get('content-type'), script.headers.get('content-type'));
    assert.equal(await compressed.text(), 'export const ok = true;');
    const head = await fetch(`${base}/build/app.js`, { method: 'HEAD', headers: { 'accept-encoding': 'br' } });
    assert.equal(head.headers.get('content-length'), String(brotliCompressSync('export const ok = true;').length));
    assert.equal(await head.text(), '');
    const cached = await fetch(`${base}/build/app.js`, { headers: { 'if-none-match': script.headers.get('etag') } });
    assert.equal(cached.status, 304);
    const wasm = await fetch(`${base}/ammo/test.wasm`);
    assert.equal(wasm.headers.get('content-type'), 'application/wasm');
    assert.equal(wasm.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(await (await fetch(`${base}/unknown/route`)).text(), '<html>campus</html>');

    const tokenA = await auth(base, 'NodeAlice');
    const tokenB = await auth(base, 'NodeBobby');
    assert.equal((await fetch(`${base}/api/me`)).status, 401);
    const a = await connect(`ws://127.0.0.1:${port}/ws`, base);
    const b = await connect(`ws://127.0.0.1:${port}/ws`, base);
    t.after(() => {
        a.close();
        b.close();
    });
    const capabilities = { snapshotAck: true, snapshotDelta: true };
    a.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, name: 'A', token: tokenA, phase: 'lobby', capabilities }));
    b.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, name: 'B', token: tokenB, phase: 'lobby', capabilities }));
    const welcomeA = await until(a, (message) => message.type === 'welcome');
    const welcomeB = await until(b, (message) => message.type === 'welcome');
    const playerA = welcomeA.players.find((player) => player.id === welcomeA.id);
    const playerB = welcomeB.players.find((player) => player.id === welcomeB.id);
    assert.equal(playerA.phase, 'lobby');
    assert.equal(playerB.phase, 'lobby');
    await until(a, (message) => message.type === 'joined' && message.player.id === welcomeB.id);
    a.send(JSON.stringify({ type: 'chat', text: '校内服聊天验证' }));
    const chat = await until(b, (message) => message.type === 'chat' && message.line?.text === '校内服聊天验证');
    assert.equal(chat.line.name, 'NodeAlice');

    const joinAtGate = async (socket, x) => {
        const laneX = Math.max(SOUTH_GATE.x0, Math.min(SOUTH_GATE.x1, x));
        socket.send(JSON.stringify({ type: 'pose', pose: { p: [laneX, 0.92, SOUTH_GATE.line - 0.2], yaw: 0, pitch: 0 } }));
        socket.send(JSON.stringify({ type: 'joinRound' }));
        await until(socket, (message) => message.type === 'phaseChanged' && message.phase === 'playing');
    };
    await joinAtGate(a, -9.5);
    await joinAtGate(b, -7.5);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const aPos = [-18, 0.9, -3];
    const bPos = [-12, 0.9, -3];
    a.send(JSON.stringify({ type: 'pose', pose: { p: aPos, yaw: 0, pitch: 0 } }));
    b.send(JSON.stringify({ type: 'pose', pose: { p: bPos, yaw: 0, pitch: 0 } }));
    a.send(JSON.stringify({ type: 'ping', c: 1 }));
    const hasPose = (message, id) => message.type === 'snapshotFull'
        ? Boolean(message.poses?.[id])
        : message.type === 'snapshotDelta' && Boolean(message.updates?.[id]);
    const snapshotA = await until(a, (message) => hasPose(message, welcomeB.id));
    const snapshotB = await until(b, (message) => hasPose(message, welcomeA.id));
    assert.ok(snapshotA.type === 'snapshotFull' ? snapshotA.poses[welcomeB.id] : snapshotA.updates[welcomeB.id]);
    assert.ok(snapshotB.type === 'snapshotFull' ? snapshotB.poses[welcomeA.id] : snapshotB.updates[welcomeA.id]);
    a.send(JSON.stringify({ type: 'throw', throw: { id: 1, o: [-18, 1.5, -3], v: [15, 0, 0], tilt: 0 } }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    a.send(JSON.stringify({ type: 'hit', throwId: 1, target: welcomeB.id, at: [-12, 1.2, -3] }));
    const struck = await until(b, (message) => message.type === 'struck' && message.by === welcomeA.id);
    assert.equal(struck.hp, 2);
    for (const [throwId, hp] of [
        [2, 1],
        [3, 0]
    ]) {
        a.send(JSON.stringify({ type: 'throw', throw: { id: throwId, o: [-18, 1.5, -3], v: [15, 0, 0], tilt: 0 } }));
        await new Promise((resolve) => setTimeout(resolve, 410));
        a.send(JSON.stringify({ type: 'hit', throwId, target: welcomeB.id, at: [-12, 1.2, -3] }));
        const result = await until(b, (message) => message.type === 'struck' && message.by === welcomeA.id && message.hp === hp);
        assert.equal(result.out, hp === 0);
    }

    const rejected = await new Promise((resolve, reject) => {
        const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://evil.invalid' });
        bad.once('unexpected-response', (_request, response) => resolve(response.statusCode));
        bad.once('error', (error) => {
            if (error.message.includes('Unexpected server response: 403')) resolve(403);
            else reject(error);
        });
    });
    assert.equal(rejected, 403);
    a.close();
    b.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await server.close();
    server = await createCampusServer({ cwd: temp, config });
    await server.listen();
    const restarted = await fetch(`http://127.0.0.1:${server.httpServer.address().port}/api/me`, {
        headers: { authorization: `Bearer ${tokenA}` }
    });
    assert.equal(restarted.status, 200);
    assert.equal((await restarted.json()).account.name, 'NodeAlice');
});

test('Node campus WebSocket routes a prepared GLOBAL FINISHER and settles it once for every client', async (t) => {
    const temp = await mkdtemp(join(tmpdir(), 'moonshot-campus-finisher-'));
    const dist = join(temp, 'dist');
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, 'index.html'), '<html>campus</html>');
    const server = await createCampusServer({
        cwd: temp,
        config: {
            PORT: 0,
            HOST: '127.0.0.1',
            DATA_DIR: join(temp, 'data'),
            DIST_DIR: dist,
            ALLOWED_ORIGINS: '127.0.0.1,localhost'
        }
    });
    await server.listen();
    t.after(async () => {
        await server.close().catch(() => undefined);
        await rm(temp, { recursive: true, force: true });
    });
    const port = server.httpServer.address().port;
    const base = `http://127.0.0.1:${port}`;
    const tokenA = await auth(base, 'FinisherAlice');
    const tokenB = await auth(base, 'FinisherBob');
    const a = await connect(`ws://127.0.0.1:${port}/ws`, base);
    const b = await connect(`ws://127.0.0.1:${port}/ws`, base);
    t.after(() => {
        a.close();
        b.close();
    });
    a.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, name: 'A', token: tokenA, phase: 'lobby' }));
    b.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, name: 'B', token: tokenB, phase: 'lobby' }));
    await until(a, (message) => message.type === 'welcome');
    const welcomeB = await until(b, (message) => message.type === 'welcome');
    const joinRound = async (socket, x) => {
        socket.send(JSON.stringify({
            type: 'pose',
            pose: { p: [x, 0.92, SOUTH_GATE.line - 0.2], yaw: 0, pitch: 0 }
        }));
        socket.send(JSON.stringify({ type: 'joinRound' }));
        await until(socket, (message) => message.type === 'phaseChanged' && message.phase === 'playing');
    };
    await joinRound(a, -9.5);
    await joinRound(b, -7.5);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const attackerPose = { p: [-44, 0.92, 39.6], yaw: 90, pitch: 0 };
    const victimPose = { p: [-45, 0.92, 39.6], yaw: 90, pitch: 0 };
    a.send(JSON.stringify({ type: 'pose', pose: attackerPose }));
    b.send(JSON.stringify({ type: 'pose', pose: victimPose }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    a.send(JSON.stringify({ type: 'executionPrepare', target: welcomeB.id, requestId: 'campus-finisher' }));
    await until(a, (message) => message.type === 'executionPrepared' && message.requestId === 'campus-finisher');
    await new Promise((resolve) => setTimeout(resolve, 410));
    a.send(JSON.stringify({ type: 'executionCommit', requestId: 'campus-finisher' }));
    const startedA = await until(a, (message) => message.type === 'globalFinisherStarted');
    const startedB = await until(b, (message) => message.type === 'globalFinisherStarted');
    assert.equal(startedA.finisher.id, startedB.finisher.id);
    assert.equal(startedA.finisher.cinematicId, 'THE_BOOMERANG');
    const settled = await until(b, (message) => message.type === 'struck' && message.execution === true);
    assert.equal(settled.target, welcomeB.id);
    assert.equal(settled.out, true);
    assert.equal(b.messages.filter((message) => message.type === 'struck' && message.execution === true).length, 1);
});
