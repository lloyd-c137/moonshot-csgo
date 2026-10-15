import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const matrixFor = (node) => {
    if (node.matrix) return node.matrix;
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale ?? [1, 1, 1];
    const [tx, ty, tz] = node.translation ?? [0, 0, 0];
    return [
        (1 - 2 * y * y - 2 * z * z) * sx,
        (2 * x * y + 2 * z * w) * sx,
        (2 * x * z - 2 * y * w) * sx,
        0,
        (2 * x * y - 2 * z * w) * sy,
        (1 - 2 * x * x - 2 * z * z) * sy,
        (2 * y * z + 2 * x * w) * sy,
        0,
        (2 * x * z + 2 * y * w) * sz,
        (2 * y * z - 2 * x * w) * sz,
        (1 - 2 * x * x - 2 * y * y) * sz,
        0,
        tx,
        ty,
        tz,
        1
    ];
};

const multiply = (a, b) => {
    const out = Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
        }
    }
    return out;
};

const modelBounds = (model) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const visit = (index, parent) => {
        const node = model.nodes[index];
        const world = multiply(parent, matrixFor(node));
        if (node.mesh !== undefined) {
            for (const primitive of model.meshes[node.mesh].primitives) {
                const accessor = model.accessors[primitive.attributes.POSITION];
                for (const x of accessor.min.slice(0, 1).concat(accessor.max.slice(0, 1))) {
                    for (const y of [accessor.min[1], accessor.max[1]]) {
                        for (const z of [accessor.min[2], accessor.max[2]]) {
                            const point = [
                                world[0] * x + world[4] * y + world[8] * z + world[12],
                                world[1] * x + world[5] * y + world[9] * z + world[13],
                                world[2] * x + world[6] * y + world[10] * z + world[14]
                            ];
                            for (let axis = 0; axis < 3; axis++) {
                                min[axis] = Math.min(min[axis], point[axis]);
                                max[axis] = Math.max(max[axis], point[axis]);
                            }
                        }
                    }
                }
            }
        }
        for (const child of node.children ?? []) visit(child, world);
    };
    for (const root of model.scenes[model.scene].nodes) visit(root, identity);
    return { min: min.map((value) => Number(value.toFixed(2))), max: max.map((value) => Number(value.toFixed(2))) };
};

test('curated FF-01 runtime assets match the reviewed manifest', () => {
    const manifest = JSON.parse(read('../public/assets/campus/manifest.json'));
    const glb = read('../public/assets/campus/MAC_Campus_FF01.glb');
    const roomsBuffer = read('../public/assets/campus/rooms.json');
    const rooms = JSON.parse(roomsBuffer);

    assert.equal(sha256(glb), manifest.glbSha256);
    assert.equal(sha256(roomsBuffer), manifest.curatedRoomsSha256);
    assert.equal(glb.toString('ascii', 0, 4), 'glTF');
    assert.equal(glb.readUInt32LE(4), 2);
    assert.equal(glb.readUInt32LE(8), glb.length);

    const jsonLength = glb.readUInt32LE(12);
    const model = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength));
    const extras = model.scenes[model.scene].extras;
    assert.equal(extras.modelID, manifest.model);
    assert.equal(extras.status, manifest.integrity);
    assert.equal(extras.units, manifest.units);
    assert.equal(extras.axes, 'x = east, y = up, z = south (north = -z)');
    assert.deepEqual(rooms.frame.axes, manifest.axes);
    assert.deepEqual(modelBounds(model), manifest.worldBoundsMetres);
    const nodeNames = new Set(model.nodes.map((node) => node.name));
    for (const name of [
        'MAC_Campus_FF01',
        'Structure',
        'Floor_Slab',
        'Walls',
        'Walls_Top',
        'Glazing',
        'Rooms',
        'Arena',
        'Arena_Court',
        'Arena_StandBase'
    ]) {
        assert.ok(nodeNames.has(name), `missing source node ${name}`);
    }

    assert.equal(rooms.model, manifest.model);
    assert.equal(rooms.status, manifest.integrity);
    assert.equal(rooms.rooms.length, manifest.roomRecords);
    assert.equal(rooms.rooms.filter((room) => room.hasRegion).length, manifest.roomRegions);
    assert.equal(rooms.rooms.filter((room) => !room.hasRegion).length, manifest.labelOnly);
    assert.equal(new Set(rooms.rooms.map((room) => room.id)).size, rooms.rooms.length);
    for (const room of rooms.rooms) {
        assert.equal('access' in room, false);
        assert.equal('capacity' in room, false);
        assert.equal('sensorLocation' in room, false);
        assert.equal('description' in room, false);
        if (room.hasRegion) {
            assert.ok(Array.isArray(room.polygon?.outer));
            assert.ok(room.polygon.outer.length >= 3);
            for (const ring of [room.polygon.outer, ...(room.polygon.holes ?? [])]) {
                assert.ok(ring.every((point) => point.length === 2 && point.every(Number.isFinite)));
            }
        } else {
            assert.equal('polygon' in room, false);
        }
    }
});
