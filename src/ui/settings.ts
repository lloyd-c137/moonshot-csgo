import type { StorageLike } from '../gameplay/discovery';

export type Settings = { lookSensitivity: number; fieldOfView: number };

export const DEFAULT_SETTINGS: Settings = { lookSensitivity: 0.08, fieldOfView: 78 };
export const SETTING_RANGES = {
    lookSensitivity: { min: 0.03, max: 0.2, step: 0.005 },
    fieldOfView: { min: 60, max: 100, step: 1 }
} as const;

const KEY = 'moonshot-open-world.settings.v1';

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export const loadSettings = (storage: StorageLike | null): Settings => {
    try {
        const saved = JSON.parse(storage?.getItem(KEY) ?? '{}') as Partial<Settings>;
        return {
            lookSensitivity: clamp(
                saved.lookSensitivity,
                SETTING_RANGES.lookSensitivity,
                DEFAULT_SETTINGS.lookSensitivity
            ),
            fieldOfView: clamp(saved.fieldOfView, SETTING_RANGES.fieldOfView, DEFAULT_SETTINGS.fieldOfView)
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
};

export const saveSettings = (storage: StorageLike | null, settings: Settings) => {
    try {
        storage?.setItem(KEY, JSON.stringify(settings));
    } catch {
        // Storage unavailable: the setting applies for this session only.
    }
};
