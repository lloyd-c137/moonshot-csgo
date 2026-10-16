// Player accounts for the shared world: register/login with a username and password, sessions, persistent stats and
// the standing 淘汰王 (all-time most eliminations). Storage is behind a small synchronous interface so the Durable
// Object can back it with SQLite and tests with maps. Passwords are PBKDF2-SHA256 (100k iterations, 16-byte salt).
import { cleanName } from '../src/net/protocol.ts';
import type { AccountStats, King } from '../src/net/protocol.ts';

export type UserRow = {
    key: string;
    name: string;
    salt: string;
    hash: string;
    kills: number;
    deaths: number;
    hits: number;
    score: number;
    created: number;
};

export type AccountDb = {
    findUser(key: string): UserRow | null;
    insertUser(row: UserRow): void;
    addStats(key: string, delta: { kills: number; deaths: number; hits: number; score: number }): void;
    insertSession(token: string, key: string, expires: number): void;
    findSession(token: string): { key: string; expires: number } | null;
    deleteSession(token: string): void;
    getMeta(key: string): string | null;
    setMeta(key: string, value: string): void;
    top(limit: number): UserRow[];
};

export const PASSWORD = { min: 6, max: 64 } as const;
const ITERATIONS = 100_000;
const SESSION_DAYS = 30;

export const usernameKey = (name: string) => name.normalize('NFKC').toLowerCase();

/** Usernames: 2–16 letters, digits, CJK, underscore, hyphen or middle dot (after the shared name cleaning). */
export const validUsername = (raw: unknown) => {
    const name = cleanName(raw);
    return /^[\p{L}\p{N}_\-·]{2,16}$/u.test(name) ? name : null;
};

const hex = (bytes: ArrayBuffer | Uint8Array) =>
    [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const randomHex = (length: number) => hex(crypto.getRandomValues(new Uint8Array(length)));

export const hashPassword = async (password: string, salt: string) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
        'deriveBits'
    ]);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS },
        key,
        256
    );
    return hex(bits);
};

const sameHex = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

const statsOf = (row: UserRow): AccountStats => ({
    name: row.name,
    kills: row.kills,
    deaths: row.deaths,
    hits: row.hits,
    score: row.score
});

export type AuthResult = { ok: true; token: string; account: AccountStats } | { ok: false; error: string };

export class Accounts {
    private readonly db: AccountDb;

    constructor(db: AccountDb) {
        this.db = db;
    }

    async register(rawName: unknown, password: unknown, now: number): Promise<AuthResult> {
        const name = validUsername(rawName);
        if (!name) return { ok: false, error: '用户名需为 2–16 个字符（中英文、数字、下划线或连字符）' };
        if (typeof password !== 'string' || password.length < PASSWORD.min || password.length > PASSWORD.max) {
            return { ok: false, error: `密码需为 ${PASSWORD.min}–${PASSWORD.max} 位` };
        }
        const key = usernameKey(name);
        if (this.db.findUser(key)) return { ok: false, error: '这个用户名已被注册' };
        const salt = randomHex(16);
        const hash = await hashPassword(password, salt);
        // Re-check after the await: another registration may have taken the name meanwhile.
        if (this.db.findUser(key)) return { ok: false, error: '这个用户名已被注册' };
        this.db.insertUser({ key, name, salt, hash, kills: 0, deaths: 0, hits: 0, score: 0, created: now });
        return this.session(key, now);
    }

    async login(rawName: unknown, password: unknown, now: number): Promise<AuthResult> {
        const name = typeof rawName === 'string' ? cleanName(rawName) : '';
        const row = name ? this.db.findUser(usernameKey(name)) : null;
        // Always hash, so timing does not reveal whether the user exists.
        const hash = await hashPassword(typeof password === 'string' ? password : '', row?.salt ?? 'no-such-user');
        if (!row || !sameHex(hash, row.hash)) return { ok: false, error: '用户名或密码不正确' };
        return this.session(row.key, now);
    }

    logout(token: string) {
        this.db.deleteSession(token);
    }

    /** The account behind a session token, or null when unknown or expired. */
    resolve(token: unknown, now: number): AccountStats | null {
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
        const session = this.db.findSession(token);
        if (!session) return null;
        if (session.expires < now) {
            this.db.deleteSession(token);
            return null;
        }
        const row = this.db.findUser(session.key);
        return row ? statsOf(row) : null;
    }

    isRegistered(name: string) {
        return !!this.db.findUser(usernameKey(name));
    }

    /** Adds to an account's lifetime stats; returns the new totals. */
    record(name: string, delta: { kills?: number; deaths?: number; hits?: number; score?: number }) {
        const key = usernameKey(name);
        this.db.addStats(key, { kills: 0, deaths: 0, hits: 0, score: 0, ...delta });
        const row = this.db.findUser(key);
        return row ? statsOf(row) : null;
    }

    king(): King | null {
        const raw = this.db.getMeta('king');
        return raw ? (JSON.parse(raw) as King) : null;
    }

    /**
     * Crowns `stats` if they beat the standing record (strictly more eliminations), or refreshes the holder's count.
     * Returns the king when it changed (new holder or new count), else null.
     */
    challenge(stats: AccountStats, now: number): { king: King; isNew: boolean } | null {
        const current = this.king();
        if (current && usernameKey(current.name) === usernameKey(stats.name)) {
            if (stats.kills === current.kills) return null;
            const king = { ...current, kills: stats.kills };
            this.db.setMeta('king', JSON.stringify(king));
            return { king, isNew: false };
        }
        if (current && stats.kills <= current.kills) return null;
        const king: King = { name: stats.name, kills: stats.kills, since: now };
        this.db.setMeta('king', JSON.stringify(king));
        return { king, isNew: true };
    }

    leaderboard(limit = 10) {
        return this.db.top(limit).map(statsOf);
    }

    private session(key: string, now: number): AuthResult {
        const token = randomHex(32);
        this.db.insertSession(token, key, now + SESSION_DAYS * 86_400_000);
        return { ok: true, token, account: statsOf(this.db.findUser(key)!) };
    }
}

/** In-memory AccountDb (tests and local fallbacks). */
export class MemoryAccountDb implements AccountDb {
    users = new Map<string, UserRow>();
    sessions = new Map<string, { key: string; expires: number }>();
    meta = new Map<string, string>();
    findUser(key: string) {
        return this.users.get(key) ?? null;
    }
    insertUser(row: UserRow) {
        this.users.set(row.key, { ...row });
    }
    addStats(key: string, delta: { kills: number; deaths: number; hits: number; score: number }) {
        const row = this.users.get(key);
        if (!row) return;
        row.kills += delta.kills;
        row.deaths += delta.deaths;
        row.hits += delta.hits;
        row.score += delta.score;
    }
    insertSession(token: string, key: string, expires: number) {
        this.sessions.set(token, { key, expires });
    }
    findSession(token: string) {
        return this.sessions.get(token) ?? null;
    }
    deleteSession(token: string) {
        this.sessions.delete(token);
    }
    getMeta(key: string) {
        return this.meta.get(key) ?? null;
    }
    setMeta(key: string, value: string) {
        this.meta.set(key, value);
    }
    top(limit: number) {
        return [...this.users.values()].sort((a, b) => b.kills - a.kills || b.score - a.score).slice(0, limit);
    }
}
