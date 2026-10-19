import { ROUND } from '../src/net/protocol.ts';

import type { Accounts } from './accounts.ts';
import { AVATAR_IMAGE, webpDimensions } from './avatarImage.ts';
import type { Room } from './room.ts';

export type AvatarStore = {
    get(key: string): Promise<Uint8Array | null>;
    put(key: string, bytes: Uint8Array): Promise<void>;
    delete(key: string): Promise<void>;
};

export type ApiDependencies = {
    accounts: Accounts;
    room: Room;
    avatars: AvatarStore | null;
    clientAddress: string;
    combatTestEnabled: boolean;
    failures: Map<string, number[]>;
    avatarUploads: Map<string, number[]>;
};

/** Shared account/avatar API used by the Cloudflare Worker and the campus Node host. */
export async function handleApi(
    request: Request,
    url: URL,
    deps: ApiDependencies
): Promise<Response> {
    const { accounts, room, avatars, clientAddress, combatTestEnabled, failures, avatarUploads } = deps;
    const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    const now = Date.now();
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const publicAvatar = url.pathname.match(/^\/api\/avatars\/([0-9a-f-]{36})$/i);
    if (request.method === 'GET' && publicAvatar) {
        if (!avatars) return json({ error: '头像存储暂不可用' }, 503);
        const bytes = await avatars.get(`avatars/${publicAvatar[1]}.webp`);
        if (!bytes) return json({ error: '头像不存在' }, 404);
        return new Response(new Blob([bytes.slice().buffer as ArrayBuffer]), {
            headers: {
                'content-type': 'image/webp',
                'cache-control': 'public, max-age=31536000, immutable',
                'x-content-type-options': 'nosniff',
                'cross-origin-resource-policy': 'cross-origin'
            }
        });
    }
    if (url.pathname === '/api/avatar' && request.method === 'POST') {
        if (!avatars) return json({ error: '头像存储暂不可用' }, 503);
        const account = accounts.resolve(bearer, now);
        if (!account) return json({ error: '登录已过期，请重新登录' }, 401);
        const recent = (avatarUploads.get(account.name) ?? []).filter((at) => now - at < 600_000);
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
            await avatars.put(key, bytes);
            const updated = accounts.setAvatar(account.name, avatarId, avatarVersion);
            if (!updated) throw new Error('Account disappeared during avatar save');
            room.updateAvatar(account.name, avatarId, avatarVersion);
            recent.push(now);
            avatarUploads.set(account.name, recent);
            return json({ account: updated });
        } catch {
            await avatars.delete(key).catch(() => undefined);
            return json({ error: '头像保存失败，请重试' }, 503);
        }
    }
    if (url.pathname === '/api/avatar' && request.method === 'DELETE') {
        if (!avatars) return json({ error: '头像存储暂不可用' }, 503);
        const account = accounts.resolve(bearer, now);
        if (!account) return json({ error: '登录已过期，请重新登录' }, 401);
        const updated = accounts.setAvatar(account.name, null, null);
        if (!updated) return json({ error: '账号不存在' }, 404);
        room.updateAvatar(account.name, null, null);
        if (account.avatarId) await avatars.delete(`avatars/${account.avatarId}.webp`).catch(() => undefined);
        return json({ account: updated });
    }
    if (url.pathname === '/api/__test/round-clock' && request.method === 'POST') {
        if (!combatTestEnabled) return json({ error: 'not found' }, 404);
        if (!accounts.resolve(bearer, now)) return json({ error: '登录已过期，请重新登录' }, 401);
        let body: { remainingSeconds?: unknown };
        try {
            body = (await request.json()) as typeof body;
        } catch {
            return json({ error: '请求格式不正确' }, 400);
        }
        const remainingSeconds = body.remainingSeconds;
        if (
            typeof remainingSeconds !== 'number' ||
            ![ROUND.blackoutSecondsLeft, ROUND.finalSecondsLeft, ROUND.finalSecondsLeft + ROUND.ceremonySeconds].some(
                (seconds) => seconds === remainingSeconds
            )
        )
            return json({ error: '无效的回合测试时间' }, 400);
        return room.setTestRoundRemaining(now, remainingSeconds * 1000)
            ? json({ ok: true })
            : json({ error: '当前没有进行中的回合' }, 409);
    }
    switch (`${request.method} ${url.pathname}`) {
        case 'GET /api/king':
            return json({ king: accounts.king(), online: room.online });
        case 'GET /api/leaderboard':
            return json({ king: accounts.king(), top: accounts.leaderboard(10), online: room.online });
        case 'GET /api/me': {
            const account = accounts.resolve(bearer, now);
            return account ? json({ account }) : json({ error: '登录已过期，请重新登录' }, 401);
        }
        case 'POST /api/logout':
            accounts.logout(bearer);
            return json({ ok: true });
        case 'POST /api/signin':
        case 'POST /api/register':
        case 'POST /api/login': {
            const recent = (failures.get(clientAddress) ?? []).filter((at) => now - at < 600_000);
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
                    ? await accounts.signIn(body.name, body.password, now)
                    : kind === 'register'
                      ? await accounts.register(body.name, body.password, now)
                      : await accounts.login(body.name, body.password, now);
            if (!result.ok) {
                recent.push(now);
                failures.set(clientAddress, recent);
                return json({ error: result.error }, kind === 'login' ? 401 : 400);
            }
            failures.delete(clientAddress);
            return json({ token: result.token, account: result.account, created: !!result.created });
        }
        default:
            return json({ error: 'not found' }, 404);
    }
}
