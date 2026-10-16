import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseCampusRooms } from '../src/world/roomIndex.ts';
import { signText } from '../src/world/signText.ts';

const world = JSON.parse(readFileSync(new URL('../public/assets/campus/derived/world.json', import.meta.url), 'utf8'));
const rooms = parseCampusRooms(
    JSON.parse(readFileSync(new URL('../public/assets/campus/rooms.json', import.meta.url), 'utf8'))
);

test('every region room except open courtyards and one open plant room has a door sign', () => {
    const signed = new Set(world.signs.map((sign) => sign.room));
    assert.equal(signed.size, world.signs.length, 'one sign per room');
    const missing = rooms.rooms.filter((room) => room.hasRegion && !signed.has(room.id)).map((room) => room.id);
    assert.deepEqual(missing.sort(), ['COURTYARD-01', 'COURTYARD-02', 'SVC-31']);
    for (const sign of world.signs) {
        for (const mount of [sign.blade, sign.plaque]) assert.ok([mount.x, mount.z, mount.yaw].every(Number.isFinite));
        // Blade and plaque flank the same door.
        assert.ok(Math.hypot(sign.blade.x - sign.plaque.x, sign.blade.z - sign.plaque.z) < 4.5, sign.room);
    }
});

test('M104 is signed on the corridor side of its north doors, like the photographed sign', () => {
    const sign = world.signs.find((entry) => entry.room === 'M104');
    assert.ok(sign.blade.z < 41.16 && sign.plaque.z < 41.16, 'outside the room (north)');
    assert.ok(Math.abs(sign.blade.yaw + Math.PI / 2) < 0.01, 'faces north into the corridor');
    assert.deepEqual(signText(rooms.rooms.find((room) => room.id === 'M104')), {
        code: 'M104',
        chinese: ['一小步', '空间'],
        english: ['ONE SMALL STEP', 'SPACE']
    });
});
