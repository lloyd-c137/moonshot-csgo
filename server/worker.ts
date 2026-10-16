// Cloudflare Worker + Durable Object hosting the shared campus world. Every player joins the single room over a
// WebSocket at /ws; /api/* serves accounts (register, login, logout, me), the standing 淘汰王 and the lifetime board.
// Stored (Durable Object SQLite): usernames, salted PBKDF2 password hashes, sessions and lifetime stats. The live
// room (positions, chat) is memory only; no addresses are logged or stored.
// eslint-disable-next-line import-x/no-unresolved -- provided by the Workers runtime
import { DurableObject } from 'cloudflare:workers';

import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { parseClientMessage, SNAPSHOT_HZ } from '../src/net/protocol.ts';
import type { ServerMessage } from '../src/net/protocol.ts';

import type { AccountDb, UserRow } from './accounts.ts';
import { Accounts } from './accounts.ts';
import { Room } from './room.ts';

/** The single room instance. Renamed when an incompatible room must start fresh (v2: accounts and chat). */
const ROOM_NAME = 'campus-v2';

type Env = { WORLD: DurableObjectNamespace<World>; ALLOWED_ORIGINS: string };

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
                const result = url.pathname.endsWith('register')
                    ? await this.accounts.register(body.name, body.password, now)
                    : await this.accounts.login(body.name, body.password, now);
                if (!result.ok) {
                    recent.push(now);
                    this.failures.set(address, recent);
                    return json({ error: result.error }, url.pathname.endsWith('register') ? 400 : 401);
                }
                this.failures.delete(address);
                return json({ token: result.token, account: result.account });
            }
            default:
                return json({ error: 'not found' }, 404);
        }
    }
}

/** AccountDb on Durable Object SQLite. */
const sqlAccountDb = (sql: SqlStorage): AccountDb => {
    sql.exec(`CREATE TABLE IF NOT EXISTS users (
        key TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
        kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`);
    sql.exec('CREATE INDEX IF NOT EXISTS users_kills ON users (kills DESC, score DESC)');
    sql.exec(
        'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, key TEXT NOT NULL, expires INTEGER NOT NULL)'
    );
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const one = <T>(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>) => {
        const rows = cursor.toArray();
        return (rows[0] as T | undefined) ?? null;
    };
    return {
        findUser: (key) => one<UserRow>(sql.exec('SELECT * FROM users WHERE key = ?', key)),
        insertUser: (row) =>
            void sql.exec(
                'INSERT INTO users (key, name, salt, hash, kills, deaths, hits, score, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                row.key,
                row.name,
                row.salt,
                row.hash,
                row.kills,
                row.deaths,
                row.hits,
                row.score,
                row.created
            ),
        addStats: (key, d) =>
            void sql.exec(
                'UPDATE users SET kills = kills + ?, deaths = deaths + ?, hits = hits + ?, score = score + ? WHERE key = ?',
                d.kills,
                d.deaths,
                d.hits,
                d.score,
                key
            ),
        insertSession: (token, key, expires) =>
            void sql.exec('INSERT INTO sessions (token, key, expires) VALUES (?, ?, ?)', token, key, expires),
        findSession: (token) =>
            one<{ key: string; expires: number }>(sql.exec('SELECT key, expires FROM sessions WHERE token = ?', token)),
        deleteSession: (token) => void sql.exec('DELETE FROM sessions WHERE token = ?', token),
        getMeta: (key) => one<{ value: string }>(sql.exec('SELECT value FROM meta WHERE key = ?', key))?.value ?? null,
        setMeta: (key, value) =>
            void sql.exec(
                'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                key,
                value
            ),
        top: (limit) =>
            sql
                .exec('SELECT * FROM users ORDER BY kills DESC, score DESC LIMIT ?', limit)
                .toArray() as unknown as UserRow[]
    };
};
