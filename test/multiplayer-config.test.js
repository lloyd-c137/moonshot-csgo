import assert from 'node:assert/strict';
import test from 'node:test';

import { multiplayerUrl } from '../src/config/multiplayer.ts';
import { apiBase, apiUrl } from '../src/net/auth.ts';

test('production account and room traffic use the Pages origin', () => {
    const room = multiplayerUrl('', true, 'moonshot-csgo.pages.dev');
    assert.equal(room, 'wss://moonshot-csgo.pages.dev/ws');
    assert.equal(apiBase(room), 'https://moonshot-csgo.pages.dev');
});

test('local previews remain offline unless a local room is explicitly supplied', () => {
    assert.equal(multiplayerUrl('', true, '127.0.0.1'), null);
    assert.equal(multiplayerUrl('?offline=1', true, 'moonshot-csgo.pages.dev'), null);
    assert.equal(
        multiplayerUrl('?server=ws://127.0.0.1:8787/ws', false, 'localhost'),
        'ws://127.0.0.1:8787/ws'
    );
});

test('campus builds select ws or wss from the serving protocol and keep the explicit server override', () => {
    assert.equal(multiplayerUrl('', true, '172.10.17.186:8000', 'http:'), 'ws://172.10.17.186:8000/ws');
    assert.equal(multiplayerUrl('', true, 'moonshotacademy.space', 'https:'), 'wss://moonshotacademy.space/ws');
});

test('test-only room selectors are preserved for the corresponding API namespace', () => {
    const base = apiBase('ws://127.0.0.1:8787/ws?testRoom=george-a');
    assert.equal(base, 'http://127.0.0.1:8787?testRoom=george-a');
    assert.equal(apiUrl(base, '/api/signin'), 'http://127.0.0.1:8787/api/signin?testRoom=george-a');
});
