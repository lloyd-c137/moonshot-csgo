import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    CEREMONY,
    ceremonyOrder,
    entrances,
    entrantAt,
    planCeremony,
    ringLevel,
    shotAt,
    shutterAt
} from '../src/gameplay/ceremony/ceremonyPlan.ts';
import { COURT_SURROUND, intersectRadius } from '../src/world/stadiumLayout.ts';

const world = JSON.parse(readFileSync(new URL('../public/assets/campus/derived/world.json', import.meta.url), 'utf8'));
const { outline, center } = world.arena;
const doors = entrances((angle) => intersectRadius(outline, center, angle));
const players = (count) =>
    Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        name: `P${String(i).padStart(2, '0')}`,
        kills: i % 4,
        colour: [1, 0, 0]
    }));

test('entrants go in order of eliminations, the same on every client', () => {
    const order = ceremonyOrder([
        { id: 'a', name: 'Zed', kills: 1, colour: [0, 0, 0] },
        { id: 'b', name: 'Amy', kills: 3, colour: [0, 0, 0] },
        { id: 'c', name: 'Bob', kills: 1, colour: [0, 0, 0] }
    ]).map((p) => p.id);
    assert.deepEqual(order, ['b', 'c', 'a']);
});

for (const count of [1, 2, 5, 8, 16]) {
    test(`${count} entrant(s): everyone is on their mark before the shutters drop, and it all fits`, () => {
        const plan = planCeremony(players(count), center, doors);
        assert.equal(plan.entrants.length, count);
        const firstShutter = Math.min(...Object.values(plan.shutters));
        for (const e of plan.entrants) {
            assert.ok(e.start >= CEREMONY.fade + CEREMONY.establishing - 1e-9);
            assert.ok(e.start + e.walk <= firstShutter, `${e.id} still walking when the shutters fall`);
            assert.ok(e.walk > 2 && e.walk < 6, `walk of ${e.walk.toFixed(1)} s`);
        }
        assert.ok(plan.holdAt + CEREMONY.hold + CEREMONY.fadeOut <= CEREMONY.seconds + 1e-9);
    });
}

test('marks are inside the arena, clear of the court surround and of each other', () => {
    const plan = planCeremony(players(12), center, doors);
    const { x0, x1, z0, z1 } = COURT_SURROUND;
    for (const e of plan.entrants) {
        const [x, , z] = e.to;
        const r = Math.hypot(x - center[0], z - center[1]);
        assert.ok(r < e.entrance.radius - 2, 'mark not inside the arena');
        const insideSurround = x > x0 + 0.3 && x < x1 - 0.3 && z > z0 + 0.3 && z < z1 - 0.3;
        assert.ok(!insideSurround, `${e.id} marked inside the court surround`);
        // Start is out in the tunnel.
        assert.ok(Math.hypot(e.from[0] - center[0], e.from[2] - center[1]) > e.entrance.radius);
    }
    for (let i = 0; i < plan.entrants.length; i++)
        for (let j = i + 1; j < plan.entrants.length; j++) {
            const a = plan.entrants[i].to,
                b = plan.entrants[j].to;
            assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) > 1.2, 'two marks on top of each other');
        }
});

test('an entrant waits, walks, then turns to face the court', () => {
    const [e] = planCeremony(players(1), center, doors).entrants;
    assert.equal(entrantAt(e, e.start - 1).visible, false);
    assert.equal(entrantAt(e, e.start + e.walk / 2).walking, true);
    const done = entrantAt(e, e.start + e.walk + 1);
    assert.equal(done.arrived, true);
    assert.ok(Math.abs(Math.sin(done.yaw - e.faceYaw)) < 1e-6 && Math.cos(done.yaw - e.faceYaw) > 0);
    // Facing the centre: yaw 0 faces −z.
    const fx = -Math.sin(done.yaw),
        fz = -Math.cos(done.yaw);
    const tx = center[0] - e.to[0],
        tz = center[1] - e.to[2];
    assert.ok((fx * tx + fz * tz) / Math.hypot(tx, tz) > 0.99);
});

test('rings strike centre-out, flash, then hold; shutters fall then stay shut', () => {
    const plan = planCeremony(players(4), center, doors);
    for (let k = 1; k < CEREMONY.rings; k++) assert.ok(plan.ring(k) > plan.ring(k - 1));
    assert.equal(ringLevel(plan, 3, plan.ring(3) - 0.01), 0);
    assert.ok(ringLevel(plan, 3, plan.ring(3) + 0.12) > 1.2);
    assert.ok(Math.abs(ringLevel(plan, 3, plan.ring(3) + 3) - 1) < 1e-9);
    for (const door of doors) {
        assert.equal(shutterAt(plan, door.id, plan.shutters[door.id] - 0.1), 0);
        assert.equal(shutterAt(plan, door.id, plan.shutters[door.id] + CEREMONY.shutterDrop + 0.01), 1);
    }
});

test('the camera always has a sane shot', () => {
    const plan = planCeremony(players(6), center, doors);
    for (let t = 0; t <= CEREMONY.seconds; t += 0.25) {
        const shot = shotAt(plan, center, t);
        assert.ok([...shot.eye, ...shot.target, shot.fov].every(Number.isFinite), `bad shot at ${t}`);
        assert.ok(shot.eye[1] > 0.5);
        // Never inside the roof ring: above its underside (~18.8 m) the camera stays within the opening.
        const r = Math.hypot(shot.eye[0] - center[0], shot.eye[2] - center[1]);
        if (shot.eye[1] > 17.5)
            assert.ok(r < 19, `camera in the roof at t=${t}: r=${r.toFixed(1)} y=${shot.eye[1].toFixed(1)}`);
    }
});
