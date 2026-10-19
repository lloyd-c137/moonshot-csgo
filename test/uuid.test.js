import assert from 'node:assert/strict';
import test from 'node:test';

import { createUuid } from '../src/net/uuid.ts';

test('UUID fallback uses random bytes and sets RFC 4122 version and variant bits', () => {
    const source = {
        getRandomValues(bytes) {
            bytes.fill(0);
            return bytes;
        }
    };
    assert.equal(createUuid(source), '00000000-0000-4000-8000-000000000000');
});

test('UUID helper prefers the platform randomUUID implementation', () => {
    const source = { randomUUID: () => 'platform-uuid', getRandomValues: () => { throw new Error('unused'); } };
    assert.equal(createUuid(source), 'platform-uuid');
});
