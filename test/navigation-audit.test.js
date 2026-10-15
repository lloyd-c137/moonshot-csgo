import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAYER } from '../src/config/gameplay.ts';
import { auditFloor, auditTopSeats, loadCampusGeometry } from '../tools/navAudit.ts';

const geometry = loadCampusGeometry();

// Source rooms the capsule still cannot enter at PLAYER.radius: door gaps below 0.56 m or no door in the source walls.
// Opening them needs reviewed GAMEPLAY_AUTHORED door overrides; this list must only shrink.
const KNOWN_UNREACHABLE = [
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

test('with barriers the spawn is enclosed, nothing falls off and known rooms stay reachable', () => {
    assert.equal(PLAYER.radius, 0.28);
    const audit = auditFloor(geometry, { barriers: true });
    assert.ok(audit.spawnFree, 'spawn is clear of inflated geometry');
    assert.equal(audit.fallArea, 0);
    assert.deepEqual([...audit.unreachableRooms].sort(), KNOWN_UNREACHABLE);
    for (const id of ['S308', 'S309', 'COURTYARD-01']) assert.ok(audit.reachableRooms.includes(id), id);
});

test('the top seat row is above the walls, and barriers stop it reaching any wall or glazing top', () => {
    const open = auditTopSeats(geometry, { barriers: false });
    assert.ok(open.seatHeight > 2.8);
    assert.ok(open.wallTopArea > 100, 'without barriers the stand connects to wall tops');
    const closed = auditTopSeats(geometry, { barriers: true });
    assert.equal(closed.wallTopArea, 0);
});
