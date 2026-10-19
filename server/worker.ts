// Cloudflare Worker + Durable Object hosting the shared campus world. Every player joins the single room over a
// WebSocket at /ws; /api/* serves accounts (register, login, logout, me), the standing 淘汰王 and the lifetime board.
// Stored (Durable Object SQLite): usernames, salted PBKDF2 password hashes, sessions and lifetime stats. The live
// room (positions, chat) is memory only; no addresses are logged or stored.
// eslint-disable-next-line import-x/no-unresolved -- provided by the Workers runtime
import { DurableObject } from 'cloudflare:workers';

import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { GAME_TICK_HZ, parseClientMessage } from '../src/net/protocol.ts';
import type { ServerMessage } from '../src/net/protocol.ts';

import { sqlAccountDb } from './accountDb.ts';
import { Accounts } from './accounts.ts';
import { handleApi } from './api.ts';
import { originAllowed, requestOriginAllowed } from './originPolicy.ts';
import { isCriticalServerMessage, OutboundPolicy, SnapshotAcks, SnapshotDeltaPublisher } from './outboundPolicy.ts';
import { RealtimeMetrics } from './realtimeMetrics.ts';
import { Room } from './room.ts';

/** The single room instance. Renamed when an incompatible room must start fresh (v2: accounts and chat). */
const ROOM_NAME = 'campus-v2';

/** START_AMMO: local test rooms only (npm run server:dev) — lets browser tests throw repeatedly. */
type Env = {
    WORLD: DurableObjectNamespace<World>;
    ALLOWED_ORIGINS: string;
    START_AMMO?: string;
    COMBAT_TEST?: string;
    AVATARS?: R2Bucket;
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/health') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
        const origin = request.headers.get('Origin');
        const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
        const room = env.WORLD.get(env.WORLD.idFromName(ROOM_NAME));
        if (url.pathname.startsWith('/api/')) {
            const requestAllowed = requestOriginAllowed(request, env.ALLOWED_ORIGINS);
            const cors: Record<string, string> = allowed
                ? {
                      'access-control-allow-origin': origin!,
                      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
                      'access-control-allow-headers': 'content-type, authorization',
                      'access-control-max-age': '600',
                      vary: 'origin'
                  }
                : {};
            if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
            if (!requestAllowed) return new Response('Origin not allowed', { status: 403 });
            const response = await room.fetch(request);
            const headers = new Headers(response.headers);
            for (const [key, value] of Object.entries(cors)) headers.set(key, value);
            headers.set('cache-control', 'no-store');
            return new Response(response.body, { status: response.status, headers });
        }
        if (url.pathname !== '/ws') return new Response('Not found', { status: 404 });
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
        if (!allowed) return new Response('Origin not allowed', { status: 403 });
        return room.fetch(request);
    }
};

