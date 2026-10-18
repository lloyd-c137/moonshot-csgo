import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAYER } from '../src/config/gameplay.ts';
import { ITEM_RULES, ITEM_SPAWNS, NPC_SPAWNS } from '../src/config/gameplayItems.ts';
import { pointInRoom } from '../src/world/roomIndex.ts';
import { auditFloor, auditTopSeats, loadCampusGeometry } from '../tools/navAudit.ts';

const geometry = loadCampusGeometry();

// Rooms the source walls seal off (door gaps below 0.56 m or no door at all). Each now gets exactly one
// GAMEPLAY_AUTHORED doorway (public/assets/campus/derived/world.json → doorways).
const SEALED_BY_SOURCE = [
    'A106',
    'A203',
    'COURTYARD-02',
    'M124',
    'S204',
    'S205',
    'S206',
    'S207',
    'S406',
    'SVC-01',
    'SVC-03',
    'SVC-05',
    'SVC-11',
    'SVC-15'
];

test('every label-only space has a source label anchor for its trigger', () => {
    for (const room of geometry.rooms.filter((candidate) => !candidate.hasRegion)) {
        const [, y] = geometry.scene.position(`Label_${room.id}`);
        assert.equal(y, 0, `${room.id} anchor sits on the floor`);
    }
});

test('source geometry alone lets the player walk off the slab (regression baseline)', () => {
    const audit = auditFloor(geometry, { barriers: false });
    assert.ok(audit.fallArea > 100, `expected open slab edges, got ${audit.fallArea} m²`);
});

test('with barriers and authored doorways every source room is reachable and nothing falls off', () => {
    assert.equal(PLAYER.radius, 0.28);
    const audit = auditFloor(geometry, { barriers: true });
    assert.ok(audit.spawnFree, 'spawn is clear of inflated geometry');
    assert.equal(audit.fallArea, 0);
    assert.deepEqual(audit.unreachableRooms, []);
    assert.deepEqual(geometry.doorways.map((doorway) => doorway.room).sort(), SEALED_BY_SOURCE);
    const sealed = auditFloor(geometry, { cuts: [] });
    assert.deepEqual([...sealed.unreachableRooms].sort(), SEALED_BY_SOURCE, 'without doorways the source seals them');
    for (const id of ['S308', 'S309', 'COURTYARD-01']) assert.ok(audit.reachableRooms.includes(id), id);
});

test('the top seat row is above the walls, and barriers stop it reaching any wall or glazing top', () => {
    const open = auditTopSeats(geometry, { barriers: false });
    assert.ok(open.seatHeight > 2.8);
    assert.ok(open.wallTopArea > 100, 'without barriers the stand connects to wall tops');
    const closed = auditTopSeats(geometry, { barriers: true });
    assert.equal(closed.wallTopArea, 0);
});

test('all GAMEPLAY_AUTHORED item and NPC positions are walkable inside their named source room', () => {
    const audit = auditFloor(geometry, { barriers: true, resolution: 0.05 });
    for (const spawn of [...ITEM_SPAWNS, ...NPC_SPAWNS]) {
        const room = geometry.rooms.find((candidate) => candidate.id === spawn.room);
        assert.ok(room?.hasRegion, `${spawn.id} room ${spawn.room} needs an imported region`);
        assert.ok(pointInRoom([spawn.at[0], spawn.at[2]], room), `${spawn.id} lies inside ${spawn.room}`);
        const cell = audit.grid.index(spawn.at[0], spawn.at[2]);
        assert.ok(cell >= 0 && audit.floor[cell] && !audit.inflated[cell], `${spawn.id} has floor and capsule clearance`);
        assert.ok(audit.reached[cell], `${spawn.id} is reachable from the campus spawn`);
    }

    for (const item of ITEM_SPAWNS) {
        for (const npc of NPC_SPAWNS) {
            const separation = Math.hypot(item.at[0] - npc.at[0], item.at[2] - npc.at[2]);
            assert.ok(
                separation > ITEM_RULES.pickupRadius * 2,
                `${item.id} must be outside overlapping pickup/interaction range of ${npc.id} (${separation.toFixed(2)} m)`
            );
        }
    }
});
