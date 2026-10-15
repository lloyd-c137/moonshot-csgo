import assert from 'node:assert/strict';
import test from 'node:test';

import {
    barrierMeshData,
    boundaryEdges,
    campusBarrierWalls,
    horizontalTrianglesAt
} from '../src/physics/boundaryBarriers.ts';

// Unit square at height y split into two triangles, plus a duplicate vertex to check welding.
const square = (y, offset = 0) => [
    [
        [offset, y, 0],
        [offset + 1, y, 0],
        [offset + 1, y, 1]
    ],
    [
        [offset, y, 0],
        [offset + 1.0000001, y, 1],
        [offset, y, 1]
    ]
];

test('boundary edges exclude the shared diagonal and weld split vertices', () => {
    const edges = boundaryEdges(square(0));
    assert.equal(edges.length, 4);
    const lengths = edges.map(([[ax, az], [bx, bz]]) => Math.hypot(bx - ax, bz - az)).sort();
    lengths.forEach((length) => assert.ok(Math.abs(length - 1) < 1e-3));
});

test('horizontal filter ignores vertical faces and other levels', () => {
    const vertical = [
        [
            [0, 0, 0],
            [1, 0, 0],
            [1, 2, 0]
        ]
    ];
    assert.equal(horizontalTrianglesAt([...square(0), ...square(2), ...vertical], 0).length, 2);
});

test('campus barrier walls extrude floor outline from the floor and tops from their height', () => {
    const walls = campusBarrierWalls({ floor: square(0), wallTops: square(2.8, 5), glazing: square(2.58, 9) }, 6);
    assert.equal(walls.length, 12);
    assert.deepEqual([...new Set(walls.map((wall) => wall.bottom.toFixed(2)))].sort(), ['0.00', '2.58', '2.80']);
    assert.ok(walls.every((wall) => wall.top === 6));
    const { positions, indices } = barrierMeshData(walls);
    assert.equal(positions.length, 12 * 12);
    assert.equal(indices.length, 12 * 6);
    assert.ok(Math.max(...indices) < positions.length / 3);
});
