import { SKIN_POINTS } from '../src/config/skins.ts';

import type { AccountDb, UserRow } from './accounts.ts';

/** AccountDb on Durable Object SQLite. */
export const sqlAccountDb = (sql: SqlStorage): AccountDb => {
    sql.exec(`CREATE TABLE IF NOT EXISTS users (
        key TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
        kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0,
        score INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`);
    // Additive migration: preserve existing accounts/stats; historical round results were never stored.
    const columns = new Set(
        sql
            .exec('PRAGMA table_info(users)')
            .toArray()
            .map((row) => row.name)
    );
    for (const column of ['wins', 'rounds', 'losses']) {
        if (!columns.has(column)) sql.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
    for (const column of ['avatarId', 'avatarVersion', 'skins', 'equipped']) {
        if (!columns.has(column)) sql.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
    }
    if (!columns.has('points')) sql.exec('ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0');
    sql.exec('CREATE INDEX IF NOT EXISTS users_kills ON users (kills DESC, score DESC)');
    sql.exec(
        'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, key TEXT NOT NULL, expires INTEGER NOT NULL)'
    );
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    // One-time owner-requested win-rate restart. The caller wraps initialization in transactionSync.
    // Keep the old counters for recovery; never rerun this on a later Worker restart/deployment.
    const resetKey = 'winrate-reset-100-v1';
    if (!sql.exec('SELECT value FROM meta WHERE key = ?', resetKey).toArray().length) {
        const previous = sql.exec('SELECT key, wins, rounds FROM users').toArray();
        sql.exec('UPDATE users SET wins = 0, rounds = 0');
        sql.exec(
            'INSERT INTO meta (key, value) VALUES (?, ?)',
            resetKey,
            JSON.stringify({ initialWinRate: 100, previous })
        );
    }
    // Start the owner-requested loss-only display at 100% for every existing account while preserving factual
    // wins/rounds. Future defeats decrement this separate counter; victories and draws leave it unchanged.
    const lossRateKey = 'winrate-loss-only-v1';
    if (!sql.exec('SELECT value FROM meta WHERE key = ?', lossRateKey).toArray().length) {
        const previous = sql.exec('SELECT key, losses FROM users').toArray();
        sql.exec('UPDATE users SET losses = 0');
        sql.exec(
            'INSERT INTO meta (key, value) VALUES (?, ?)',
            lossRateKey,
            JSON.stringify({ initialRate: 100, previous })
        );
    }
    // Credit legacy visible stats once. The caller wraps initialization in transactionSync.
    const pointsBackfillKey = 'skin-points-stats-backfill-v1';
    if (!sql.exec('SELECT value FROM meta WHERE key = ?', pointsBackfillKey).toArray().length) {
        const totals = sql
            .exec(
                'SELECT COUNT(*) AS accounts, COALESCE(SUM(COALESCE(kills, 0)), 0) AS kills, COALESCE(SUM(COALESCE(wins, 0)), 0) AS wins FROM users'
            )
            .toArray()[0];
        const killPoints = Number(totals.kills) * SKIN_POINTS.kill;
        const winPoints = Number(totals.wins) * SKIN_POINTS.win;
        sql.exec(
            'UPDATE users SET points = COALESCE(points, 0) + COALESCE(kills, 0) * ? + COALESCE(wins, 0) * ?',
            SKIN_POINTS.kill,
            SKIN_POINTS.win
        );
        sql.exec(
            'INSERT INTO meta (key, value) VALUES (?, ?)',
            pointsBackfillKey,
            JSON.stringify({ accounts: Number(totals.accounts), killPoints, winPoints, totalPoints: killPoints + winPoints })
        );
    }
    const one = <T>(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>) => {
        const rows = cursor.toArray();
        return (rows[0] as T | undefined) ?? null;
    };
    return {
        findUser: (key) => one<UserRow>(sql.exec('SELECT * FROM users WHERE key = ?', key)),
        insertUser: (row) =>
            void sql.exec(
                'INSERT INTO users (key, name, salt, hash, kills, deaths, hits, score, wins, rounds, losses, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                row.key,
                row.name,
                row.salt,
                row.hash,
                row.kills,
                row.deaths,
                row.hits,
                row.score,
                row.wins,
                row.rounds,
                row.losses,
                row.created
            ),
        addStats: (key, d) =>
            void sql.exec(
                'UPDATE users SET kills = kills + ?, deaths = deaths + ?, hits = hits + ?, score = score + ?, wins = wins + ?, rounds = rounds + ?, losses = losses + ?, points = points + ? WHERE key = ?',
                d.kills,
                d.deaths,
                d.hits,
                d.score,
                d.wins,
                d.rounds,
                d.losses,
                d.points,
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
        setAvatar: (key, avatarId, avatarVersion) =>
            void sql.exec(
                'UPDATE users SET avatarId = ?, avatarVersion = ? WHERE key = ?',
                avatarId,
                avatarVersion,
                key
            ),
        setWallet: (key, points, skins, equipped) =>
            void sql.exec('UPDATE users SET points = ?, skins = ?, equipped = ? WHERE key = ?', points, skins, equipped, key),
        top: (limit) =>
            sql
                .exec('SELECT * FROM users ORDER BY kills DESC, losses ASC, key ASC LIMIT ?', limit)
                .toArray() as unknown as UserRow[]
    };
};
