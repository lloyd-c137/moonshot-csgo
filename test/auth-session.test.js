import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuth } from '../src/net/auth.ts';

test('session restore preserves a saved token on transient errors and clears it only on 401', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const values = new Map([['moonshot.session', 'saved-session-token']]);
    let status = 403;

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key) => values.get(key) ?? null,
                setItem: (key, value) => values.set(key, value),
                removeItem: (key) => values.delete(key)
            }
        }
    });
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: async () =>
            new Response(JSON.stringify({ error: 'request rejected' }), {
                status,
                headers: { 'content-type': 'application/json' }
            })
    });

    try {
        const auth = createAuth('https://moonshot-csgo.pages.dev');
        await assert.rejects(auth.restore(), /request rejected/);
        assert.equal(values.get('moonshot.session'), 'saved-session-token');

        status = 401;
        assert.equal(await auth.restore(), null);
        assert.equal(values.has('moonshot.session'), false);
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else delete globalThis.window;
        if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
        else delete globalThis.fetch;
    }
});
