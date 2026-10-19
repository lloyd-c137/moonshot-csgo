import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { PerformanceObserver, performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { SPAWN_POINTS } from '../../src/config/spawns.ts';
import { GAME_TICK_HZ, parseClientMessage } from '../../src/net/protocol.ts';
import type { ServerMessage } from '../../src/net/protocol.ts';
import { sqlAccountDb } from '../accountDb.ts';
import { Accounts } from '../accounts.ts';
import { handleApi } from '../api.ts';
import { originAllowed, requestOriginAllowed } from '../originPolicy.ts';
import { isCriticalServerMessage, OutboundPolicy, SnapshotAcks, SnapshotDeltaPublisher } from '../outboundPolicy.ts';
import { RealtimeMetrics } from '../realtimeMetrics.ts';
import { Room } from '../room.ts';

import { FileAvatarStore } from './avatars.ts';
import { inTransaction, openAccountDatabase } from './sqlite.ts';

type CampusConfig = {
    PORT: number;
    HOST: string;
    DATA_DIR: string;
    DIST_DIR: string;
    ALLOWED_ORIGINS: string;
    COMBAT_TEST: boolean;
    START_AMMO: number | null;
};

const DEFAULTS = {
    PORT: 8000,
    HOST: '0.0.0.0',
    ALLOWED_ORIGINS: '172.10.17.186,localhost,127.0.0.1'
} as const;
const MIME: Record<string, string> = {
    '.avif': 'image/avif',
    '.css': 'text/css; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gz': 'application/gzip',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};
const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.wasm', '.svg', '.html']);

const readConfig = async (cwd: string, overrides: Partial<CampusConfig> = {}): Promise<CampusConfig> => {
    let file: Record<string, unknown> = {};
    try {
        file = JSON.parse(await readFile(resolve(cwd, 'config.json'), 'utf8')) as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const value = (key: keyof CampusConfig) => overrides[key] ?? process.env[key] ?? file[key];
    const port = Number(value('PORT') ?? DEFAULTS.PORT);
    const startAmmoValue = value('START_AMMO');
    const dataDir = String(value('DATA_DIR') ?? resolve(cwd, 'data'));
    const distDir = String(value('DIST_DIR') ?? resolve(cwd, 'dist'));
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');
    if (!dataDir || !distDir) throw new Error('DATA_DIR and DIST_DIR are required');
    return {
        PORT: port,
        HOST: String(value('HOST') ?? DEFAULTS.HOST),
        DATA_DIR: resolve(cwd, dataDir),
        DIST_DIR: resolve(cwd, distDir),
        ALLOWED_ORIGINS: String(value('ALLOWED_ORIGINS') ?? DEFAULTS.ALLOWED_ORIGINS),
        COMBAT_TEST: value('COMBAT_TEST') === true || value('COMBAT_TEST') === '1',
        START_AMMO: startAmmoValue === undefined || startAmmoValue === null || startAmmoValue === ''
            ? null
            : Math.max(0, Math.min(99, Math.floor(Number(startAmmoValue) || 0)))
    };
};

const staticAsset = async (request: IncomingMessage, url: URL, root: string) => {
    const lookupStarted = performance.now();
    let requested: string;
    try {
        requested = decodeURIComponent(url.pathname);
    } catch {
        return { status: 400, headers: new Headers(), filename: null as string | null };
    }
    if (requested.includes('\\') || requested.split('/').includes('..'))
        return { status: 403, headers: new Headers(), filename: null as string | null };
    const rootReal = await realpath(root);
    const candidate = resolve(rootReal, `.${requested}`);
    const relativePath = relative(rootReal, candidate);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
        return { status: 403, headers: new Headers(), filename: null as string | null };
    let filename = candidate;
    try {
        if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html');
        const realFile = await realpath(filename);
        const rel = relative(rootReal, realFile);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
            return { status: 403, headers: new Headers(), filename: null as string | null };
        filename = realFile;
    } catch {
        filename = resolve(rootReal, 'index.html');
        try {
            await realpath(filename);
        } catch {
            return { status: 404, headers: new Headers(), filename: null as string | null };
        }
    }
    const rel = relative(rootReal, filename).split(sep).join('/');
    const extension = extname(filename).toLowerCase();
    const originalType = filename.endsWith('.glb.gz') ? 'application/gzip' : (MIME[extension] ?? 'application/octet-stream');
    let encoding: 'br' | 'gzip' | null = null;
    if (COMPRESSIBLE.has(extension)) {
        const accept = String(request.headers['accept-encoding'] ?? '');
        const variants: ['br' | 'gzip', string][] = [['br', `${filename}.br`], ['gzip', `${filename}.gz`]];
        for (const [candidateEncoding, candidate] of variants) {
            if (!new RegExp(`(?:^|,)\\s*${candidateEncoding}(?:\\s*;\\s*q=(?!0(?:\\.0*)?)[0-9.]+)?(?:\\s*,|$)`, 'i').test(accept)) continue;
            try {
                const realCandidate = await realpath(candidate);
                const candidateStat = await stat(realCandidate);
                const inside = relative(rootReal, realCandidate);
                if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || !candidateStat.isFile()) continue;
                filename = realCandidate;
                encoding = candidateEncoding;
                break;
            } catch {
                // A normal build without a precompressed sidecar remains serveable.
            }
        }
    }
    const fileStat = await stat(filename);
    const etag = `W/"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}-${encoding ?? 'identity'}"`;
    const headers = new Headers({
        'content-type': originalType,
        'cache-control': rel.startsWith('build/')
            ? 'public, max-age=31536000, immutable'
            : /^(assets\/(audio|ui|branding)\/|ammo\/)/.test(rel)
              ? 'public, max-age=86400'
              : 'no-cache',
        etag,
        'content-length': String(fileStat.size)
    });
    if (COMPRESSIBLE.has(extension)) headers.set('vary', 'Accept-Encoding');
    if (encoding) headers.set('content-encoding', encoding);
    return { status: 200, headers, filename, lookupMs: performance.now() - lookupStarted };
};

const requestBody = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > 1_000_000) throw new Error('Request body too large');
        chunks.push(bytes);
    }
    return Buffer.concat(chunks);
};

