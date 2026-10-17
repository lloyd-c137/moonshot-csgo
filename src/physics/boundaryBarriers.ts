// Pure geometry for GAMEPLAY_AUTHORED invisible barriers. Shared by the runtime and the offline navigation audit.

export type Vec3Tuple = [number, number, number];
export type Triangle = [Vec3Tuple, Vec3Tuple, Vec3Tuple];
export type Edge2 = [[number, number], [number, number]];

/** Triangles whose three vertices all lie within `tolerance` of height `y`. */
export const horizontalTrianglesAt = (triangles: Triangle[], y: number, tolerance = 0.02) =>
    triangles.filter((triangle) => triangle.every((vertex) => Math.abs(vertex[1] - y) <= tolerance));

/** Highest vertex height in a triangle set. */
export const maxHeight = (triangles: Triangle[]) =>
    triangles.reduce((top, triangle) => Math.max(top, ...triangle.map((vertex) => vertex[1])), -Infinity);

/**
 * Outline edges of a horizontal surface in X/Z: edges that belong to exactly one triangle. Vertices are welded on a
 * millimetre grid so that split vertices (normals, UV seams) do not create false outlines.
 */
export const boundaryEdges = (triangles: Triangle[], precision = 1e-3): Edge2[] => {
    const key = (vertex: Vec3Tuple) => `${Math.round(vertex[0] / precision)},${Math.round(vertex[2] / precision)}`;
    const edges = new Map<string, { count: number; edge: Edge2 }>();
    for (const triangle of triangles) {
        for (let index = 0; index < 3; index++) {
            const a = triangle[index];
            const b = triangle[(index + 1) % 3];
            const ka = key(a);
            const kb = key(b);
            if (ka === kb) continue;
            const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
            const entry = edges.get(id);
            if (entry) entry.count++;
            else
                edges.set(id, {
                    count: 1,
                    edge: [
                        [a[0], a[2]],
                        [b[0], b[2]]
                    ]
                });
        }
    }
    return [...edges.values()].filter((entry) => entry.count === 1).map((entry) => entry.edge);
};

export type BarrierWall = { edge: Edge2; bottom: number; top: number };

export type BarrierSources = {
    floor: Triangle[];
    wallTops: Triangle[];
    glazing: Triangle[];
};

/**
 * Barrier walls for the campus:
 * - the floor slab outline, from the floor top to `top`, so open entrances and slab holes cannot be walked off;
 * - the outlines of the wall tops and glazing tops, from their source height to `top`, so elevated stand seats
 *   cannot be used to step over walls or glass.
 */
export const campusBarrierWalls = ({ floor, wallTops, glazing }: BarrierSources, top: number): BarrierWall[] => {
    const walls: BarrierWall[] = [];
    for (const edge of boundaryEdges(horizontalTrianglesAt(floor, 0))) walls.push({ edge, bottom: 0, top });
    const wallTopY = maxHeight(wallTops);
    for (const edge of boundaryEdges(horizontalTrianglesAt(wallTops, wallTopY))) {
        walls.push({ edge, bottom: wallTopY, top });
    }
    const glazingTopY = maxHeight(glazing);
    for (const edge of boundaryEdges(horizontalTrianglesAt(glazing, glazingTopY))) {
        walls.push({ edge, bottom: glazingTopY, top });
    }
    return walls;
};

/** Two triangles per barrier wall, as flat position/index arrays for a static collision mesh. */
export const barrierMeshData = (walls: BarrierWall[]) => {
    const positions = new Float32Array(walls.length * 12);
    const indices = new Uint32Array(walls.length * 6);
    walls.forEach(({ edge: [[ax, az], [bx, bz]], bottom, top }, index) => {
        positions.set([ax, bottom, az, bx, bottom, bz, bx, top, bz, ax, top, az], index * 12);
        const base = index * 4;
        indices.set([base, base + 1, base + 2, base, base + 2, base + 3], index * 6);
    });
    return { positions, indices };
};

/**
 * Cuts the walls out of an opening: every wall segment (or part of one) inside the rectangle x0…x1, z0…z1 is
 * removed, longer segments are split around it. Used for the south gate, the one way in from the waiting plaza.
 */
export const cutBarrierOpening = (
    walls: readonly BarrierWall[],
    opening: { x0: number; x1: number; z0: number; z1: number }
): BarrierWall[] =>
    walls.flatMap((wall) => {
        const [[ax, az], [bx, bz]] = wall.edge;
        const inside = (t: number) => {
            const x = ax + (bx - ax) * t,
                z = az + (bz - az) * t;
            return x > opening.x0 && x < opening.x1 && z > opening.z0 && z < opening.z1;
        };
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.05));
        const pieces: BarrierWall[] = [];
        let start: number | null = null;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            if (!inside(t)) {
                if (start === null) start = t;
                continue;
            }
            if (start !== null && t > start) pieces.push(piece(wall, start, (i - 1) / steps));
            start = null;
        }
        if (start !== null && start < 1) pieces.push(piece(wall, start, 1));
        return pieces.filter((p) => Math.hypot(p.edge[1][0] - p.edge[0][0], p.edge[1][1] - p.edge[0][1]) > 1e-3);
    });

const piece = (wall: BarrierWall, t0: number, t1: number): BarrierWall => {
    const [[ax, az], [bx, bz]] = wall.edge;
    return {
        ...wall,
        edge: [
            [ax + (bx - ax) * t0, az + (bz - az) * t0],
            [ax + (bx - ax) * t1, az + (bz - az) * t1]
        ]
    };
};
