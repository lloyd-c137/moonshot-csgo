import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ACTIONS, DEFAULT_BINDINGS, INPUT_ACTION_MATRIX } from '../src/input/actions.ts';

test('input coverage matrix has exactly one row per remappable action and real consumers', () => {
    assert.deepEqual(INPUT_ACTION_MATRIX.map(({ action }) => action).sort(), [...ACTIONS].sort());
    for (const row of INPUT_ACTION_MATRIX) {
        assert.ok(DEFAULT_BINDINGS[row.action], `${row.action} has a default binding`);
        assert.ok(row.consumers.length, `${row.action} has a consumer`);
        for (const path of row.consumers) {
            const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
            assert.match(source, new RegExp(row.action), `${row.action} is wired in ${path}`);
        }
    }
});

test('only explicit context-safe actions share a default physical input', () => {
    const aliases = new Map([['MouseLeft', new Set(['throw', 'spectateNext'])], ['Space', new Set(['jump', 'skipCutscene'])]]);
    const byBinding = new Map();
    for (const action of ACTIONS) {
        const binding = DEFAULT_BINDINGS[action];
        const actions = byBinding.get(binding) ?? new Set();
        actions.add(action);
        byBinding.set(binding, actions);
    }
    for (const [binding, actions] of byBinding) {
        if (actions.size <= 1) continue;
        assert.deepEqual(actions, aliases.get(binding), `${binding} aliases must be documented and context-safe`);
    }
});
