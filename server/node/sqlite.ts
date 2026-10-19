import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | null | Uint8Array | bigint;

/** Adapter for the small SqlStorage surface used by sqlAccountDb. */
export class NodeSqlStorage {
    readonly database: DatabaseSync;

    constructor(database: DatabaseSync) {
        this.database = database;
    }

    exec(query: string, ...bindings: SqlValue[]) {
        const statement = this.database.prepare(query);
        const rows = statement.all(...bindings) as Record<string, SqlValue>[];
        return { toArray: () => rows };
    }

    close() {
        this.database.close();
    }
}

export const openAccountDatabase = (filename: string) => {
    const database = new DatabaseSync(filename);
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA busy_timeout = 5000');
    const sql = new NodeSqlStorage(database);
    const storage = sql as unknown as SqlStorage;
    return { database, sql, storage };
};

export const inTransaction = <T>(database: DatabaseSync, operation: () => T): T => {
    database.exec('BEGIN IMMEDIATE');
    try {
        const result = operation();
        database.exec('COMMIT');
        return result;
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
};
