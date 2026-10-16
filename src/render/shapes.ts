// Pure procedural shape generators (no textures, no engine imports). Shapes are indexed triangle lists with
// per-vertex normals; `place` scales, rotates (roll about X, pitch about Z, then yaw about Y) and translates them.

export type Shape = { positions: number[]; normals: number[]; indices: number[] };

export type Placement = {
    x?: number;
    y?: number;
    z?: number;
    /** Rotation about Y (radians): local +X turns toward +Z. */
    yaw?: number;
    /** Rotation about local Z (radians), applied before yaw. */
    pitch?: number;
    /** Rotation about local X (radians), applied first. */
    roll?: number;
    sx?: number;
    sy?: number;
    sz?: number;
};

const empty = (): Shape => ({ positions: [], normals: [], indices: [] });

/** Axis-aligned box centred on the origin. */
export const box = (w: number, h: number, d: number): Shape => {
    const s = empty();
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const faces: [number[], number[][]][] = [
        [
            [1, 0, 0],
            [
                [hw, -hh, hd],
                [hw, -hh, -hd],
                [hw, hh, -hd],
                [hw, hh, hd]
            ]
        ],
        [
            [-1, 0, 0],
            [
                [-hw, -hh, -hd],
                [-hw, -hh, hd],
                [-hw, hh, hd],
                [-hw, hh, -hd]
            ]
        ],
        [
            [0, 1, 0],
            [
                [-hw, hh, hd],
                [hw, hh, hd],
                [hw, hh, -hd],
                [-hw, hh, -hd]
            ]
        ],
        [
            [0, -1, 0],
            [
                [-hw, -hh, -hd],
                [hw, -hh, -hd],
                [hw, -hh, hd],
                [-hw, -hh, hd]
            ]
        ],
        [
            [0, 0, 1],
            [
                [-hw, -hh, hd],
                [hw, -hh, hd],
                [hw, hh, hd],
                [-hw, hh, hd]
            ]
        ],
        [
            [0, 0, -1],
            [
                [hw, -hh, -hd],
                [-hw, -hh, -hd],
                [-hw, hh, -hd],
                [hw, hh, -hd]
            ]
        ]
    ];
    for (const [normal, corners] of faces) {
        const base = s.positions.length / 3;
        for (const corner of corners) {
            s.positions.push(...corner);
            s.normals.push(...normal);
        }
        s.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return s;
};

/** Cylinder along Y, centred on the origin. */
export const cylinder = (radius: number, height: number, segments = 18, caps = true, radiusTop = radius): Shape => {
    const s = empty();
    const hh = height / 2;
    const slope = (radius - radiusTop) / height;
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const c = Math.cos(a);
        const n = Math.sin(a);
        const length = Math.hypot(1, slope);
        s.positions.push(c * radius, -hh, n * radius, c * radiusTop, hh, n * radiusTop);
        s.normals.push(c / length, slope / length, n / length, c / length, slope / length, n / length);
    }
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        s.indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (caps) {
        for (const [y, r, up] of [
            [hh, radiusTop, 1],
            [-hh, radius, -1]
        ]) {
            const centre = s.positions.length / 3;
            s.positions.push(0, y, 0);
            s.normals.push(0, up, 0);
            for (let i = 0; i <= segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                s.positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
                s.normals.push(0, up, 0);
            }
            for (let i = 0; i < segments; i++) {
                if (up > 0) s.indices.push(centre, centre + i + 2, centre + i + 1);
                else s.indices.push(centre, centre + i + 1, centre + i + 2);
            }
        }
    }
    return s;
};

/** Unit-radius UV sphere; scale it with `place` for ellipsoids and cushions. */
export const sphere = (segments = 16, rings = 10): Shape => {
    const s = empty();
    for (let j = 0; j <= rings; j++) {
        const v = (j / rings) * Math.PI;
        for (let i = 0; i <= segments; i++) {
            const u = (i / segments) * Math.PI * 2;
            const x = Math.sin(v) * Math.cos(u);
            const y = Math.cos(v);
            const z = Math.sin(v) * Math.sin(u);
            s.positions.push(x, y, z);
            s.normals.push(x, y, z);
        }
    }
    for (let j = 0; j < rings; j++) {
        for (let i = 0; i < segments; i++) {
            const a = j * (segments + 1) + i;
            const b = a + segments + 1;
            s.indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    return s;
};

/** Torus in the XZ plane (ring radius R, tube radius r). */
export const torus = (R: number, r: number, segments = 24, tube = 8): Shape => {
    const s = empty();
    for (let i = 0; i <= segments; i++) {
        const u = (i / segments) * Math.PI * 2;
        for (let j = 0; j <= tube; j++) {
            const v = (j / tube) * Math.PI * 2;
            const nx = Math.cos(v) * Math.cos(u);
            const ny = Math.sin(v);
            const nz = Math.cos(v) * Math.sin(u);
            s.positions.push((R + r * Math.cos(v)) * Math.cos(u), r * ny, (R + r * Math.cos(v)) * Math.sin(u));
            s.normals.push(nx, ny, nz);
        }
    }
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < tube; j++) {
            const a = i * (tube + 1) + j;
            const b = a + tube + 1;
            s.indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    return s;
};

/** Applies scale, roll (X), pitch (Z), yaw (Y) and translation. Normals use the inverse scale. */
export const place = (shape: Shape, p: Placement): Shape => {
    const { x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = 1, sz = 1 } = p;
    const rotate = (vx: number, vy: number, vz: number): [number, number, number] => {
        // roll about X
        let ay = vy * Math.cos(roll) - vz * Math.sin(roll);
        const az = vy * Math.sin(roll) + vz * Math.cos(roll);
        let ax = vx;
        // pitch about Z
        const bx = ax * Math.cos(pitch) - ay * Math.sin(pitch);
        const by = ax * Math.sin(pitch) + ay * Math.cos(pitch);
        ax = bx;
        ay = by;
        // yaw about Y: +X toward +Z
        const cx = ax * Math.cos(yaw) - az * Math.sin(yaw);
        const cz = ax * Math.sin(yaw) + az * Math.cos(yaw);
        return [cx, ay, cz];
    };
    const out: Shape = { positions: [], normals: [], indices: [...shape.indices] };
    for (let i = 0; i < shape.positions.length; i += 3) {
        const [px, py, pz] = rotate(shape.positions[i] * sx, shape.positions[i + 1] * sy, shape.positions[i + 2] * sz);
        out.positions.push(px + x, py + y, pz + z);
        const [nx, ny, nz] = rotate(shape.normals[i] / sx, shape.normals[i + 1] / sy, shape.normals[i + 2] / sz);
        const length = Math.hypot(nx, ny, nz) || 1;
        out.normals.push(nx / length, ny / length, nz / length);
    }
    return out;
};

/** Concatenates shapes into one. */
export const merge = (shapes: Shape[]): Shape => {
    const out = empty();
    for (const shape of shapes) {
        const base = out.positions.length / 3;
        out.positions.push(...shape.positions);
        out.normals.push(...shape.normals);
        for (const index of shape.indices) out.indices.push(index + base);
    }
    return out;
};
