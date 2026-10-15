// Offline, dependency-free GLB reader for validation tools and tests. Not used by the browser runtime.
import { readFileSync } from 'node:fs';

import type { Triangle, Vec3Tuple } from '../src/physics/boundaryBarriers.ts';

type GltfNode = {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    extras?: Record<string, unknown>;
};
type Accessor = { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string };
type Gltf = {
    scene?: number;
    scenes: { nodes: number[] }[];
    nodes: GltfNode[];
    meshes: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
    accessors: Accessor[];
    bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
};

const matrixFor = (node: GltfNode) => {
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

const multiply = (a: number[], b: number[]) => {
    const out = Array<number>(16).fill(0);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
        }
    }
    return out;
};

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export class GlbScene {
    readonly gltf: Gltf;
    private readonly bin: Buffer;
    private readonly worlds = new Map<string, { node: GltfNode; world: number[] }>();

    constructor(path: string | URL) {
        const file = readFileSync(path);
        if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file');
        const jsonLength = file.readUInt32LE(12);
        this.gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
        const binHeader = 20 + jsonLength;
        this.bin = file.subarray(binHeader + 8, binHeader + 8 + file.readUInt32LE(binHeader));
        const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const visit = (index: number, parent: number[]) => {
            const node = this.gltf.nodes[index];
            const world = multiply(parent, matrixFor(node));
            if (node.name) this.worlds.set(node.name, { node, world });
            for (const child of node.children ?? []) visit(child, world);
        };
        for (const root of this.gltf.scenes[this.gltf.scene ?? 0].nodes) visit(root, identity);
    }

    private read(accessorIndex: number) {
        const accessor = this.gltf.accessors[accessorIndex];
        const view = this.gltf.bufferViews[accessor.bufferView];
        const width = COMPONENTS[accessor.type];
        const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
        if (!size || !width) throw new Error(`Unsupported accessor ${accessorIndex}`);
        const stride = view.byteStride ?? size * width;
        const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const values: number[][] = [];
        for (let item = 0; item < accessor.count; item++) {
            const value: number[] = [];
            for (let component = 0; component < width; component++) {
                const offset = start + item * stride + component * size;
                value.push(
                    accessor.componentType === 5126
                        ? this.bin.readFloatLE(offset)
                        : accessor.componentType === 5125
                          ? this.bin.readUInt32LE(offset)
                          : accessor.componentType === 5123
                            ? this.bin.readUInt16LE(offset)
                            : this.bin.readUInt8(offset)
                );
            }
            values.push(value);
        }
        return values;
    }

    /** Node by name, with its world matrix (column-major). */
    node(name: string) {
        const entry = this.worlds.get(name);
        if (!entry) throw new Error(`GLB node not found: ${name}`);
        return entry;
    }

    /** World-space position of a named node. */
    position(name: string): Vec3Tuple {
        const { world } = this.node(name);
        return [world[12], world[13], world[14]];
    }

    /** World-space triangles of a named node's mesh (triangle-list primitives only). */
    triangles(name: string): Triangle[] {
        const { node, world } = this.node(name);
        if (node.mesh === undefined) throw new Error(`GLB node has no mesh: ${name}`);
        const triangles: Triangle[] = [];
        for (const primitive of this.gltf.meshes[node.mesh].primitives) {
            if ((primitive.mode ?? 4) !== 4) continue;
            const positions = this.read(primitive.attributes.POSITION).map(([x, y, z]): Vec3Tuple => [
                world[0] * x + world[4] * y + world[8] * z + world[12],
                world[1] * x + world[5] * y + world[9] * z + world[13],
                world[2] * x + world[6] * y + world[10] * z + world[14]
            ]);
            const indices =
                primitive.indices === undefined
                    ? positions.map((_, index) => index)
                    : this.read(primitive.indices).map(([index]) => index);
            for (let index = 0; index + 2 < indices.length; index += 3) {
                triangles.push([
                    positions[indices[index]],
                    positions[indices[index + 1]],
                    positions[indices[index + 2]]
                ]);
            }
        }
        return triangles;
    }
}
