// Cloudflare Worker + Durable Object hosting the shared campus world. Every player joins the single room over a
// WebSocket at /ws; /api/* serves accounts (register, login, logout, me), the standing 淘汰王 and the lifetime board.
// Stored (Durable Object SQLite): usernames, salted PBKDF2 password hashes, sessions and lifetime stats. The live
// room (positions, chat) is memory only; no addresses are logged or stored.
// eslint-disable-next-line import-x/no-unresolved -- provided by the Workers runtime
import { DurableObject } from 'cloudflare:workers';

import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { parseClientMessage, ROUND, SNAPSHOT_HZ } from '../src/net/protocol.ts';
import type { ServerMessage } from '../src/net/protocol.ts';

import { sqlAccountDb } from './accountDb.ts';
import { Accounts } from './accounts.ts';
import { AVATAR_IMAGE, webpDimensions } from './avatarImage.ts';
import { originAllowed, requestOriginAllowed } from './originPolicy.ts';
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

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.combatTestEnabled = env.COMBAT_TEST === '1';
        this.accounts = new Accounts(ctx.storage.transactionSync(() => sqlAccountDb(ctx.storage.sql)));
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
        const publicAvatar = url.pathname.match(/^\/api\/avatars\/([0-9a-f-]{36})$/i);
        if (request.method === 'GET' && publicAvatar) {
            if (!this.env.AVATARS) return json({ error: '头像存储暂不可用' }, 503);
            const object = await this.env.AVATARS.get(`avatars/${publicAvatar[1]}.webp`);
            if (!object) return json({ error: '头像不存在' }, 404);
            return new Response(object.body, {
                headers: {
                    'content-type': 'image/webp',
                    'cache-control': 'public, max-age=31536000, immutable',
                    'x-content-type-options': 'nosniff',
                    'cross-origin-resource-policy': 'cross-origin'
                }
            });
        }
        if (url.pathname === '/api/avatar' && request.method === 'POST') {
            if (!this.env.AVATARS) return json({ error: '头像存储暂不可用' }, 503);
            const account = this.accounts.resolve(bearer, now);
            if (!account) return json({ error: '登录已过期，请重新登录' }, 401);
            const recent = (this.avatarUploads.get(account.name) ?? []).filter((at) => now - at < 600_000);
            if (recent.length >= 5) return json({ error: '头像更新过于频繁，请稍后再试' }, 429);
            if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/webp')
                return json({ error: '只支持处理后的 WebP 头像' }, 400);
            const declaredLength = Number(request.headers.get('content-length') ?? 0);
            if (declaredLength > AVATAR_IMAGE.maxBytes) return json({ error: '头像不能超过 250 KiB' }, 413);
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (bytes.length > AVATAR_IMAGE.maxBytes) return json({ error: '头像不能超过 250 KiB' }, 413);
            const dimensions = webpDimensions(bytes);
            if (
                !dimensions ||
                dimensions.width > AVATAR_IMAGE.maxWidth ||
                dimensions.height > AVATAR_IMAGE.maxHeight ||
                dimensions.width * dimensions.height > AVATAR_IMAGE.maxPixels
            )
                return json({ error: '头像必须是有效的 1024×512 以内 WebP 图片' }, 400);
            const avatarId = crypto.randomUUID();
            const avatarVersion = crypto.randomUUID();
            const key = `avatars/${avatarId}.webp`;
            try {
                await this.env.AVATARS.put(key, bytes, {
                    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }
                });
                const updated = this.accounts.setAvatar(account.name, avatarId, avatarVersion);
                if (!updated) throw new Error('Account disappeared during avatar save');
                this.room.updateAvatar(account.name, avatarId, avatarVersion);
                recent.push(now);
                this.avatarUploads.set(account.name, recent);
                return json({ account: updated });
            } catch {
                await this.env.AVATARS.delete(key).catch(() => undefined);
                return json({ error: '头像保存失败，请重试' }, 503);
            }
        }
        if (url.pathname === '/api/avatar' && request.method === 'DELETE') {
            if (!this.env.AVATARS) return json({ error: '头像存储暂不可用' }, 503);
            const account = this.accounts.resolve(bearer, now);
            if (!account) return json({ error: '登录已过期，请重新登录' }, 401);
            const updated = this.accounts.setAvatar(account.name, null, null);
            if (!updated) return json({ error: '账号不存在' }, 404);
            this.room.updateAvatar(account.name, null, null);
            if (account.avatarId)
                await this.env.AVATARS.delete(`avatars/${account.avatarId}.webp`).catch(() => undefined);
            return json({ account: updated });
        }
        if (url.pathname === '/api/__test/round-clock' && request.method === 'POST') {
            if (!this.combatTestEnabled) return json({ error: 'not found' }, 404);
            if (!this.accounts.resolve(bearer, now)) return json({ error: '登录已过期，请重新登录' }, 401);
            let body: { remainingSeconds?: unknown };
            try {
                body = (await request.json()) as typeof body;
            } catch {
                return json({ error: '请求格式不正确' }, 400);
            }
            const remainingSeconds = body.remainingSeconds;
            if (
                typeof remainingSeconds !== 'number' ||
                ![
                    ROUND.blackoutSecondsLeft,
                    ROUND.finalSecondsLeft,
                    ROUND.finalSecondsLeft + ROUND.ceremonySeconds
                ].some((seconds) => seconds === remainingSeconds)
            )
                return json({ error: '无效的回合测试时间' }, 400);
            return this.room.setTestRoundRemaining(now, remainingSeconds * 1000)
                ? json({ ok: true })
                : json({ error: '当前没有进行中的回合' }, 409);
        }
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
