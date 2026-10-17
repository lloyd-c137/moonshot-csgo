import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    aisleDistance,
    COURT_SURROUND,
    courtSurroundPath,
    inSurroundGap,
    netHeightAt,
    petalJoinDistance,
    petalShape,
    ringRadii,
    seatAssignment,
    spectatorSeats,
    STADIUM,
    TENNIS,
    tennisLines,
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
    assert.ok(tierHeight(STADIUM.tiers - 1) > tierHeight(0));
    assert.ok(tierRadius(radii, 0, 5) > tierRadius(radii, 0, 0));
    // Everything stays inside the campus slab (x −67…70, z −61…59).
    const outer =
        tierRadius(radii, 0, STADIUM.tiers) - radii[0] + Math.max(...radii) + STADIUM.roofOverhang + STADIUM.petalBulge;
    assert.ok(center[0] - outer > -67 && center[0] + outer < 70 && center[1] - outer > -61 && center[1] + outer < 59);
    // The roof opening sits over the court: its inner edge is inside the outline, high above the stands.
    assert.ok(STADIUM.roofInnerHeight > tierHeight(STADIUM.tiers - 1) + STADIUM.tierRise);
});

test('twelve petals with three stair aisles each; the scallop peaks mid-petal', () => {
    const petal = (Math.PI * 2) / STADIUM.petals,
        aisleStep = (Math.PI * 2) / STADIUM.aisles;
    assert.equal(STADIUM.aisles, STADIUM.petals * 3);
    assert.ok(aisleDistance(0) < 1e-9 && aisleDistance(petal) < 1e-9, 'every petal join is an aisle');
    assert.ok(Math.abs(aisleDistance(aisleStep / 2) - aisleStep / 2) < 1e-9);
    assert.ok(petalJoinDistance(0) < 1e-9 && Math.abs(petalJoinDistance(petal / 2) - petal / 2) < 1e-9);
    assert.ok(petalShape(petal / 2) > 0.99 && petalShape(0) < 1e-9);
});

test('court surround: boards clear of both stands, inside the outline, with four walk-throughs', () => {
    const path = courtSurroundPath();
    assert.ok(path.length > 60);
    for (const [x, z] of path) {
        assert.ok(x > -25 && x < 7, 'clear of the west (x ≤ −25) and east (x ≥ 7) stands');
        assert.ok(Math.hypot(x - center[0], z - center[1]) < Math.min(...radii), 'inside the arena outline');
    }
    const { x0, x1, z0, z1 } = COURT_SURROUND;
    assert.ok(inSurroundGap((x0 + x1) / 2, z0) && inSurroundGap(x0, (z0 + z1) / 2));
    assert.equal(inSurroundGap(x0 + 4, z0), false);
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

test('tennis court: ITF dimensions on the FF-01 court, a raised net that sags toward the centre strap', () => {
    // Doubles court fits the FF-01 Arena_Court surface (x −13.9…−2.9, z −14.7…9.0).
    assert.ok(TENNIS.centerX - TENNIS.doublesHalfWidth >= -13.95 && TENNIS.centerX + TENNIS.doublesHalfWidth <= -2.85);
    assert.ok(TENNIS.netZ - TENNIS.halfLength >= -14.75 && TENNIS.netZ + TENNIS.halfLength <= 9.05);
    assert.ok(Math.abs(netHeightAt(TENNIS.centerX) - TENNIS.centreHeight) < 1e-9);
    assert.ok(
        Math.abs(netHeightAt(TENNIS.centerX + TENNIS.doublesHalfWidth + TENNIS.postOffset) - TENNIS.postHeight) < 1e-9
    );
    assert.ok(TENNIS.centreHeight >= 1.2 && TENNIS.postHeight > TENNIS.centreHeight, 'owner: net raised');
    const lines = tennisLines();
    assert.equal(lines.length, 12);
    for (const [x0, z0, x1, z1] of lines) assert.ok(x1 > x0 && z1 > z0);
});
