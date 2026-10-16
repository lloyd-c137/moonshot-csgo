import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/ui/settings.ts';

const memoryStorage = () => {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        data
    };
};

test('settings load with defaults, clamp saved values and round-trip', () => {
    const storage = memoryStorage();
    assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
    storage.setItem('moonshot-open-world.settings.v1', JSON.stringify({ lookSensitivity: 9, fieldOfView: 'wide' }));
    const clamped = loadSettings(storage);
    assert.equal(clamped.lookSensitivity, 0.2);
    assert.equal(clamped.fieldOfView, DEFAULT_SETTINGS.fieldOfView);
    saveSettings(storage, { lookSensitivity: 0.1, fieldOfView: 90 });
    assert.deepEqual(loadSettings(storage), { lookSensitivity: 0.1, fieldOfView: 90 });
});
