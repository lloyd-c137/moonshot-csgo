import assert from 'node:assert/strict';
import test from 'node:test';

import { conflictsFor, DEFAULT_BINDINGS, isSafeBinding, setBinding } from '../src/input/actions.ts';
import { InputManager } from '../src/input/InputManager.ts';

test('default actions retain gameplay keys and allow only context-safe shared bindings', () => {
    assert.equal(DEFAULT_BINDINGS.moveForward, 'KeyW');
    assert.equal(DEFAULT_BINDINGS.throw, 'MouseLeft');
    assert.equal(DEFAULT_BINDINGS.execute, 'KeyV');
    assert.equal(DEFAULT_BINDINGS.dropGold, 'KeyQ');
    assert.deepEqual(conflictsFor(DEFAULT_BINDINGS, 'moveForward', 'KeyC'), ['crouch']);
    assert.deepEqual(conflictsFor(DEFAULT_BINDINGS, 'throw', 'MouseLeft'), []);
});

test('bindings reject conflicts until explicitly swapped and protect browser shortcuts', () => {
    assert.equal(setBinding(DEFAULT_BINDINGS, 'inspect', 'KeyC'), null);
    const swapped = setBinding(DEFAULT_BINDINGS, 'inspect', 'KeyC', true);
    assert.equal(swapped.inspect, 'KeyC');
    assert.equal(swapped.crouch, 'KeyF');
    assert.equal(setBinding(DEFAULT_BINDINGS, 'chat', 'Escape'), null);
    assert.equal(setBinding(DEFAULT_BINDINGS, 'chat', 'MetaLeft'), null);
    assert.equal(setBinding(DEFAULT_BINDINGS, 'chat', 'F5'), null);
    assert.equal(setBinding(DEFAULT_BINDINGS, 'chat', 'F12'), null);
    assert.equal(isSafeBinding('KeyX'), true);
    assert.equal(isSafeBinding('BrowserBack'), false);
});

test('action input tracks press, hold, release and clears held input on lifecycle changes', () => {
    const manager = new InputManager(null);
    const physical = manager;
    physical.press('KeyW');
    assert.equal(manager.isDown('moveForward'), true);
    assert.equal(manager.wasPressed('moveForward'), false, 'edges are consumed at frame start');
    manager.beginFrame();
    assert.equal(manager.wasPressed('moveForward'), true);
    manager.beginFrame();
    assert.equal(manager.wasPressed('moveForward'), false);
    physical.releaseAll();
    assert.equal(manager.isDown('moveForward'), false);
    manager.beginFrame();
    assert.equal(manager.wasReleased('moveForward'), true);
    manager.destroy();
});

test('recording state is observable so capture-phase gameplay listeners can yield to keybinding capture', () => {
    const manager = new InputManager(null);
    manager.record(() => undefined);
    assert.equal(manager.isRecording, true);
    manager.cancelRecording();
    assert.equal(manager.isRecording, false);
});
