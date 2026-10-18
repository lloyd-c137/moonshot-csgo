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
    FAN_SECTION,
    fanSectionFocus,
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

test('spectators sit together in one section, face the court, and fill it front row first', () => {
    const seats = spectatorSeats(radii, center);
    assert.equal(seats.length, 48);
    // All in the fans' section: within one petal's width of its centre line.
    for (const seat of seats) {
        const angle = Math.atan2(seat.z - center[1], seat.x - center[0]);
        let d = Math.abs(angle - FAN_SECTION.angle);
        if (d > Math.PI) d = Math.PI * 2 - d;
        assert.ok(d < Math.PI / STADIUM.petals, 'a seat outside the fans section');
    }
    // The first few (a small crowd) share the front row, side by side.
    const first = seats.slice(0, 5);
    assert.ok(first.every((seat) => seat.y === first[0].y));
    for (let i = 1; i < seats.length; i++)
        for (let j = 0; j < i; j++)
            assert.ok(Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y, seats[i].z - seats[j].z) > 0.45, 'two fans in one seat');
    const focus = fanSectionFocus(radii, center);
    assert.ok(focus.every(Number.isFinite) && focus[1] > tierHeight(10));
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

test('outer shell: twelve separate petals leaning outward, clear of the bowl, under the roof', () => {
    const { shell } = STADIUM;
    assert.equal(STADIUM.petals, 12);
    assert.ok(shell.footSpread < shell.topSpread && shell.topSpread < 1, 'gaps between neighbouring petals');
    const leanDeg = (Math.atan2(shell.lean, shell.topHeight - shell.footHeight) * 180) / Math.PI;
    assert.ok(leanDeg > 20 && leanDeg < 40, `petals lean out like the photo (${leanDeg.toFixed(0)}°)`);
    // The bowl's back (top tier plus glazing) stays inside the petals' foot ring and below their top.
    const bowlTop = tierHeight(STADIUM.tiers - 1) + STADIUM.tierRise;
    assert.ok(shell.footOut > 0 && bowlTop < shell.topHeight, `bowl top ${bowlTop.toFixed(1)} m`);
    assert.ok(shell.footHeight > STADIUM.facadeBottom && STADIUM.roofInnerHeight > shell.topHeight);
});
