import type { GraphicsDevice } from 'playcanvas';
import { Mesh } from 'playcanvas';

type V3 = [number, number, number];

/**
 * Accumulates indexed triangle geometry (positions, normals, two UV sets) and uploads it as one PlayCanvas mesh,
 * so authored dressing renders in a handful of draw calls.
 */
export class MeshBuilder {
    positions: number[] = [];
    normals: number[] = [];
    uv0: number[] = [];
    uv1: number[] = [];
    indices: number[] = [];

    get empty() {
        return this.indices.length === 0;
    }

    vertex(position: V3, normal: V3, uv: [number, number], uv1: [number, number] = [0, 0]) {
        this.positions.push(...position);
        this.normals.push(...normal);
        this.uv0.push(...uv);
        this.uv1.push(...uv1);
        return this.positions.length / 3 - 1;
    }

    triangle(a: number, b: number, c: number) {
        this.indices.push(a, b, c);
    }

    /** Quad from four corners in counter-clockwise order as seen from the side the normal points to. */
    quad(
        corners: [V3, V3, V3, V3],
        normal: V3,
        uvs: [[number, number], [number, number], [number, number], [number, number]]
    ) {
        const [a, b, c, d] = corners.map((corner, index) => this.vertex(corner, normal, uvs[index]));
        this.triangle(a, b, c);
        this.triangle(a, c, d);
    }

    /**
     * Box with its base centred at (x, y, z), `width` along the yaw direction, `depth` across it, `height` up.
     * UVs are metric so tiling textures keep a consistent scale.
     */
    box(x: number, y: number, z: number, width: number, depth: number, height: number, yaw: number, faces = 6) {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const corner = (u: number, v: number, h: number): V3 => [x + u * c - v * s, y + h, z + u * s + v * c];
        const hw = width / 2;
        const hd = depth / 2;
        const p = [
            corner(-hw, -hd, 0),
            corner(hw, -hd, 0),
            corner(hw, hd, 0),
            corner(-hw, hd, 0),
            corner(-hw, -hd, height),
            corner(hw, -hd, height),
            corner(hw, hd, height),
            corner(-hw, hd, height)
        ];
        const along: V3 = [c, 0, s];
        const across: V3 = [-s, 0, c];
        const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
        // top
        this.quad(
            [p[4], p[7], p[6], p[5]],
            [0, 1, 0],
            [
                [0, 0],
                [0, depth],
                [width, depth],
                [width, 0]
            ]
        );
        // sides
        this.quad([p[0], p[1], p[5], p[4]], neg(across), [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height]
        ]);
        this.quad([p[2], p[3], p[7], p[6]], across, [
            [0, 0],
            [width, 0],
            [width, height],
            [0, height]
        ]);
        this.quad([p[1], p[2], p[6], p[5]], along, [
            [0, 0],
            [depth, 0],
            [depth, height],
            [0, height]
        ]);
        this.quad([p[3], p[0], p[4], p[7]], neg(along), [
            [0, 0],
            [depth, 0],
            [depth, height],
            [0, height]
        ]);
        if (faces > 5) {
            this.quad(
                [p[0], p[3], p[2], p[1]],
                [0, -1, 0],
                [
                    [0, 0],
                    [0, depth],
                    [width, depth],
                    [width, 0]
                ]
            );
        }
    }

    build(device: GraphicsDevice) {
        const mesh = new Mesh(device);
        mesh.setPositions(this.positions);
        mesh.setNormals(this.normals);
        mesh.setUvs(0, this.uv0);
        mesh.setUvs(1, this.uv1);
        mesh.setIndices(this.indices);
        mesh.update();
        return mesh;
    }
}
