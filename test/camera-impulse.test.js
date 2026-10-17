import assert from 'node:assert/strict';
import test from 'node:test';

import { CameraImpulseController } from '../src/gameplay/feedback/CameraImpulseController.ts';

test('camera impulses are repeatable, bounded and decay to the neutral view', () => {
    const first = new CameraImpulseController();
    const second = new CameraImpulseController();
    first.setMode('normal');
    second.setMode('normal');
    first.trigger(0.7);
    second.trigger(0.7);

    const firstOffsets = Array.from({ length: 8 }, () => first.update(1 / 60));
    const secondOffsets = Array.from({ length: 8 }, () => second.update(1 / 60));
    assert.deepEqual(firstOffsets, secondOffsets);
    for (const [x, y] of firstOffsets) {
        assert.ok(Math.abs(x) <= 0.035);
        assert.ok(Math.abs(y) <= 0.02);
    }
    assert.deepEqual(first.update(1), [0, 0]);
});

test('camera motion off discards existing and future impulses', () => {
    const camera = new CameraImpulseController();
    camera.trigger(1);
    camera.setMode('off');
    camera.trigger(1);
    assert.deepEqual(camera.update(1 / 60), [0, 0]);
    assert.equal(camera.scale, 0);
});

test('low camera motion is weaker than normal motion for the same impulse', () => {
    const low = new CameraImpulseController();
    const normal = new CameraImpulseController();
    low.setMode('low');
    normal.setMode('normal');
    low.trigger(1);
    normal.trigger(1);

    for (const delta of [1 / 60, 1 / 60, 1 / 60]) {
        const [lowX, lowY] = low.update(delta);
        const [normalX, normalY] = normal.update(delta);
        assert.ok(Math.hypot(lowX, lowY) <= Math.hypot(normalX, normalY) + 1e-12);
    }
});
