import assert from 'node:assert/strict';
import test from 'node:test';

import { Room } from '../server/room.ts';
import { canUseCrouch } from '../src/net/compatibility.ts';
import { PROTOCOL_VERSION } from '../src/net/protocol.ts';

test('new client keeps online crouch disabled when an old server omits crouch-v1', () => {
    const oldServerWelcome = { type: 'welcome', id: 'p', name: 'P', players: [], round: { phase: 'playing' } };
    assert.equal('crouchV1' in oldServerWelcome, false);
    assert.equal(canUseCrouch('online', oldServerWelcome.crouchV1 === true), false);
});

test('new server accepts an old standing pose and does not invent a crouched stance', () => {
    const inbox = [];
    const room = new Room({
        to: (_id, message) => inbox.push(message),
        all: (message) => inbox.push(message),
        close: (id) => inbox.push({ type: 'closed', id })
    }, 8);
    room.connect('legacy');
    room.message('legacy', { type: 'hello', version: PROTOCOL_VERSION, name: 'Legacy' }, 0);
    const welcome = inbox.find((message) => message.type === 'welcome');
    assert.equal(welcome.crouchV1, true);
    room.message('legacy', { type: 'pose', pose: { p: [4, 0.92, 3], yaw: 0, pitch: 0 } }, 100);
    assert.notEqual(room.players.get('legacy').pose.crouched, true);
});

test('online crouch is enabled only for advertised new-server capability; offline practice remains available', () => {
    assert.equal(canUseCrouch('online', true), true);
    assert.equal(canUseCrouch('online', false), false);
    assert.equal(canUseCrouch('offline', false), true);
    assert.equal(canUseCrouch('rejected', false), true);
    assert.equal(canUseCrouch('connecting', false), false);
});
