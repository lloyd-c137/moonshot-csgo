import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { clipUnderBowl } from '../src/physics/boundaryBarriers.ts';
import {
    aisleAngles,
    aisleTreads,
    bowlCollider,
    lineHeight,
    nosingLine,
    SOURCE_STAND_AISLES,
    SOURCE_STAND_ROWS,
    standBlocks,
    standStair,
    tierRadiusAt,
    underBowl
} from '../src/world/arenaAccess.ts';
import { intersectRadius, ringRadii, STADIUM, tierHeight } from '../src/world/stadiumLayout.ts';

const world = JSON.parse(readFileSync(new URL('../public/assets/campus/derived/world.json', import.meta.url), 'utf8'));
const { outline, center } = world.arena;
const radii = ringRadii(outline, center);

test('every bowl aisle ramp runs over its steps and stays walkable', () => {
    for (const angle of aisleAngles()) {
        const treads = aisleTreads(radii, angle);
        const line = nosingLine(treads);
        for (const { r0, r1, y } of treads) {
            for (const r of [r0, r1 - 1e-6]) {
                const height = lineHeight(line, r);
                assert.ok(height >= y - 1e-9, `ramp under a tread at r=${r.toFixed(2)}`);
                assert.ok(height - y <= STADIUM.tierRise / 2 + 1e-9, 'ramp floats more than a half step');
            }
        }
        for (let i = 1; i < line.length; i++) {
            const slope = Math.atan2(line[i][1] - line[i - 1][1], line[i][0] - line[i - 1][0]);
            assert.ok(slope <= (37 * Math.PI) / 180, `aisle ramp too steep: ${((slope * 180) / Math.PI).toFixed(1)}°`);
        }
        assert.equal(line[0][1], STADIUM.fasciaTop);
        assert.equal(line.at(-1)[1], tierHeight(STADIUM.tiers - 1) + STADIUM.tierRise / 2);
    }
});

test('the bowl collider is a closed set of quads with a back wall', () => {
    const mesh = bowlCollider(radii, center);
    assert.equal(mesh.indices.length % 6, 0);
    assert.ok(mesh.positions.every(Number.isFinite));
    const ys = mesh.positions.filter((_, i) => i % 3 === 1);
    assert.equal(Math.min(...ys), STADIUM.fasciaTop);
    assert.ok(Math.max(...ys) >= 20);
});

test('court-level stand rows leave no gaps, keep the source walkways open, and each stair clears every seat', () => {
    for (const side of ['west', 'east']) {
        const angle = side === 'west' ? Math.PI : 0;
        const dir = side === 'west' ? -1 : 1;
        const wall = intersectRadius(outline, center, angle);
        const blocks = standBlocks(side, center[0] + dir * wall);
        const rowOf = (block) => SOURCE_STAND_ROWS.findIndex((row) => row.top === block.top);
        for (let k = 1; k < SOURCE_STAND_ROWS.length; k++) {
            const here = blocks.filter((block) => rowOf(block) === k)[0];
            const before = blocks.filter((block) => rowOf(block) === k - 1)[0];
            const touching = side === 'west' ? here.x1 === before.x0 : here.x0 === before.x1;
            assert.ok(touching, `gap between rows ${k - 1} and ${k}`);
        }
        // Nothing solid in the walkways (they were invisible walls that trapped players).
        for (const block of blocks)
            for (const [g0, g1] of SOURCE_STAND_AISLES) assert.ok(block.z1 <= g0 || block.z0 >= g1, 'a row fills a walkway');
        // Every row still covers its seats outside the walkways.
        for (let k = 0; k < SOURCE_STAND_ROWS.length; k++) {
            const covered = blocks.filter((block) => rowOf(block) === k).reduce((sum, block) => sum + (block.z1 - block.z0), 0);
            const open = SOURCE_STAND_AISLES.reduce(
                (sum, [g0, g1]) => sum + Math.max(0, Math.min(g1, SOURCE_STAND_ROWS[k].z1) - Math.max(g0, SOURCE_STAND_ROWS[k].z0)),
                0
            );
            assert.ok(Math.abs(covered + open - (SOURCE_STAND_ROWS[k].z1 - SOURCE_STAND_ROWS[k].z0)) < 1e-9);
        }
        const stair = standStair(side, center, wall, tierRadiusAt(radii, angle, 0));
        const run = Math.abs(stair.topX - stair.footX);
        assert.ok(Math.abs(Math.atan2(STADIUM.fasciaTop, run) - Math.PI / 6) < 0.01);
        // The ramp is above every seat row it crosses.
        blocks.forEach((block) => {
            const k = rowOf(block);
            const front = side === 'west' ? block.x1 : block.x0;
            const along = Math.abs(front - stair.footX);
            const height = (STADIUM.fasciaTop * along) / run;
            assert.ok(height > SOURCE_STAND_ROWS[k].top, `stair under row ${k}`);
        });
        // It lands just inside the wall and its foot stays well off the court (x −13.9…−2.9).
        assert.ok(Math.abs(stair.topX - (center[0] + dir * wall)) < 0.5);
        assert.ok(side === 'west' ? stair.footX < -16 : stair.footX > 0);
        assert.ok(Math.abs(stair.z - center[1]) < 1e-9);
    }
});

test('barriers under the bowl stop below the parapet; elsewhere they stay', () => {
    const inside = (x, z) => underBowl(radii, center, x, z);
    const west = center[0] - (intersectRadius(outline, center, Math.PI) + 2);
    const walls = [
        {
            edge: [
                [west, center[1] - 0.5],
                [west, center[1] + 0.5]
            ],
            bottom: 3.6,
            top: 7
        },
        {
            edge: [
                [-8.7, 50],
                [-7.7, 50]
            ],
            bottom: 0,
            top: 7
        }
    ];
    const clipped = clipUnderBowl(walls, inside, STADIUM.fasciaTop - 0.05);
    assert.equal(clipped.length, 2);
    assert.equal(clipped[0].top, STADIUM.fasciaTop - 0.05);
    assert.equal(clipped[1].top, 7);
});
