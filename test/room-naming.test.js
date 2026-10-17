import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROOM_NAMING } from '../src/config/roomNaming.ts';
import { findLocationAt, parseCampusRooms, pointInRoom } from '../src/world/roomIndex.ts';
import { applyRoomNaming, chooseSigns, drawingCode, roomLabel } from '../src/world/roomNaming.ts';
import { signText } from '../src/world/signText.ts';
import { deriveRoomNaming } from '../tools/roomNaming.ts';

const ff01 = parseCampusRooms(JSON.parse(readFileSync(new URL('../public/assets/campus/rooms.json', import.meta.url))));
const source = JSON.parse(
    readFileSync(new URL('../public/assets/campus/source-20260806/rooms.json', import.meta.url))
).rooms;
const world = JSON.parse(readFileSync(new URL('../public/assets/campus/derived/world.json', import.meta.url)));
const named = applyRoomNaming(ff01.rooms, ROOM_NAMING);
const regional = named.filter((room) => room.hasRegion);
const centre = (id) => {
    const ring = ff01.rooms.find((room) => room.id === id).polygon.outer;
    // A point safely inside: the sample nearest the centroid that lies in the polygon.
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length,
        cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const room = ff01.rooms.find((r) => r.id === id);
    for (let r = 0; r < 6; r += 0.1)
        for (let a = 0; a < 6.28; a += 0.3) {
            const p = [cx + r * Math.cos(a), cz + r * Math.sin(a)];
            if (pointInRoom(p, room)) return p;
        }
    throw new Error(`no interior point for ${id}`);
};
const at = (point) => findLocationAt(point, regional);

test('the committed naming layer matches a fresh derivation', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(ROOM_NAMING)), JSON.parse(JSON.stringify(deriveRoomNaming())));
    assert.ok(ROOM_NAMING.fit.medianError < 1.5, 'fit agrees with FF-01 to about a metre');
});

test('every 2026-08-06 room is present with its own name; every FF-01 region is used exactly once', () => {
    for (const room of source) {
        const entries = named.filter((entry) => entry.id === room.id);
        assert.ok(entries.length >= 1, `${room.id} missing`);
        for (const entry of entries) assert.equal(entry.name, room.name);
    }
    const regions = ff01.rooms.filter((room) => room.hasRegion).map((room) => room.id);
    const uses = named.filter((room) => room.sourceId).map((room) => room.sourceId);
    assert.deepEqual([...uses].sort(), [...regions].sort());
});

test('names and division follow the 2026-08-06 model over FF-01 geometry', () => {
    // The thirteen spaces FF-01 did not name.
    assert.equal(at(centre('THEATER-01')).name, '小剧场');
    for (const piece of ['WC-10', 'WC-11'])
        assert.deepEqual([at(centre(piece)).id, at(centre(piece)).name], ['M-WC1', '卫生间'], piece);
    assert.equal(at(centre('SVC-21')).name, '大自习室');
    for (const id of ['A-I', 'M-COFFEE', 'A-TEA', 'S407']) {
        const room = named.find((entry) => entry.id === id);
        const ring = room.polygon.outer;
        const p = [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length];
        assert.equal(at(p).id, id, `${id} has its own fitted region`);
    }
    // The seven renamed rooms.
    assert.equal(at(centre('S100')).name, '大自习室');
    assert.equal(at(centre('S406')).name, '大自习室');
    assert.equal(at(centre('S102')).name, '阅览室');
    assert.equal(at(centre('A209')).name, '小初办公室', 'renumbered between drawings');
    assert.equal(at(centre('A208')).name, '心理办公室');
    assert.deepEqual([at(centre('A207')).name, at(centre('A207')).code], ['未编号房间', '']);
    // Gameplay locations keep their ids.
    for (const id of ['S103', 'S308', 'M104']) assert.equal(at(centre(id)).id, id);
    assert.equal(at(centre('SVC-10')).id, 'SVC-10', 'the breaker room is not in the newer model and stays');
    // Superseded label-only spaces are gone; entrances remain.
    assert.ok(!named.some((room) => ['TEA-ROOM-01', 'INNOVATION-01'].includes(room.id)));
    assert.ok(named.some((room) => room.id === 'ENTRANCE-EAST' && !room.hasRegion));
});

test('drawing numbers are shown, app-internal ids are not', () => {
    assert.equal(drawingCode('M123'), 'M123');
    assert.equal(drawingCode('S308-1'), 'S308-1');
    assert.equal(drawingCode('M-WC1'), '');
    assert.equal(drawingCode('A-TEA'), '');
    assert.deepEqual(signText({ ...named.find((room) => room.id === 'M-COFFEE'), code: '' }), {
        code: '',
        chinese: [],
        english: ['MOON COFFEE']
    });
});

test('a room made of several FF-01 regions keeps one door sign, with the new name', () => {
    const chosen = chooseSigns(world.signs, named);
    const perRoom = new Map();
    for (const { room } of chosen) perRoom.set(room.id, (perRoom.get(room.id) ?? 0) + 1);
    assert.ok([...perRoom.values()].every((count) => count === 1));
    const theatre = chosen.find(({ room }) => room.id === 'M-T');
    if (theatre) assert.equal(signText(theatre.room).chinese.join(''), '小剧场');
    const psych = chosen.find(({ sign }) => sign.room === 'A208');
    assert.equal(psych.room.name, '心理办公室');
});

test('every place shows a readable label: a drawing number or a name, never an internal id or a placeholder', () => {
    for (const room of named) {
        const label = roomLabel(room);
        assert.ok(label.code || label.name, `${room.id} shows nothing`);
        assert.ok(!/^[A-Z]+-[A-Z0-9]/.test(label.code) && !label.code.includes(':'), `${room.id} shows ${label.code}`);
        assert.ok(!/待核实|未编号/.test(label.name), `${room.id} shows a placeholder`);
    }
    assert.deepEqual(roomLabel(named.find((room) => room.id === 'M-T')), { code: '', name: '小剧场' });
    assert.deepEqual(roomLabel(named.find((room) => room.id === 'A-I')), { code: '', name: '创新区' });
    assert.deepEqual(roomLabel(named.find((room) => room.id === 'SVC-01')), { code: '', name: '机房' });
    assert.equal(signText(named.find((room) => room.id === 'STAIR-01')).code, '');
});
