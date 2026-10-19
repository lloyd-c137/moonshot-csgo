import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | null | Uint8Array | bigint;

/** Adapter for the small SqlStorage surface used by sqlAccountDb. */
export class NodeSqlStorage {
    readonly database: DatabaseSync;
    private readonly observe?: (name: string, ms: number) => void;

    constructor(database: DatabaseSync, observe?: (name: string, ms: number) => void) {
        this.database = database;
        this.observe = observe;
    }

    exec(query: string, ...bindings: SqlValue[]) {
        const started = performance.now();
        const statement = this.database.prepare(query);
        const rows = statement.all(...bindings) as Record<string, SqlValue>[];
        this.observe?.('sqliteOperationMs', performance.now() - started);
        return { toArray: () => rows };
    }

    close() {
        this.database.close();
    }
}

export const openAccountDatabase = (filename: string, observe?: (name: string, ms: number) => void) => {
    const database = new DatabaseSync(filename);
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA busy_timeout = 5000');
    const sql = new NodeSqlStorage(database, observe);
    const storage = sql as unknown as SqlStorage;
    return { database, sql, storage };
};

export const inTransaction = <T>(database: DatabaseSync, operation: () => T, observe?: (name: string, ms: number) => void): T => {
    const started = performance.now();
    database.exec('BEGIN IMMEDIATE');
    try {
        const result = operation();
        database.exec('COMMIT');
        observe?.('sqliteTransactionMs', performance.now() - started);
        return result;
    } catch (error) {
        database.exec('ROLLBACK');
        observe?.('sqliteTransactionMs', performance.now() - started);
        throw error;
    }
};
