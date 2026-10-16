// Optional browser storage (settings, session): failures fall back to nothing being remembered.

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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
