import assert from 'node:assert/strict';
import test from 'node:test';

import { worldItemMapMarkers } from '../src/ui/mapItems.ts';

test('skill map markers use current item coordinates and omit unavailable items', () => {
    const markers = worldItemMapMarkers([
        { id: 'item-revive', kind: 'revive', name: '复活甲', at: [12, 3, -45], available: true },
        { id: 'item-frc', kind: 'frc', name: 'FRC', at: [8, 0.92, 4], available: false }
    ]);

    assert.deepEqual(markers, [{ id: 'item-revive', short: '甲', name: '复活甲', x: 12, z: -45, colour: '#ff9f9a' }]);

    const droppedAtNewPosition = worldItemMapMarkers([
        { id: 'item-revive', kind: 'revive', name: '复活甲', at: [-21, 0.92, 66], available: true }
    ]);
    assert.deepEqual([droppedAtNewPosition[0].x, droppedAtNewPosition[0].z], [-21, 66]);
});
