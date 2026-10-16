import assert from 'node:assert/strict';
import test from 'node:test';

import { box, cylinder, place, sphere, torus } from '../src/render/shapes.ts';
import { M104_BOUNDS, M104_DOORS, m104Scene } from '../src/world/rooms/m104.ts';
import { auditFloor, loadCampusGeometry } from '../tools/navAudit.ts';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Every non-degenerate triangle winds counter-clockwise around its vertex normals (back-face culling safe). */
const assertOutward = (name, shape) => {
    const p = (i) => shape.positions.slice(i * 3, i * 3 + 3);
    const n = (i) => shape.normals.slice(i * 3, i * 3 + 3);
    for (let t = 0; t < shape.indices.length; t += 3) {
        const [a, b, c] = shape.indices.slice(t, t + 3);
        const face = cross(sub(p(b), p(a)), sub(p(c), p(a)));
        if (Math.hypot(...face) < 1e-9) continue;
        const normal = [0, 1, 2].map((k) => n(a)[k] + n(b)[k] + n(c)[k]);
        assert.ok(dot(face, normal) > 0, `${name}: triangle ${t / 3} winds inward`);
    }
};

test('procedural shapes wind outward, also after rotation and non-uniform scale', () => {
    const shapes = {
        box: box(1, 2, 3),
        cylinder: cylinder(0.5, 1, 12),
        cone: cylinder(0.5, 1, 12, true, 0.2),
        sphere: sphere(),
        torus: torus(1, 0.2)
    };
    for (const [name, shape] of Object.entries(shapes)) {
        assertOutward(name, shape);
        assertOutward(
            `${name} placed`,
            place(shape, { x: 3, y: 1, z: -2, yaw: 0.7, pitch: 0.3, roll: -1.1, sx: 0.4, sy: 1.7, sz: 0.9 })
        );
    }
});

test('the M104 scene is deterministic, untextured and stays inside the room', () => {
    const scene = m104Scene();
    assert.deepEqual(m104Scene(), scene, 'two builds are identical');
    assert.equal(scene.room, 'M104');
    assert.ok(scene.parts.length > 500, `detailed scene (${scene.parts.length} parts)`);
    for (const [key, spec] of Object.entries(scene.materials)) {
        assert.deepEqual(
            Object.keys(spec).filter(
                (field) => !['colour', 'gloss', 'metalness', 'emissive', 'emissiveIntensity', 'opacity'].includes(field)
            ),
            [],
            `${key} uses flat material fields only (no maps)`
        );
    }
    const { west, east, north, south } = M104_BOUNDS;
    for (const part of scene.parts) {
        assert.ok(scene.materials[part.material], part.material);
        // Foliage may brush the walls.
        const slack = part.material.startsWith('leaf') ? 0.3 : 0.01;
        for (let i = 0; i < part.shape.positions.length; i += 3) {
            const [x, y, z] = part.shape.positions.slice(i, i + 3);
            assert.ok([x, y, z].every(Number.isFinite), 'finite vertex');
            // Door lintels sit in the north wall's thickness (0.42 m).
            assert.ok(x >= west - slack && x <= east + slack, `${part.material} x ${x}`);
            assert.ok(z >= north - 0.43 && z <= south + slack, `${part.material} z ${z}`);
            assert.ok(y >= -0.001 && y <= 3.61, `${part.material} y ${y}`);
        }
    }
    for (const [x, z] of scene.lights) assert.ok(x > west && x < east && z > north && z < south);
});

test('M104 colliders leave both north doors and a route into each half of the room', () => {
    const scene = m104Scene();
    for (const door of M104_DOORS) {
        for (const collider of scene.colliders) {
            // Footprints never reach into the 0.6 m strip just inside either opening.
            const inside =
                Math.abs(collider.x - (door.from + door.to) / 2) < collider.w / 2 + (door.to - door.from) / 2 - 0.1;
            const near = collider.z - Math.max(collider.w, collider.d) / 2 < M104_BOUNDS.north + 0.6;
            assert.ok(
                !(inside && near && Math.abs(Math.sin(collider.yaw)) < 0.1),
                `collider at ${collider.x}, ${collider.z}`
            );
        }
    }
    const audit = auditFloor(loadCampusGeometry());
    const reached = ([x, z]) => audit.reached[audit.grid.index(x, z)] === 1;
    // West lounge and east workspace, entered through their own doors.
    for (const point of [
        [-47.3, 42.4],
        [-49.6, 42.7],
        [-50.2, 43.9],
        [-45.3, 42.5],
        [-43.2, 45.3],
        [-44.5, 44.9]
    ]) {
        assert.ok(reached(point), `reachable ${point}`);
    }
    const room = audit.rooms.find((entry) => entry.id === 'M104');
    assert.ok(room.reachable > 0.3, `M104 reachable fraction ${room.reachable}`);
});
