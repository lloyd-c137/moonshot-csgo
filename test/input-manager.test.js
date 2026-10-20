import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIONS, DEFAULT_BINDINGS } from '../src/input/actions.ts';
import { InputManager } from '../src/input/InputManager.ts';

const keyEvent = (type, code) => {
    const event = new Event(type, { cancelable: true });
    for (const [name, value] of Object.entries({ code, repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false })) {
        Object.defineProperty(event, name, { value });
    }
    return event;
};

test('every registered action has a working remapped press, hold and release lifecycle', () => {
    const target = new EventTarget();
    const document = new EventTarget();
    Object.assign(target, { document });
    const manager = new InputManager(target);
    const bindings = { ...DEFAULT_BINDINGS };

    ACTIONS.forEach((action, index) => { bindings[action] = `Key${String.fromCharCode(65 + index)}`; });
    manager.setBindings(bindings);

    for (const action of ACTIONS) {
        const code = bindings[action];
        target.dispatchEvent(keyEvent('keydown', code));
        manager.beginFrame();
        assert.equal(manager.isDown(action), true, `${action} remains active while held`);
        assert.equal(manager.wasPressed(action), true, `${action} reports its press edge`);
        assert.equal(manager.matchesKey(keyEvent('keydown', code), action), true, `${action} matches its new key`);

        target.dispatchEvent(keyEvent('keyup', code));
        manager.beginFrame();
        assert.equal(manager.isDown(action), false, `${action} releases`);
        assert.equal(manager.wasReleased(action), true, `${action} reports its release edge`);
    }

    manager.destroy();
});