export class World extends DurableObject<Env> {
    private sockets = new Map<string, WebSocket>();
    private room: Room;
    private timer: ReturnType<typeof setInterval> | null = null;
    private counter = 0;
    private accounts: Accounts;
    private failures = new Map<string, number[]>();
    private readonly combatTestEnabled: boolean;
    private avatarUploads = new Map<string, number[]>();
    private metrics = new RealtimeMetrics();
    private outbound = new OutboundPolicy();
    private snapshotAcks = new SnapshotAcks();
    private snapshotPublisher = new SnapshotDeltaPublisher();
    private encoder = new TextEncoder();
    private nextMetricsLog = 0;
    private expectedTickAt = 0;
    private lastTickStarted = 0;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.combatTestEnabled = env.COMBAT_TEST === '1';
        const sql = new Proxy(ctx.storage.sql, {
            get: (target, property) => {
                const value = Reflect.get(target, property, target);
                if (property !== 'exec' || typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                    const started = performance.now();
                    try { return Reflect.apply(value, target, args); }
                    finally { this.metrics.observe('sqliteOperationMs', performance.now() - started); }
                };
            }
        });
        this.accounts = new Accounts(ctx.storage.transactionSync(() => sqlAccountDb(sql)));
        const send = (id: string, socket: WebSocket | undefined, message: ServerMessage, text?: string) => {
            if (!socket) return;
            const started = performance.now();
            let outgoing = message;
            if (message.type === 'snapshot') {
                const pressure = this.outbound.decide(id, message, (socket as WebSocket & { bufferedAmount?: number }).bufferedAmount ?? 0, Date.now());
                if (pressure === 'coalesce') {
                    this.metrics.increment('coalescedSnapshots');
                    return;
                }
                if (pressure === 'close') {
                    this.metrics.increment('slowConnections');
                    try { socket.close(1013, 'slow connection'); } catch { /* closed */ }
                    return;
                }
                const next = this.snapshotAcks.next(id, Date.now());
                if (next.type === 'coalesce') {
                    this.metrics.increment('coalescedSnapshots');
                    return;
                }
                if (next.type === 'close') {
                    this.metrics.increment('slowConnections');
                    try { socket.close(1013, 'slow connection'); } catch { /* closed */ }
                    return;
                }
                outgoing = this.snapshotPublisher.encode(id, message, next.seq, Date.now());
            }
            const encoded = text && message.type !== 'snapshot' ? text : JSON.stringify(outgoing);
            this.metrics.observe('snapshotSerializeMs', performance.now() - started);
            this.metrics.increment(message.type === 'snapshot' ? 'snapshots' : 'serverMessages');
            if (isCriticalServerMessage(message)) this.metrics.increment('criticalEvents');
            const bytes = this.encoder.encode(encoded).byteLength;
            this.metrics.observe('messageBytes', bytes);
            if (message.type === 'snapshot') this.metrics.observe('snapshotBytes', bytes);
            try {
                const sendStarted = performance.now();
                socket.send(encoded);
                this.metrics.observe('websocketSendCallMs', performance.now() - sendStarted);
                this.metrics.increment('outboundBytes', bytes);
            } catch {
                /* closed */
            }
        };
        this.room = new Room(
            {
                to: (id, message) => send(id, this.sockets.get(id), message),
                all: (message, except) => {
                    const text = message.type === 'snapshot' ? undefined : JSON.stringify(message);
                    for (const [id, socket] of this.sockets) {
                        if (id === except) continue;
                        send(id, socket, message, text);
                    }
                },
                close: (id) => {
                    try {
                        this.sockets.get(id)?.close(1008, 'rejected');
                    } catch {
                        /* closed */
                    }
                }
            },
            SPAWN_POINTS.length,
            this.accounts,
            Math.random,
            true
        );
        if (env.START_AMMO) this.room.startAmmo = Number(env.START_AMMO) || this.room.startAmmo;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) return this.api(request, url);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();
        const id = `${Date.now().toString(36)}${(this.counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        this.sockets.set(id, server);
        this.room.connect(id);
        let budget = 60;
        let budgetAt = Date.now();
        server.addEventListener('message', (event) => {
            // Simple flood guard: at most 60 messages per second per connection.
            const now = Date.now();
            if (now - budgetAt > 1000) {
                budget = 60;
                budgetAt = now;
            }
            if (--budget < 0) return;
            const text = typeof event.data === 'string' ? event.data : '';
            this.metrics.increment('inboundBytes', this.encoder.encode(text).byteLength);
            const message = parseClientMessage(text);
            if (message?.type === 'snapshotAck') {
                this.snapshotAcks.acknowledge(id, message.seq);
                this.snapshotPublisher.acknowledge(id, message.seq, now);
                return;
            }
            if (message?.type === 'snapshotResync') {
                this.snapshotAcks.resync(id);
                this.snapshotPublisher.resync(id);
                return;
            }
            if (message?.type === 'hello') {
                this.room.message(id, message, now);
                if (this.room.players.has(id)) {
                    this.snapshotPublisher.register(id, message.capabilities?.snapshotAck === true && message.capabilities.snapshotDelta === true);
                }
                return;
            }
            this.room.message(id, message, now);
        });
        const drop = (reason: string) => {
            if (!this.sockets.delete(id)) return;
            this.metrics.increment(`disconnect.${reason}`);
            this.outbound.forget(id);
            this.snapshotAcks.forget(id);
            this.snapshotPublisher.forget(id);
            this.room.disconnect(id);
            if (!this.sockets.size && this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        };
        server.addEventListener('close', (event) => drop(`close${event.code}`));
        server.addEventListener('error', () => drop('error'));
        if (!this.timer) {
            const interval = 1000 / GAME_TICK_HZ;
            this.expectedTickAt = performance.now() + interval;
            this.timer = setInterval(() => {
                const started = performance.now();
                if (this.lastTickStarted) this.metrics.observe('tickFrequencyHz', 1000 / (started - this.lastTickStarted));
                this.lastTickStarted = started;
                this.metrics.observe('tickDriftMs', started - this.expectedTickAt);
                this.expectedTickAt = started + interval;
                this.room.tick(Date.now());
                this.metrics.observe('roomTickMs', performance.now() - started);
                if (Date.now() >= this.nextMetricsLog) {
                    this.nextMetricsLog = Date.now() + 60_000;
                    console.log(JSON.stringify({ event: 'realtime-metrics', runtime: 'cloudflare', activeSockets: this.sockets.size, players: this.room.online, unavailable: ['eventLoop', 'socketWritableBuffer'], ...this.metrics.snapshot() }));
                }
            }, interval);
        }
        return new Response(null, { status: 101, webSocket: client });
    }

    private async api(request: Request, url: URL): Promise<Response> {
        const avatarBucket = this.env.AVATARS;
        const avatars = avatarBucket
            ? {
                  get: async (key: string) => {
                      const object = await avatarBucket.get(key);
                      return object ? new Uint8Array(await object.arrayBuffer()) : null;
                  },
                  put: async (key: string, bytes: Uint8Array) => {
                      await avatarBucket.put(key, bytes, {
                          httpMetadata: {
                              contentType: 'image/webp',
                              cacheControl: 'public, max-age=31536000, immutable'
                          }
                      });
                  },
                  delete: async (key: string) => {
                      await avatarBucket.delete(key);
                  }
              }
            : null;
        return handleApi(request, url, {
            accounts: this.accounts,
            room: this.room,
            avatars,
            clientAddress: request.headers.get('cf-connecting-ip') ?? 'unknown',
            combatTestEnabled: this.combatTestEnabled,
            failures: this.failures,
            avatarUploads: this.avatarUploads
        });
    }
}
