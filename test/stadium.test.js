import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    aisleDistance,
    petalShape,
    ringRadii,
    seatAssignment,
    spectatorSeats,
    STADIUM,
    tierHeight,
    tierRadius
} from '../src/world/stadiumLayout.ts';

const world = JSON.parse(readFileSync(new URL('../public/assets/campus/derived/world.json', import.meta.url)));
const { outline, center } = world.arena;
const radii = ringRadii(outline, center);

test('the bowl wraps the FF-01 arena outline and rises outward above the 3.6 m building roof', () => {
    assert.equal(radii.length, STADIUM.segments);
    assert.ok(
        radii.every((r) => r > 20 && r < 28),
        'follows the ~22–26 m outline'
    );
    assert.ok(tierHeight(0) >= 4.8 && tierHeight(STADIUM.tiers - 1) > tierHeight(0));
    assert.ok(tierRadius(radii, 0, 5) > tierRadius(radii, 0, 0));
    // Everything stays inside the campus slab (x −67…70, z −61…59).
    const outer = Math.max(...radii) + STADIUM.setback + STADIUM.tiers * STADIUM.tierRun + STADIUM.roofOverhang;
    assert.ok(center[0] - outer > -67 && center[0] + outer < 70 && center[1] - outer > -61 && center[1] + outer < 59);
    // The roof opening sits over the court: its inner edge is inside the outline, high above the stands.
    assert.ok(STADIUM.roofInnerHeight > tierHeight(STADIUM.tiers - 1) + STADIUM.tierRise);
});

test('twelve petals: aisles at the joins, the scallop peaks mid-petal', () => {
    const step = (Math.PI * 2) / STADIUM.petals;
    assert.ok(aisleDistance(0) < 1e-9);
    assert.ok(Math.abs(aisleDistance(step / 2) - step / 2) < 1e-9);
    assert.ok(petalShape(step / 2) > 0.99 && petalShape(0) < 1e-9);
});

test('spectator seats spread over every petal and face the court; assignment is the same on every client', () => {
    const seats = spectatorSeats(radii, center);
    assert.equal(seats.length, 48);
    const petals = new Set(
        seats.map((seat) => {
            const angle = (Math.atan2(seat.z - center[1], seat.x - center[0]) + Math.PI * 2) % (Math.PI * 2);
            return Math.floor(angle / ((Math.PI * 2) / STADIUM.petals));
        })
    );
    assert.equal(petals.size, STADIUM.petals, 'the first twelve spectators already cover all twelve petals');
    for (const seat of seats.slice(0, 12)) {
        assert.ok(seat.y >= tierHeight(0), 'in the upper bowl, out of reach of the court');
        // Yaw convention: forward is (-sin yaw, -cos yaw); it must point toward the centre.
        const yaw = (seat.yaw * Math.PI) / 180;
        const toCentre = [center[0] - seat.x, center[1] - seat.z];
        const length = Math.hypot(...toCentre);
        assert.ok((-Math.sin(yaw) * toCentre[0] - Math.cos(yaw) * toCentre[1]) / length > 0.99);
    }
    const a = seatAssignment(['c', 'a', 'b'], 48),
        b = seatAssignment(['b', 'c', 'a'], 48);
    assert.deepEqual([...a], [...b]);
    assert.equal(seatAssignment(['a', 'b'], 1).size, 1, 'never more spectators than seats');
});
