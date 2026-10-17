import assert from 'node:assert/strict';
import test from 'node:test';

import { SPAWN_POINTS } from '../src/config/spawns.ts';
import {
    chargeSpeed,
    closestPointOnSegment,
    discAcceleration,
    discContactWithPlayer,
    discHitsPlayer,
    earliestDiscContact,
    launchNormal,
    segmentDistance,
    simulateFlight,
    THROW
} from '../src/gameplay/frisbee.ts';
import { auditFloor, loadCampusGeometry } from '../tools/navAudit.ts';

const range = (points) => Math.hypot(points.at(-1)[0] - points[0][0], points.at(-1)[2] - points[0][2]);

test('a level throw glides much further than a ballistic object and stays airborne longer', () => {
    const speed = chargeSpeed(THROW.chargeSeconds);
    assert.equal(speed, THROW.maxSpeed);
    const v = [speed, 0, 0];
    const disc = simulateFlight([0, 1.5, 0], v, launchNormal(v));
    const ballisticRange = speed * Math.sqrt((2 * 1.5) / 9.81);
    assert.ok(
        range(disc) > ballisticRange * 2,
        `disc ${range(disc).toFixed(1)} m vs ballistic ${ballisticRange.toFixed(1)} m`
    );
    assert.ok(range(disc) < 70, `stays inside campus scale (${range(disc).toFixed(1)} m)`);
    // A quick flick still carries across a corridor.
    const flick = simulateFlight([0, 1.5, 0], [THROW.minSpeed, 0, 0], launchNormal([1, 0, 0]));
    assert.ok(range(flick) > 8, `flick ${range(flick).toFixed(1)} m`);
});

test('lift acts against gravity for a nose-up disc and drag slows it', () => {
    const v = [15, 0, 0];
    const a = discAcceleration(v, launchNormal(v), 9.81);
    assert.ok(a[1] > 0, 'upward lift');
    assert.ok(a[0] < 0, 'drag opposes motion');
    // Game gravity is compensated back to 9.81 m/s².
    const still = discAcceleration([0, 0, 0], [0, 1, 0], 18);
    assert.ok(Math.abs(still[1] - (18 - 9.81)) < 1e-9);
    // Banking the disc turns the lift sideways.
    const banked = discAcceleration(v, launchNormal(v, 0.5), 9.81);
    assert.ok(banked[2] > 0.5, 'banked disc curves toward its tilt');
});

test('hit geometry: segment–capsule distance and player hits', () => {
    assert.equal(segmentDistance([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]), 1);
    assert.equal(segmentDistance([0, 1, 0], [10, 1, 0], [5, 0, 0], [5, 0, 0]), 1);
    assert.ok(Math.abs(segmentDistance([0, 0, -1], [0, 0, 1], [-1, 0.5, 0], [1, 0.5, 0]) - 0.5) < 1e-12);
    const centre = [5, 0.92, 0];
    assert.ok(discHitsPlayer([4, 1.4, 0], [6, 1.4, 0], centre), 'through the chest');
    assert.ok(discHitsPlayer([5.4, 1.0, -1], [5.4, 1.0, 1], centre), 'grazing the side');
    assert.ok(!discHitsPlayer([4, 2.6, 0], [6, 2.6, 0], centre), 'over the head');
    assert.ok(!discHitsPlayer([5.6, 1.0, -1], [5.6, 1.0, 1], centre), 'clear miss');
});

test('closest point on a swept disc segment is clamped to the actual fly-by location', () => {
    assert.deepEqual(closestPointOnSegment([0, 2, 0], [10, 2, 0], [4, 0, 1]), [4, 2, 0]);
    assert.deepEqual(closestPointOnSegment([0, 2, 0], [10, 2, 0], [-3, 0, 1]), [0, 2, 0]);
    assert.deepEqual(closestPointOnSegment([0, 2, 0], [10, 2, 0], [12, 0, 1]), [10, 2, 0]);
    assert.deepEqual(closestPointOnSegment([3, 2, 1], [3, 2, 1], [9, 0, 1]), [3, 2, 1]);
});

test('contact result returns the earliest swept point and stable earliest target', () => {
    const centre = [5, 0.92, 0];
    const contact = discContactWithPlayer([0, 1.4, 0], [10, 1.4, 0], centre);
    assert.ok(contact);
    assert.ok(Math.abs(contact.fraction - 0.4505) < 1e-5);
    assert.ok(Math.abs(contact.at[0] - 4.505) < 1e-4);
    assert.equal(contact.region, 'head');
    assert.deepEqual(contact.impactDirection, [1, 0, 0]);

    const targets = new Map([
        ['farther', [7, 0.92, 0]],
        ['nearer', [5, 0.92, 0]],
        ['owner', [2, 0.92, 0]]
    ]);
    const earliest = earliestDiscContact([0, 1.1, 0], [10, 1.1, 0], targets, 'owner');
    assert.equal(earliest?.target, 'nearer');
    assert.ok(earliest?.contact.fraction && earliest.contact.fraction < 0.451);
});

test('every respawn point is on reachable floor with clearance', () => {
    const audit = auditFloor(loadCampusGeometry());
    assert.ok(SPAWN_POINTS.length >= 16);
    for (const [x, z] of SPAWN_POINTS) {
        const k = audit.grid.index(x, z);
        assert.ok(audit.reached[k] && audit.floor[k] && !audit.inflated[k], `${x}, ${z}`);
    }
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
        for (let j = i + 1; j < SPAWN_POINTS.length; j++) {
            const [a, b] = [SPAWN_POINTS[i], SPAWN_POINTS[j]];
            assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 8, 'spread apart');
        }
    }
});
