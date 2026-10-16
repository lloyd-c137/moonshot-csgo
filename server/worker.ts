// Cloudflare Worker + Durable Object hosting the shared campus world. Every player joins the single room over a
// WebSocket at /ws; /api/* serves accounts (register, login, logout, me), the standing 淘汰王 and the lifetime board.
// Stored (Durable Object SQLite): usernames, salted PBKDF2 password hashes, sessions and lifetime stats. The live
// room (positions, chat) is memory only; no addresses are logged or stored.
// eslint-disable-next-line import-x/no-unresolved -- provided by the Workers runtime
import { DurableObject } from 'cloudflare:workers';

import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { parseClientMessage, SNAPSHOT_HZ } from '../src/net/protocol.ts';
import type { ServerMessage } from '../src/net/protocol.ts';

import { sqlAccountDb } from './accountDb.ts';
import { Accounts } from './accounts.ts';
import { Room } from './room.ts';

/** The single room instance. Renamed when an incompatible room must start fresh (v2: accounts and chat). */
const ROOM_NAME = 'campus-v2';

/** START_AMMO: local test rooms only (npm run server:dev) — lets browser tests throw repeatedly. */
type Env = { WORLD: DurableObjectNamespace<World>; ALLOWED_ORIGINS: string; START_AMMO?: string };

const originAllowed = (origin: string | null, allowed: string) => {
    if (!origin) return false;
    let host: string;
    try {
        host = new URL(origin).hostname;
    } catch {
        return false;
    }
    return allowed.split(',').some((pattern) => {
        const rule = pattern.trim();
        if (rule.startsWith('*.')) return host.endsWith(rule.slice(1)) || host === rule.slice(2);
        return host === rule;
    });
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/health') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
        const origin = request.headers.get('Origin');
        const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
        const room = env.WORLD.get(env.WORLD.idFromName(ROOM_NAME));
        if (url.pathname.startsWith('/api/')) {
            const cors: Record<string, string> = allowed
                ? {
                      'access-control-allow-origin': origin!,
                      'access-control-allow-methods': 'GET, POST, OPTIONS',
                      'access-control-allow-headers': 'content-type, authorization',
                      'access-control-max-age': '600',
                      vary: 'origin'
                  }
                : {};
            if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
            if (!allowed) return new Response('Origin not allowed', { status: 403 });
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

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.accounts = new Accounts(sqlAccountDb(ctx.storage.sql));
        const send = (socket: WebSocket | undefined, message: ServerMessage) => {
            try {
                socket?.send(JSON.stringify(message));
            } catch {
                /* closed */
            }
        };
        this.room = new Room(
            {
                to: (id, message) => send(this.sockets.get(id), message),
                all: (message, except) => {
                    const text = JSON.stringify(message);
                    for (const [id, socket] of this.sockets) {
                        if (id === except) continue;
                        try {
                            socket.send(text);
                        } catch {
                            /* closed */
                        }
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
            this.accounts
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
            this.room.message(id, parseClientMessage(text), now);
        });
        const drop = () => {
            if (!this.sockets.delete(id)) return;
            this.room.disconnect(id);
            if (!this.sockets.size && this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        };
        server.addEventListener('close', drop);
        server.addEventListener('error', drop);
        if (!this.timer) this.timer = setInterval(() => this.room.tick(Date.now()), 1000 / SNAPSHOT_HZ);
        return new Response(null, { status: 101, webSocket: client });
    }

    private async api(request: Request, url: URL): Promise<Response> {
        const json = (value: unknown, status = 200) =>
            new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
        const now = Date.now();
        const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
        switch (`${request.method} ${url.pathname}`) {
            case 'GET /api/king':
                return json({ king: this.accounts.king(), online: this.room.online });
            case 'GET /api/leaderboard':
                return json({
                    king: this.accounts.king(),
                    top: this.accounts.leaderboard(10),
                    online: this.room.online
                });
            case 'GET /api/me': {
                const account = this.accounts.resolve(bearer, now);
                return account ? json({ account }) : json({ error: '登录已过期，请重新登录' }, 401);
            }
            case 'POST /api/logout':
                this.accounts.logout(bearer);
                return json({ ok: true });
            case 'POST /api/signin':
            case 'POST /api/register':
            case 'POST /api/login': {
                // Brute-force guard: at most 10 failed attempts per address per 10 minutes (memory only).
                const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
                const recent = (this.failures.get(address) ?? []).filter((t) => now - t < 600_000);
                if (recent.length >= 10) return json({ error: '尝试次数过多，请稍后再试' }, 429);
                let body: { name?: unknown; password?: unknown };
                try {
                    body = (await request.json()) as typeof body;
                } catch {
                    return json({ error: '请求格式不正确' }, 400);
                }
                const kind = url.pathname.slice('/api/'.length);
                const result =
                    kind === 'signin'
                        ? await this.accounts.signIn(body.name, body.password, now)
                        : kind === 'register'
                          ? await this.accounts.register(body.name, body.password, now)
                          : await this.accounts.login(body.name, body.password, now);
                if (!result.ok) {
                    recent.push(now);
                    this.failures.set(address, recent);
                    return json({ error: result.error }, kind === 'login' ? 401 : 400);
                }
                this.failures.delete(address);
                return json({ token: result.token, account: result.account, created: !!result.created });
            }
            default:
                return json({ error: 'not found' }, 404);
        }
    }
}
