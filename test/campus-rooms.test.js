import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    createAnchorTriggers,
    findLocationAt,
    findRoomAt,
    parseCampusRooms,
    pointInRoom,
    RoomTracker
} from '../src/world/roomIndex.ts';

const asset = JSON.parse(readFileSync(new URL('../public/assets/campus/rooms.json', import.meta.url)));

test('imports all source room IDs and preserves the six label-only spaces', () => {
    const data = parseCampusRooms(asset);
    assert.equal(data.rooms.length, 165);
    assert.equal(data.rooms.filter((room) => room.hasRegion).length, 159);
    assert.deepEqual(
        data.rooms.filter((room) => !room.hasRegion).map((room) => room.id),
        ['S407', 'TEA-ROOM-01', 'ENTRANCE-EAST', 'ENTRANCE-SOUTH', 'INNOVATION-01', 'ENTRANCE-WEST']
    );
});

test('contains concave, negative-coordinate and outer-boundary points; excludes polygon holes', () => {
    const room = {
        id: 'L',
        name: 'L-shaped fixture',
        nameEnglish: null,
        kind: 'room',
        kindLabel: 'room',
        hasRegion: true,
        geometryStatus: 'fixture',
        polygon: {
            outer: [
                [-4, -4],
                [0, -4],
                [0, -3],
                [-3, -3],
                [-3, 0],
                [-4, 0]
            ],
            holes: [
                [
                    [-3.8, -3.8],
                    [-3.4, -3.8],
                    [-3.4, -3.4],
                    [-3.8, -3.4]
                ]
            ]
        }
    };
    assert.equal(pointInRoom([-3.9, -3], room), true);
    assert.equal(pointInRoom([-2, -2], room), false);
    assert.equal(pointInRoom([-3.6, -3.6], room), false);
    assert.equal(pointInRoom([-4, -3], room), true);
    assert.equal(pointInRoom([-3.8, -3.6], room), false);
});

test('overlapping regions resolve to the smallest region, then stable ID order', () => {
    const rooms = parseCampusRooms({
        model: 'FF01-CAMPUS-3D-V1',
        status: 'SOURCE_DERIVED_3D_UNVERIFIED',
        frame: { units: 'm', axes: { x: 'east', y: 'up', z: 'south' } },
        rooms: [
            {
                id: 'large',
                name: 'Large',
                kind: 'room',
                hasRegion: true,
                polygon: {
                    outer: [
                        [0, 0],
                        [4, 0],
                        [4, 4],
                        [0, 4]
                    ]
                }
            },
            {
                id: 'small-b',
                name: 'Small B',
                kind: 'room',
                hasRegion: true,
                polygon: {
                    outer: [
                        [1, 1],
                        [3, 1],
                        [3, 3],
                        [1, 3]
                    ]
                }
            },
            {
                id: 'small-a',
                name: 'Small A',
                kind: 'room',
                hasRegion: true,
                polygon: {
                    outer: [
                        [1, 1],
                        [3, 1],
                        [3, 3],
                        [1, 3]
                    ]
                }
            }
        ]
    });
    assert.equal(findRoomAt([2, 2], rooms.rooms)?.id, 'small-a');
});

test('room tracking filters boundary jitter and reports exits to unknown', () => {
    const room = parseCampusRooms({
        model: 'FF01-CAMPUS-3D-V1',
        status: 'SOURCE_DERIVED_3D_UNVERIFIED',
        frame: { units: 'm', axes: { x: 'east', y: 'up', z: 'south' } },
        rooms: [
            {
                id: 'R1',
                name: 'Test Room',
                kind: 'room',
                hasRegion: true,
                polygon: {
                    outer: [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                        [0, 2]
                    ]
                }
            }
        ]
    }).rooms;
    const changes = [];
    const tracker = new RoomTracker(room, (next) => changes.push(next?.id ?? null), 0.35, 0.2);
    tracker.update([1, 1], 0.2);
    tracker.update([1, 1], 0.2);
    assert.equal(tracker.current?.id, 'R1');
    tracker.update([2.15, 1], 0.2);
    tracker.update([1.98, 1], 0.2);
    assert.equal(tracker.current?.id, 'R1');
    tracker.update([3, 1], 0.2);
    tracker.update([3, 1], 0.2);
    assert.equal(tracker.current, undefined);
    assert.deepEqual(changes, ['R1', null]);
});

test('label-only spaces resolve through source anchors only where no polygon applies', () => {
    const data = parseCampusRooms({
        model: 'FF01-CAMPUS-3D-V1',
        status: 'SOURCE_DERIVED_3D_UNVERIFIED',
        frame: { units: 'm', axes: { x: 'east', y: 'up', z: 'south' } },
        rooms: [
            {
                id: 'POLY',
                name: 'Polygon Room',
                kind: 'room',
                hasRegion: true,
                polygon: {
                    outer: [
                        [0, 0],
                        [2, 0],
                        [2, 2],
                        [0, 2]
                    ]
                }
            },
            { id: 'LOBBY', name: 'Lobby', kind: 'public', hasRegion: false }
        ]
    }).rooms;
    assert.throws(() => createAnchorTriggers(data, new Map(), 4), /LOBBY has no source label anchor/);
    const anchors = createAnchorTriggers(data, new Map([['LOBBY', [1, 1]]]), 4);
    assert.equal(findLocationAt([1, 1], data, anchors)?.id, 'POLY');
    assert.equal(findLocationAt([4, 1], data, anchors)?.id, 'LOBBY');
    assert.equal(findLocationAt([6, 1], data, anchors), undefined);

    const changes = [];
    const tracker = new RoomTracker(data, (room) => changes.push(room?.id ?? null), 0.35, 0.2, anchors);
    tracker.update([4, 1], 0.2);
    tracker.update([4, 1], 0.2);
    assert.equal(tracker.current?.id, 'LOBBY');
    tracker.update([5.2, 1], 0.2);
    tracker.update([5.2, 1], 0.2);
    assert.equal(tracker.current?.id, 'LOBBY', 'hysteresis keeps the anchor just outside its radius');
    tracker.update([1, 1], 0.2);
    tracker.update([1, 1], 0.2);
    assert.equal(tracker.current?.id, 'POLY');
    assert.deepEqual(changes, ['LOBBY', 'POLY']);
});
