import assert from 'node:assert/strict';
import test from 'node:test';

import { CameraImpulseController } from '../src/gameplay/feedback/CameraImpulseController.ts';
import { CombatFeedbackDirector } from '../src/gameplay/feedback/CombatFeedbackDirector.ts';

test('combat feedback deduplicates authoritative outcomes and protects higher-priority HUD notices', () => {
    const feedback = new CombatFeedbackDirector();
    assert.deepEqual(feedback.submit({ id: 'hit:player:1', kind: 'body-hit' }, 100), {
        accepted: true,
        showHud: true
    });
    assert.deepEqual(feedback.submit({ id: 'hit:player:1', kind: 'body-hit' }, 120), {
        accepted: false,
        showHud: false
    });
    assert.deepEqual(feedback.submit({ id: 'hit:player:2', kind: 'golden-elimination' }, 150), {
        accepted: true,
        showHud: true
    });
    assert.deepEqual(feedback.submit({ id: 'hit:player:3', kind: 'body-hit' }, 200), {
        accepted: true,
        showHud: false
    });
    assert.deepEqual(feedback.submit({ id: 'round:2', kind: 'round-result' }, 400), {
        accepted: true,
        showHud: true
    });
    assert.deepEqual(feedback.submit({ id: 'hit:player:4', kind: 'body-hit' }, 2_300), {
        accepted: true,
        showHud: true
    });
});

test('camera impulses are bounded, deterministic, damped and do not alter look state', () => {
    const camera = new CameraImpulseController();
    assert.equal(camera.scale, 0.38);
    assert.deepEqual(camera.update(1 / 60), [0, 0]);
    camera.trigger(0.8);
    const first = camera.update(1 / 60);
    assert.notDeepEqual(first, [0, 0]);
    for (let i = 0; i < 45; i++) camera.update(1 / 60);
    assert.deepEqual(camera.update(1), [0, 0]);
    camera.trigger(1);
    camera.setMode('off');
    assert.equal(camera.scale, 0);
    assert.deepEqual(camera.update(1 / 60), [0, 0]);
});
