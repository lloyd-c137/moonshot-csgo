import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { sqlAccountDb } from '../server/accountDb.ts';
import { Accounts } from '../server/accounts.ts';
import { formatWinRate } from '../src/ui/formatStats.ts';

test('SQLite migration preserves old accounts and is repeatable; round stats survive reopening the adapter', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
        sqlite.exec(`CREATE TABLE users (key TEXT PRIMARY KEY, name TEXT, salt TEXT, hash TEXT,
            kills INTEGER, deaths INTEGER, hits INTEGER, score INTEGER, created INTEGER);
            INSERT INTO users VALUES ('old', 'Old', 'salt', 'hash', 5, 2, 9, 100, 1)`);
        // Match SqlStorage.exec's eager execution (including statements whose result isn't read).
        const sql = {
            exec: (query, ...args) => {
                const rows = sqlite.prepare(query).all(...args);
                return { toArray: () => rows };
            }
        };
        let db = sqlAccountDb(sql);
        assert.deepEqual(
            { ...db.findUser('old') },
            {
                key: 'old',
                name: 'Old',
                salt: 'salt',
                hash: 'hash',
                kills: 5,
                deaths: 2,
                hits: 9,
                score: 100,
                created: 1,
                wins: 0,
                rounds: 0
            }
        );
        new Accounts(db).record('Old', { wins: 1, rounds: 2 });
        db = sqlAccountDb(sql);
        assert.equal(db.findUser('old').rounds, 2);
        assert.equal(db.findUser('old').wins, 1);
        db.insertUser({
            key: 'new',
            name: 'New',
            salt: '',
            hash: '',
            kills: 5,
            deaths: 0,
            hits: 5,
            score: 5,
            wins: 2,
            rounds: 2,
            created: 2
        });
        assert.deepEqual(
            db.top(2).map((row) => row.name),
            ['New', 'Old']
        );
        assert.equal(formatWinRate(db.findUser('old')), '50.0%');
    } finally {
        sqlite.close();
    }
});

test('win rate starts at 100%, then follows actual rounds; malformed payloads remain unknown', () => {
    assert.equal(formatWinRate({}), '—');
    assert.equal(formatWinRate({ wins: 0, rounds: 0 }), '100.0%');
    assert.equal(formatWinRate({ wins: 0, rounds: 3 }), '0.0%');
    assert.equal(formatWinRate({ wins: 1, rounds: 3 }), '33.3%');
    assert.equal(formatWinRate({ wins: 3, rounds: 3 }), '100.0%');
    assert.equal(formatWinRate({ wins: 4, rounds: 3 }), '—');
    assert.equal(formatWinRate({ wins: NaN, rounds: 3 }), '—');
});

test('owner reset backs up old round stats once and preserves new results after reinitialization', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
        sqlite.exec(`CREATE TABLE users (key TEXT PRIMARY KEY, name TEXT, salt TEXT, hash TEXT,
            kills INTEGER, deaths INTEGER, hits INTEGER, score INTEGER, created INTEGER, wins INTEGER, rounds INTEGER);
            INSERT INTO users VALUES ('old', 'Old', 'salt', 'hash', 8, 3, 12, 8, 1, 2, 5)`);
        const sql = {
            exec: (query, ...args) => {
                const rows = sqlite.prepare(query).all(...args);
                return { toArray: () => rows };
            }
        };
        let db = sqlAccountDb(sql);
        assert.equal(formatWinRate(db.findUser('old')), '100.0%');
        assert.deepEqual([db.findUser('old').wins, db.findUser('old').rounds], [0, 0]);
        assert.deepEqual([db.findUser('old').kills, db.findUser('old').deaths, db.findUser('old').hits], [8, 3, 12]);
        const backup = db.getMeta('winrate-reset-100-v1');
        assert.deepEqual(JSON.parse(backup).previous, [{ key: 'old', wins: 2, rounds: 5 }]);
        new Accounts(db).record('Old', { rounds: 1 });
        assert.equal(formatWinRate(db.findUser('old')), '0.0%');
        db = sqlAccountDb(sql);
        assert.equal(db.findUser('old').rounds, 1, 'a restart must not reset new play');
        assert.equal(db.getMeta('winrate-reset-100-v1'), backup);
        new Accounts(db).record('Old', { wins: 1, rounds: 1 });
        assert.equal(formatWinRate(db.findUser('old')), '50.0%');
        db.insertUser({
            key: 'new',
            name: 'New',
            salt: '',
            hash: '',
            kills: 8,
            deaths: 0,
            hits: 0,
            score: 0,
            wins: 0,
            rounds: 0,
            created: 2
        });
        assert.deepEqual(
            db.top(2).map((row) => row.name),
            ['New', 'Old'],
            'initial 100% sorts consistently'
        );
    } finally {
        sqlite.close();
    }
});
