import assert from 'node:assert/strict';
import test from 'node:test';

import { DISCOVERY_STORAGE_KEY, DiscoveryLog } from '../src/gameplay/discovery.ts';
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

test('discovery records each valid location once, in order, and persists it', () => {
    const storage = memoryStorage();
    const log = new DiscoveryLog(['A', 'B', 'C'], storage);
    let changes = 0;
    log.onChange(() => changes++);
    assert.equal(log.visit('B'), true);
    assert.equal(log.visit('B'), false);
    assert.equal(log.visit('UNKNOWN'), false);
    assert.equal(log.visit('A'), true);
    assert.deepEqual(log.list, ['B', 'A']);
    assert.equal(log.count, 2);
    assert.equal(log.total, 3);
    assert.equal(changes, 2);
    const restored = new DiscoveryLog(['A', 'B', 'C'], storage);
    assert.deepEqual(restored.list, ['B', 'A']);
    restored.reset();
    assert.equal(storage.getItem(DISCOVERY_STORAGE_KEY), null);
});

test('discovery survives corrupt or failing storage', () => {
    const corrupt = memoryStorage();
    corrupt.setItem(DISCOVERY_STORAGE_KEY, '{not json');
    assert.equal(new DiscoveryLog(['A'], corrupt).count, 0);
    const failing = {
        getItem: () => {
            throw new Error('blocked');
        },
        setItem: () => {
            throw new Error('full');
        },
        removeItem: () => undefined
    };
    const log = new DiscoveryLog(['A'], failing);
    assert.equal(log.visit('A'), true);
    assert.equal(new DiscoveryLog(['A'], null).count, 0);
});

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
