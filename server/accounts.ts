// Player accounts for the shared world: register/login with a username and password, sessions, persistent stats and
// the standing 淘汰王 (all-time most eliminations). Storage is behind a small synchronous interface so the Durable
// Object can back it with SQLite and tests with maps. Passwords are PBKDF2-SHA256 (100k iterations, 16-byte salt).
import { purchasePrice, skinById } from '../src/config/skins.ts';
import type { OwnedSkin } from '../src/config/skins.ts';
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
    wins: number;
    rounds: number;
    losses: number;
    created: number;
    avatarId?: string | null;
    avatarVersion?: string | null;
    /** Skin points, owned skins (JSON: id → { counter, kills }) and the equipped skin. */
    points?: number;
    skins?: string | null;
    equipped?: string | null;
};

type StatsDelta = {
    kills: number;
    deaths: number;
    hits: number;
    score: number;
    wins: number;
    rounds: number;
    losses: number;
    points: number;
};

export type AccountDb = {
    findUser(key: string): UserRow | null;
    insertUser(row: UserRow): void;
    addStats(key: string, delta: StatsDelta): void;
    insertSession(token: string, key: string, expires: number): void;
    findSession(token: string): { key: string; expires: number } | null;
    deleteSession(token: string): void;
    getMeta(key: string): string | null;
    setMeta(key: string, value: string): void;
    setAvatar(key: string, avatarId: string | null, avatarVersion: string | null): void;
    /** Replaces the skin wallet (points, owned skins as JSON, equipped skin). */
    setWallet(key: string, points: number, skins: string, equipped: string | null): void;
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

/** Owned skins from their stored JSON, dropping anything unknown or malformed. */
export const parseOwnedSkins = (raw: string | null | undefined): Record<string, OwnedSkin> => {
    const owned: Record<string, OwnedSkin> = {};
    if (!raw) return owned;
    try {
        const value = JSON.parse(raw) as Record<string, { counter?: unknown; kills?: unknown }>;
        for (const [id, entry] of Object.entries(value ?? {})) {
            if (!skinById(id) || !entry || typeof entry !== 'object') continue;
            const kills = typeof entry.kills === 'number' && Number.isFinite(entry.kills) ? Math.max(0, Math.floor(entry.kills)) : 0;
            owned[id] = { counter: entry.counter === true, kills };
        }
    } catch {
        /* unreadable: treated as nothing owned */
    }
    return owned;
};

const statsOf = (row: UserRow): AccountStats => ({
    name: row.name,
    kills: row.kills,
    deaths: row.deaths,
    hits: row.hits,
    score: row.score,
    wins: row.wins,
    rounds: row.rounds,
    losses: row.losses ?? 0,
    avatarId: row.avatarId ?? null,
    avatarVersion: row.avatarVersion ?? null,
    points: row.points ?? 0,
    skins: parseOwnedSkins(row.skins),
    equippedSkin: row.equipped && skinById(row.equipped) ? row.equipped : null
});

export type ShopResult = { ok: true; account: AccountStats } | { ok: false; error: string; status: number };

export type AuthResult =
    | { ok: true; token: string; account: AccountStats; created?: boolean }
    | { ok: false; error: string };

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
        this.db.insertUser({
            key,
            name,
            salt,
            hash,
            kills: 0,
            deaths: 0,
            hits: 0,
            score: 0,
            wins: 0,
            rounds: 0,
            losses: 0,
            created: now
        });
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

    /** One step sign-in: logs in when the username exists, otherwise registers it. */
    async signIn(rawName: unknown, password: unknown, now: number): Promise<AuthResult> {
        const name = typeof rawName === 'string' ? cleanName(rawName) : '';
        if (name && this.db.findUser(usernameKey(name))) {
            const result = await this.login(name, password, now);
            return result.ok ? result : { ok: false, error: '密码不正确（该用户名已被注册）' };
        }
        const result = await this.register(rawName, password, now);
        // Lost a race with a registration of the same name: treat it as a login.
        if (!result.ok && name && this.db.findUser(usernameKey(name))) return this.login(name, password, now);
        return result.ok ? { ...result, created: true } : result;
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

    setAvatar(name: string, avatarId: string | null, avatarVersion: string | null) {
        const key = usernameKey(name);
        if (!this.db.findUser(key)) return null;
        this.db.setAvatar(key, avatarId, avatarVersion);
        const row = this.db.findUser(key);
        return row ? statsOf(row) : null;
    }

    /** Adds to an account's lifetime stats (and skin points); returns the new totals. */
    record(name: string, delta: Partial<StatsDelta>) {
        const key = usernameKey(name);
        this.db.addStats(key, { kills: 0, deaths: 0, hits: 0, score: 0, wins: 0, rounds: 0, losses: 0, points: 0, ...delta });
        const row = this.db.findUser(key);
        return row ? statsOf(row) : null;
    }

    /** Buys a skin (plain or 计数器 edition, or the counter upgrade of an owned one) and equips it. */
    buySkin(name: string, skinId: unknown, counter: unknown): ShopResult {
        const key = usernameKey(name);
        const row = this.db.findUser(key);
        if (!row) return { ok: false, error: '账号不存在', status: 404 };
        const skin = typeof skinId === 'string' ? skinById(skinId) : null;
        if (!skin) return { ok: false, error: '没有这款皮肤', status: 400 };
        const owned = parseOwnedSkins(row.skins);
        const price = purchasePrice(skin, owned[skin.id], counter === true);
        if (price === null) return { ok: false, error: '已经拥有这款皮肤', status: 409 };
        const points = row.points ?? 0;
        if (points < price) return { ok: false, error: `积分不足：需要 ${price}，当前 ${points}`, status: 402 };
        owned[skin.id] = { counter: counter === true || owned[skin.id]?.counter === true, kills: owned[skin.id]?.kills ?? 0 };
        this.db.setWallet(key, points - price, JSON.stringify(owned), skin.id);
        return { ok: true, account: statsOf(this.db.findUser(key)!) };
    }

    /** Equips an owned skin, or the default disc with null. */
    equipSkin(name: string, skinId: unknown): ShopResult {
        const key = usernameKey(name);
        const row = this.db.findUser(key);
        if (!row) return { ok: false, error: '账号不存在', status: 404 };
        const owned = parseOwnedSkins(row.skins);
        if (skinId !== null && (typeof skinId !== 'string' || !owned[skinId]))
            return { ok: false, error: '还没有拥有这款皮肤', status: 400 };
        this.db.setWallet(key, row.points ?? 0, JSON.stringify(owned), skinId as string | null);
        return { ok: true, account: statsOf(this.db.findUser(key)!) };
    }

    /** One elimination on a 计数器 skin; returns its new count (null when the skin has no counter). */
    countSkinKill(name: string, skinId: string) {
        const key = usernameKey(name);
        const row = this.db.findUser(key);
        if (!row) return null;
        const owned = parseOwnedSkins(row.skins);
        const entry = owned[skinId];
        if (!entry?.counter) return null;
        entry.kills++;
        this.db.setWallet(key, row.points ?? 0, JSON.stringify(owned), row.equipped ?? null);
        return entry.kills;
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
        this.users.set(row.key, { ...row, losses: row.losses ?? 0 });
    }
    addStats(key: string, delta: StatsDelta) {
        const row = this.users.get(key);
        if (!row) return;
        row.points = (row.points ?? 0) + delta.points;
        row.kills += delta.kills;
        row.deaths += delta.deaths;
        row.hits += delta.hits;
        row.score += delta.score;
        row.wins += delta.wins;
        row.rounds += delta.rounds;
        row.losses += delta.losses;
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

    setAvatar(key: string, avatarId: string | null, avatarVersion: string | null) {
        const row = this.users.get(key);
        if (row) Object.assign(row, { avatarId, avatarVersion });
    }
    setWallet(key: string, points: number, skins: string, equipped: string | null) {
        const row = this.users.get(key);
        if (row) Object.assign(row, { points, skins, equipped });
    }
    top(limit: number) {
        return [...this.users.values()]
            .sort((a, b) => b.kills - a.kills || (a.losses ?? 0) - (b.losses ?? 0) || a.key.localeCompare(b.key))
            .slice(0, limit);
    }
}