export const createCampusServer = async (options: { cwd?: string; config?: Partial<CampusConfig> } = {}) => {
    const cwd = resolve(options.cwd ?? process.cwd());
    const config = await readConfig(cwd, options.config);
    await mkdir(config.DATA_DIR, { recursive: true });
    const databasePath = resolve(config.DATA_DIR, 'campus.sqlite');
    const metrics = new RealtimeMetrics();
    const eventLoop = monitorEventLoopDelay({ resolution: 20 });
    eventLoop.enable();
    let lastElu = performance.eventLoopUtilization();
    let lastCpu = process.cpuUsage();
    const gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.observe('gcDurationMs', entry.duration);
    });
    gcObserver.observe({ entryTypes: ['gc'] });
    const { database, storage } = openAccountDatabase(databasePath, (name, ms) => metrics.observe(name, ms));
    let accounts: Accounts;
    try {
        accounts = inTransaction(database, () => new Accounts(sqlAccountDb(storage)), (name, ms) => metrics.observe(name, ms));
    } catch (error) {
        database.close();
        throw error;
    }
    const avatarStore = new FileAvatarStore(config.DATA_DIR);
    const sockets = new Map<string, WebSocket>();
    let timer: NodeJS.Timeout | null = null;
    let counter = 0;
    const outbound = new OutboundPolicy();
    const snapshotAcks = new SnapshotAcks();
    const snapshotPublisher = new SnapshotDeltaPublisher();
    const connectionStats = new Map<string, { sentBytes: number; frames: number; maxBufferedBytes: number }>();
    const recentConnectionStats: { sentBytes: number; frames: number; maxBufferedBytes: number; reason: string }[] = [];
    const rememberConnectionEnd = (id: string, reason: string) => {
        const stats = connectionStats.get(id);
        if (!stats) return;
        recentConnectionStats.push({ ...stats, reason });
        if (recentConnectionStats.length > 32) recentConnectionStats.shift();
        connectionStats.delete(id);
    };
    const send = (id: string, socket: WebSocket | undefined, message: ServerMessage, serialized?: string) => {
        if (!socket?.readyState) return;
        const start = performance.now();
        let outgoing = message;
        let reservedSeq: number | null = null;
        if (message.type === 'snapshot') {
            metrics.observe('websocketBufferedBytes', socket.bufferedAmount);
            const pressure = outbound.decide(id, message, socket.bufferedAmount, Date.now());
            if (pressure === 'coalesce') {
                metrics.increment('coalescedSnapshots');
                return;
            }
            if (pressure === 'close') {
                metrics.increment('slowConnections');
                rememberConnectionEnd(id, 'slow-buffer');
                socket.close(1013, 'slow connection');
                return;
            }
            const next = snapshotAcks.next(id, Date.now());
            if (next.type === 'coalesce') {
                metrics.increment('coalescedSnapshots');
                return;
            }
            if (next.type === 'close') {
                metrics.increment('slowConnections');
                rememberConnectionEnd(id, 'slow-ack-timeout');
                socket.close(1013, 'slow connection');
                return;
            }
            reservedSeq = next.seq;
            outgoing = snapshotPublisher.encode(id, message, next.seq, Date.now());
        }
        const text = serialized && message.type !== 'snapshot' ? serialized : JSON.stringify(outgoing);
        const bytes = Buffer.byteLength(text);
        metrics.observe('snapshotSerializeMs', performance.now() - start);
        metrics.observe('messageBytes', bytes);
        if (message.type === 'snapshot') metrics.observe('snapshotBytes', bytes);
        if (message.type !== 'snapshot' && outbound.decide(id, message, socket.bufferedAmount, Date.now()) === 'close') {
            metrics.increment('slowConnections');
            rememberConnectionEnd(id, 'slow-buffer');
            socket.close(1013, 'slow connection');
            return;
        }
        try {
            const sendStarted = performance.now();
            socket.send(text);
            if (reservedSeq !== null) {
                snapshotAcks.commit(id, reservedSeq, Date.now());
                snapshotPublisher.commit(id, reservedSeq);
            }
            metrics.observe('websocketSendCallMs', performance.now() - sendStarted);
            metrics.increment('outboundBytes', bytes);
            const stat = connectionStats.get(id);
            if (stat) {
                stat.sentBytes += bytes;
                stat.frames++;
                stat.maxBufferedBytes = Math.max(stat.maxBufferedBytes, socket.bufferedAmount);
            }
            metrics.increment(message.type === 'snapshot' || message.type === 'snapshotFull' || message.type === 'snapshotDelta' ? 'snapshots' : 'serverMessages');
            if (isCriticalServerMessage(message)) metrics.increment('criticalEvents');
        } catch {
            if (reservedSeq !== null) {
                snapshotAcks.abort(id, reservedSeq);
                snapshotPublisher.abort(id, reservedSeq);
            }
            // The connection closed between a room event and send.
        }
    };
    const room = new Room(
        {
            to: (id, message) => send(id, sockets.get(id), message),
            all: (message, except) => {
                const text = JSON.stringify(message);
                for (const [id, socket] of sockets) {
                    if (id === except || socket.readyState !== 1) continue;
                    send(id, socket, message, text);
                }
            },
            close: (id) => sockets.get(id)?.close(1008, 'rejected')
        },
        SPAWN_POINTS.length,
        accounts,
        Math.random,
        true
    );
    if (config.COMBAT_TEST && config.START_AMMO !== null) room.startAmmo = config.START_AMMO || room.startAmmo;
    const failures = new Map<string, number[]>();
    const avatarUploads = new Map<string, number[]>();
    const httpServer = createServer(async (incoming, outgoing) => {
        try {
            const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host ?? 'localhost'}`);
            const requestStarted = performance.now();
            if (url.pathname === '/health') {
                metrics.increment('httpRequests');
                metrics.observe('httpRequestMs', performance.now() - requestStarted);
                outgoing.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
                outgoing.end('ok');
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                const origin = incoming.headers.origin ?? null;
                const allowed = originAllowed(origin, config.ALLOWED_ORIGINS);
                const request = new Request(url, {
                    method: incoming.method ?? 'GET',
                    headers: incoming.headers as HeadersInit,
                    ...(['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? {} : { body: new Uint8Array(await requestBody(incoming)) })
                });
                const cors: Record<string, string> = allowed
                    ? {
                          'access-control-allow-origin': origin!,
                          'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
                          'access-control-allow-headers': 'content-type, authorization',
                          'access-control-max-age': '600',
                          vary: 'origin'
                      }
                    : {};
                if (request.method === 'OPTIONS') {
                    outgoing.writeHead(allowed ? 204 : 403, cors);
                    outgoing.end();
                    return;
                }
                if (!requestOriginAllowed(request, config.ALLOWED_ORIGINS)) {
                    outgoing.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
                    outgoing.end('Origin not allowed');
                    return;
                }
                const response = await handleApi(request, url, {
                    accounts,
                    room,
                    avatars: avatarStore,
                    clientAddress: incoming.socket.remoteAddress ?? 'unknown',
                    combatTestEnabled: config.COMBAT_TEST,
                    failures,
                    avatarUploads
                });
                const headers = Object.fromEntries(response.headers.entries());
                Object.assign(headers, cors, { 'cache-control': 'no-store' });
                outgoing.writeHead(response.status, headers);
                outgoing.end(new Uint8Array(await response.arrayBuffer()));
                metrics.increment('httpRequests');
                metrics.observe('httpRequestMs', performance.now() - requestStarted);
                return;
            }
            if (url.pathname === '/ws') {
                outgoing.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
                outgoing.end('Expected WebSocket');
                return;
            }
            if (!['GET', 'HEAD'].includes(incoming.method ?? 'GET')) {
                outgoing.writeHead(405, { allow: 'GET, HEAD' });
                outgoing.end();
                return;
            }
            const asset = await staticAsset(incoming, url, config.DIST_DIR);
            metrics.observe('staticLookupMs', asset.lookupMs ?? performance.now() - requestStarted);
            if (asset.status === 200 && incoming.headers['if-none-match'] === asset.headers.get('etag')) {
                outgoing.writeHead(304, Object.fromEntries(asset.headers.entries()));
                outgoing.end();
                metrics.increment('staticNotModified');
            } else {
                outgoing.writeHead(asset.status, Object.fromEntries(asset.headers.entries()));
                if (incoming.method === 'HEAD' || asset.status !== 200 || !asset.filename) outgoing.end();
                else {
                    const streamStarted = performance.now();
                    const stream = createReadStream(asset.filename);
                    stream.on('error', () => outgoing.destroy());
                    stream.once('data', () => metrics.observe('staticFirstByteMs', performance.now() - streamStarted));
                    stream.on('end', () => metrics.observe('staticTransferMs', performance.now() - streamStarted));
                    stream.pipe(outgoing);
                }
            }
            metrics.increment('httpRequests');
            metrics.observe('httpRequestMs', performance.now() - requestStarted);
        } catch (error) {
            const status = (error as Error).message === 'Request body too large' ? 413 : 500;
            outgoing.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
            outgoing.end(status === 413 ? 'Payload Too Large' : 'Internal Server Error');
            metrics.increment('httpErrors');
            if (status === 500) console.error('Request failed');
        }
    });
    const webSockets = new WebSocketServer({ noServer: true, maxPayload: 2048 });
    httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        if (url.pathname !== '/ws') {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }
        if (!originAllowed(request.headers.origin ?? null, config.ALLOWED_ORIGINS)) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nOrigin not allowed');
            socket.destroy();
            return;
        }
        webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit('connection', webSocket, request));
    });
    webSockets.on('connection', (socket) => {
        const id = `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        sockets.set(id, socket);
        connectionStats.set(id, { sentBytes: 0, frames: 0, maxBufferedBytes: socket.bufferedAmount });
        room.connect(id);
        let budget = 60;
        let budgetAt = Date.now();
        socket.on('message', (data, isBinary) => {
            const now = Date.now();
            if (now - budgetAt > 1000) {
                budget = 60;
                budgetAt = now;
            }
            if (--budget < 0) return;
            const inboundBytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
            metrics.increment('inboundBytes', inboundBytes);
            const message = parseClientMessage(isBinary ? '' : data.toString());
            if (message?.type === 'snapshotAck') {
                if (snapshotAcks.acknowledge(id, message.seq, now, message.epoch)) {
                    snapshotPublisher.acknowledge(id, message.epoch, message.seq, now);
                }
                return;
            }
            if (message?.type === 'snapshotResync') {
                const epoch = snapshotPublisher.resync(id);
                if (epoch !== null) snapshotAcks.resync(id, epoch);
                return;
            }
            if (message?.type === 'hello') {
                room.message(id, message, now);
                if (room.players.has(id)) {
                    const ackEnabled = message.capabilities?.snapshotAck === true;
                    const deltaEnabled = ackEnabled && message.capabilities?.snapshotDelta === true;
                    const epoch = snapshotPublisher.register(id, deltaEnabled);
                    snapshotAcks.register(id, ackEnabled, epoch);
                }
                return;
            }
            room.message(id, message, now);
        });
        const drop = (reason: string) => {
            if (!sockets.delete(id)) return;
            metrics.increment(`disconnect.${reason}`);
            outbound.forget(id);
            snapshotAcks.forget(id);
            snapshotPublisher.forget(id);
            rememberConnectionEnd(id, reason);
            room.disconnect(id);
            if (!sockets.size && timer) {
                clearInterval(timer);
                timer = null;
            }
        };
        socket.on('close', (code) => drop(`close${code}`));
        socket.on('error', () => drop('error'));
        if (!timer) {
            const interval = 1000 / GAME_TICK_HZ;
            let expectedTickAt = performance.now() + interval;
            let lastTickStarted = 0;
            let nextReportAt = Date.now() + 60_000;
            timer = setInterval(() => {
                const started = performance.now();
                if (lastTickStarted) metrics.observe('tickFrequencyHz', 1000 / (started - lastTickStarted));
                lastTickStarted = started;
                metrics.observe('tickDriftMs', started - expectedTickAt);
                expectedTickAt = started + interval;
                room.tick(Date.now());
                metrics.observe('roomTickMs', performance.now() - started);
                if (Date.now() >= nextReportAt) {
                    nextReportAt = Date.now() + 60_000;
                    const elu = performance.eventLoopUtilization(lastElu);
                    const cpu = process.cpuUsage(lastCpu);
                    metrics.observe('eventLoopUtilization', elu.utilization);
                    metrics.observe('cpuMsPerMinute', (cpu.user + cpu.system) / 1000);
                    metrics.observe('rssBytes', process.memoryUsage().rss);
                    metrics.observe('heapUsedBytes', process.memoryUsage().heapUsed);
                    metrics.observe('eventLoopDelayP95Ms', eventLoop.percentile(95) / 1e6);
                    metrics.observe('eventLoopDelayMaxMs', eventLoop.max / 1e6);
                    console.log(JSON.stringify({ event: 'realtime-metrics', runtime: 'node', activeSockets: sockets.size, players: room.online, ...metrics.snapshot() }));
                    eventLoop.reset();
                    lastElu = performance.eventLoopUtilization();
                    lastCpu = process.cpuUsage();
                }
            }, interval);
        }
    });
    const listen = () => new Promise<void>((resolveListen, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.PORT, config.HOST, () => {
            httpServer.off('error', reject);
            resolveListen();
        });
    });
    const close = async () => {
        if (timer) clearInterval(timer);
        timer = null;
        for (const socket of webSockets.clients) socket.close(1001, 'server shutdown');
        await new Promise<void>((resolveClose) => webSockets.close(() => resolveClose()));
        await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()));
        database.close();
        eventLoop.disable();
        gcObserver.disconnect();
    };
    return {
        httpServer, webSockets, room, accounts, database, config, metrics, listen, close,
        connectionDiagnostics: () => ({
            active: Array.from(connectionStats.values(), (value) => ({ ...value })),
            recent: recentConnectionStats.map((value) => ({ ...value }))
        }),
        realtimeDiagnostics: () => {
            const elu = performance.eventLoopUtilization(lastElu);
            return {
                metrics: metrics.snapshot(),
                eventLoopDelayP95Ms: eventLoop.percentile(95) / 1e6,
                eventLoopDelayMaxMs: eventLoop.max / 1e6,
                eventLoopUtilization: elu.utilization
            };
        }
    };
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const server = await createCampusServer();
    await server.listen();
    console.log(`Moonshot Campus Server ready on port ${server.config.PORT}`);
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        void server.close().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
