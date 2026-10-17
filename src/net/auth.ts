// Account calls to the room Worker's /api (one-step sign-in, logout, me) plus the public 淘汰王 / leaderboard.
// The session token is kept in this browser only (localStorage) and sent with the WebSocket hello.
import type { AccountStats, King } from './protocol';

const TOKEN_KEY = 'moonshot.session';

class ApiError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

/** HTTP base for a WebSocket room URL: wss://host/ws → https://host. */
export const apiBase = (wsUrl: string | null) =>
    wsUrl ? wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws\/?$/, '') : null;

const storage = {
    get: () => {
        try {
            return window.localStorage.getItem(TOKEN_KEY);
        } catch {
            return null;
        }
    },
    set: (token: string | null) => {
        try {
            if (token) window.localStorage.setItem(TOKEN_KEY, token);
            else window.localStorage.removeItem(TOKEN_KEY);
        } catch {
            /* storage unavailable: session lasts for this page only */
        }
    }
};

export type Board = { king: King | null; top: AccountStats[]; online: number };

export const createAuth = (base: string | null) => {
    let token = storage.get();
    let account: AccountStats | null = null;
    const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
        if (!base) throw new Error('当前为离线模式，无法连接账号服务');
        const response = await fetch(`${base}${path}`, {
            ...init,
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...(init.headers ?? {})
            }
        });
        const body = (await response.json().catch(() => ({}))) as T & { error?: string };
        if (!response.ok) throw new ApiError(body.error ?? `请求失败（${response.status}）`, response.status);
        return body;
    };
    /** Logs in, or registers the username when it is not taken yet. */
    const signIn = async (name: string, password: string) => {
        const result = await call<{ token: string; account: AccountStats; created: boolean }>('/api/signin', {
            method: 'POST',
            body: JSON.stringify({ name, password })
        });
        token = result.token;
        account = result.account;
        storage.set(token);
        return { account, created: result.created };
    };
    return {
        get available() {
            return base !== null;
        },
        get token() {
            return token;
        },
        get account() {
            return account;
        },
        set account(value: AccountStats | null) {
            account = value;
        },
        /** Restores a saved session; clears it if the server no longer knows it. */
        async restore() {
            if (!token || !base) return null;
            try {
                account = (await call<{ account: AccountStats }>('/api/me')).account;
            } catch (error) {
                // A temporary network/authorization routing failure must never erase a valid saved session.
                // Only an explicit server 401 means the token is expired or unknown.
                if (!(error instanceof ApiError) || error.status !== 401) throw error;
                token = null;
                account = null;
                storage.set(null);
            }
            return account;
        },
        signIn,
        async logout() {
            const old = token;
            token = null;
            account = null;
            storage.set(null);
            if (old && base) {
                await fetch(`${base}/api/logout`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${old}` }
                }).catch(() => undefined);
            }
        },
        avatarUrl(id: string, version: string) {
            return base ? `${base}/api/avatars/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}` : null;
        },
        async uploadAvatar(image: Blob) {
            if (!base || !token) throw new Error('请先登录后再上传头像');
            const response = await fetch(`${base}/api/avatar`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'image/webp' },
                body: image
            });
            const body = (await response.json().catch(() => ({}))) as { account?: AccountStats; error?: string };
            if (!response.ok || !body.account) throw new Error(body.error ?? `头像上传失败（${response.status}）`);
            account = body.account;
            return account;
        },
        async deleteAvatar() {
            if (!base || !token) throw new Error('请先登录后再修改头像');
            const response = await fetch(`${base}/api/avatar`, {
                method: 'DELETE',
                headers: { authorization: `Bearer ${token}` }
            });
            const body = (await response.json().catch(() => ({}))) as { account?: AccountStats; error?: string };
            if (!response.ok || !body.account) throw new Error(body.error ?? `恢复默认头像失败（${response.status}）`);
            account = body.account;
            return account;
        },
        board: () => call<Board>('/api/leaderboard')
    };
};

export type Auth = ReturnType<typeof createAuth>;
