import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { SPAWN_POINTS } from '../../src/config/spawns.ts';
import { parseClientMessage, SNAPSHOT_HZ } from '../../src/net/protocol.ts';
import type { ServerMessage } from '../../src/net/protocol.ts';
import { sqlAccountDb } from '../accountDb.ts';
import { Accounts } from '../accounts.ts';
import { handleApi } from '../api.ts';
import { originAllowed, requestOriginAllowed } from '../originPolicy.ts';
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

const staticResponse = async (request: IncomingMessage, url: URL, root: string) => {
    let requested: string;
    try {
        requested = decodeURIComponent(url.pathname);
    } catch {
        return new Response('Bad Request', { status: 400 });
    }
    if (requested.includes('\\') || requested.split('/').includes('..')) return new Response('Forbidden', { status: 403 });
    const rootReal = await realpath(root);
    const candidate = resolve(rootReal, `.${requested}`);
    const relativePath = relative(rootReal, candidate);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
        return new Response('Forbidden', { status: 403 });
    let filename = candidate;
    try {
        if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html');
        await stat(filename);
        const realFile = await realpath(filename);
        const rel = relative(rootReal, realFile);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return new Response('Forbidden', { status: 403 });
        filename = realFile;
    } catch {
        filename = resolve(rootReal, 'index.html');
        try {
            await stat(filename);
        } catch {
            return new Response('Not Found', { status: 404 });
        }
    }
    const extension = extname(filename).toLowerCase();
    const contentType = filename.endsWith('.glb.gz') ? 'application/gzip' : (MIME[extension] ?? 'application/octet-stream');
    const rel = relative(rootReal, filename).split(sep).join('/');
    const headers = new Headers({
        'content-type': contentType,
        'cache-control': rel.startsWith('build/')
            ? 'public, max-age=31536000, immutable'
            : /^(assets\/(audio|ui|branding)\/|ammo\/)/.test(rel)
              ? 'public, max-age=86400'
              : 'no-cache'
    });
    let bytes = new Uint8Array(await readFile(filename));
    const acceptEncoding = request.headers['accept-encoding'] ?? '';
    if (COMPRESSIBLE.has(extension) && typeof acceptEncoding === 'string') {
        if (/\bbr\b/.test(acceptEncoding)) {
            bytes = new Uint8Array(brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } }));
            headers.set('content-encoding', 'br');
            headers.set('vary', 'Accept-Encoding');
        } else if (/\bgzip\b/.test(acceptEncoding)) {
            bytes = new Uint8Array(gzipSync(bytes));
            headers.set('content-encoding', 'gzip');
            headers.set('vary', 'Accept-Encoding');
        }
    }
    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(bytes, { headers });
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
    const { database, storage } = openAccountDatabase(databasePath);
    let accounts: Accounts;
    try {
        accounts = inTransaction(database, () => new Accounts(sqlAccountDb(storage)));
    } catch (error) {
        database.close();
        throw error;
    }
    const avatarStore = new FileAvatarStore(config.DATA_DIR);
    const sockets = new Map<string, WebSocket>();
    let timer: NodeJS.Timeout | null = null;
    let counter = 0;
    const send = (socket: WebSocket | undefined, message: ServerMessage) => {
        if (!socket?.readyState) return;
        try {
            socket.send(JSON.stringify(message));
        } catch {
            // The connection closed between a room event and send.
        }
    };
    const room = new Room(
        {
            to: (id, message) => send(sockets.get(id), message),
            all: (message, except) => {
                const text = JSON.stringify(message);
                for (const [id, socket] of sockets) {
                    if (id === except || socket.readyState !== 1) continue;
                    try {
                        socket.send(text);
                    } catch {
                        // The connection closed between a room event and send.
                    }
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
            if (url.pathname === '/health') {
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
            const response = await staticResponse(incoming, url, config.DIST_DIR);
            const headers = Object.fromEntries(response.headers.entries());
            outgoing.writeHead(response.status, headers);
            outgoing.end(new Uint8Array(await response.arrayBuffer()));
        } catch (error) {
            const status = (error as Error).message === 'Request body too large' ? 413 : 500;
            outgoing.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
            outgoing.end(status === 413 ? 'Payload Too Large' : 'Internal Server Error');
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
            room.message(id, parseClientMessage(isBinary ? '' : data.toString()), now);
        });
        const drop = () => {
            if (!sockets.delete(id)) return;
            room.disconnect(id);
            if (!sockets.size && timer) {
                clearInterval(timer);
                timer = null;
            }
        };
        socket.on('close', drop);
        socket.on('error', drop);
        if (!timer) timer = setInterval(() => room.tick(Date.now()), 1000 / SNAPSHOT_HZ);
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
    };
    return { httpServer, webSockets, room, accounts, database, config, listen, close };
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
