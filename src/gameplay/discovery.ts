// Discovery log: which locations the player has entered. Persisted locally (no network, no identity); storage is
// optional and failures fall back to an in-memory session.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DISCOVERY_STORAGE_KEY = 'moonshot-open-world.discovered.v1';

export class DiscoveryLog {
    readonly total: number;
    private readonly known: Set<string>;
    private readonly order: string[] = [];
    private readonly storage: StorageLike | null;
    private readonly listeners = new Set<() => void>();

    constructor(validIds: Iterable<string>, storage: StorageLike | null = null) {
        this.known = new Set(validIds);
        this.total = this.known.size;
        this.storage = storage;
        try {
            const saved = JSON.parse(storage?.getItem(DISCOVERY_STORAGE_KEY) ?? '[]') as unknown;
            if (Array.isArray(saved)) {
                for (const id of saved)
                    if (typeof id === 'string' && this.known.has(id) && !this.order.includes(id)) this.order.push(id);
            }
        } catch {
            // Corrupt or unavailable storage: start a fresh session.
        }
    }

    get count() {
        return this.order.length;
    }

    /** Discovered ids, oldest first. */
    get list(): readonly string[] {
        return this.order;
    }

    has(id: string) {
        return this.order.includes(id);
    }

    /** Records a visit; returns true the first time a valid location is entered. */
    visit(id: string) {
        if (!this.known.has(id) || this.has(id)) return false;
        this.order.push(id);
        this.save();
        for (const listener of this.listeners) listener();
        return true;
    }

    reset() {
        this.order.length = 0;
        try {
            this.storage?.removeItem(DISCOVERY_STORAGE_KEY);
        } catch {
            // ignore
        }
        for (const listener of this.listeners) listener();
    }

    onChange(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private save() {
        try {
            this.storage?.setItem(DISCOVERY_STORAGE_KEY, JSON.stringify(this.order));
        } catch {
            // Storage full or blocked: keep the in-memory session.
        }
    }
}

/** localStorage when the browser allows it, otherwise null (private mode, blocked site data). */
export const browserStorage = (): StorageLike | null => {
    try {
        const storage = window.localStorage;
        const probe = '__moonshot_probe__';
        storage.setItem(probe, '1');
        storage.removeItem(probe);
        return storage;
    } catch {
        return null;
    }
};
