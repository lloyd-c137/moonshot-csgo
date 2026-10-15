import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ARENA_WALL_HEIGHT, CEILING_HEIGHT, WALL_HEIGHT, WALL_SCALE_Y } from '../src/config/presentation.ts';
import { signedArea, simplifyRing, triangulate } from '../src/world/geometry2d.ts';
import { chainSegments, deriveWorld, findDoorArcs } from '../tools/deriveWorld.ts';
import { decodePng } from '../tools/png.ts';

const read = (name) => readFileSync(new URL(`../public/assets/campus/derived/${name}`, import.meta.url));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

test('presentation adapter raises the 2.8 m source walls to 3.6 m with a flush ceiling', () => {
    assert.ok(Math.abs(2.8 * WALL_SCALE_Y - WALL_HEIGHT) < 1e-9);
    assert.equal(WALL_HEIGHT, 3.6);
    assert.equal(CEILING_HEIGHT, WALL_HEIGHT);
    assert.ok(ARENA_WALL_HEIGHT > WALL_HEIGHT + 3, 'the arena perimeter wall stands well above the building');
});

test('committed derived assets match their manifest and the current source files', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.status, 'GAMEPLAY_AUTHORED');
    for (const [name, { sha256: expected }] of Object.entries(manifest.outputs))
        assert.equal(sha256(read(name)), expected, name);
    const sourceManifest = JSON.parse(readFileSync(new URL('../public/assets/campus/manifest.json', import.meta.url)));
    assert.equal(manifest.sources.glbSha256, sourceManifest.glbSha256);
    assert.equal(manifest.sources.roomsSha256, sourceManifest.curatedRoomsSha256);
});

test('re-deriving from the source reproduces the committed world data and masks exactly', () => {
    const { world, ceilingMask, minimap } = deriveWorld();
    assert.deepEqual(JSON.parse(read('world.json')), JSON.parse(JSON.stringify(world)));
    for (const [name, image] of [
        ['ceiling-mask.png', ceilingMask],
        ['minimap.png', minimap]
    ]) {
        const committed = decodePng(read(name));
        assert.equal(committed.width, image.width, name);
        assert.equal(committed.height, image.height, name);
        assert.ok(
            Buffer.from(committed.data).equals(Buffer.from(image.data)),
            `${name} pixels differ; run npm run derive:world`
        );
    }
    // Sanity of the derived content.
    assert.ok(world.doors.length >= 100);
    assert.ok(world.lights.length >= 500);
    assert.ok(world.arena.outline.length >= 12);
    assert.ok(signedArea(world.arena.outline) > 1200, 'arena region covers the court and stands');
    assert.ok(!('ceilingHeight' in world.arena), 'the arena is open-air');
    for (const door of world.doors) {
        const width = Math.hypot(door.closed[0] - door.hinge[0], door.closed[1] - door.hinge[1]);
        assert.ok(width > 0.45 && width < 1.45, `door width ${width}`);
    }
    const mask = ceilingMask.data;
    const at = (x, z) => mask[Math.floor((z + 62) / 0.1) * ceilingMask.width + Math.floor((x + 69) / 0.1)];
    assert.equal(at(world.arena.center[0], world.arena.center[1]), 0, 'no ceiling over the arena');
    assert.equal(at(46.6, -27.1), 0, 'no ceiling over COURTYARD-01');
    assert.equal(at(50.85, -2.86), 255, 'ceiling over the east entrance lobby');
});

test('ear clipping triangulates a concave polygon and ring simplification keeps corners', () => {
    const l = [
        [0, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 2],
        [0, 2]
    ];
    const triangles = triangulate(l);
    assert.equal(triangles.length, 4);
    const area = triangles.reduce((sum, [a, b, c]) => sum + Math.abs(signedArea([l[a], l[b], l[c]])), 0);
    assert.ok(Math.abs(area - 3) < 1e-9);
    const noisy = [];
    for (let i = 0; i <= 20; i++) noisy.push([i / 10, (i % 2) * 0.01]);
    for (let i = 0; i <= 20; i++) noisy.push([2 - (i % 2) * 0.01, i / 10]);
    noisy.push([0, 2]);
    assert.ok(simplifyRing(noisy, 0.05).length <= 4);
});

test('door swings are recognised from quarter arcs in segment soup', () => {
    const arc = [];
    for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * (Math.PI / 2);
        const a1 = ((i + 1) / 8) * (Math.PI / 2);
        arc.push([
            [10 + 0.9 * Math.cos(a0), 5 + 0.9 * Math.sin(a0)],
            [10 + 0.9 * Math.cos(a1), 5 + 0.9 * Math.sin(a1)]
        ]);
    }
    // A leaf line joined to the arc end, and an unrelated stray segment.
    arc.push([
        [10, 5.9],
        [10, 5]
    ]);
    arc.push([
        [0, 0],
        [0.3, 0]
    ]);
    assert.equal(chainSegments(arc).length, 2);
    const arcs = findDoorArcs(arc);
    assert.equal(arcs.length, 1);
    assert.ok(Math.abs(arcs[0].radius - 0.9) < 0.01);
    assert.ok(Math.hypot(arcs[0].hinge[0] - 10, arcs[0].hinge[1] - 5) < 0.01);
});
