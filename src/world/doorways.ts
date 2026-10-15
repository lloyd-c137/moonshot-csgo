// GAMEPLAY_AUTHORED doorways cut into source walls/glazing for rooms the source walls seal off. Pure geometry shared
// by the runtime (mesh + collider cutting) and the offline tools (navigation audit, derivation).

export type Doorway = {
    /** Room the doorway opens. */
    room: string;
    /** Centre of the opening at the wall centre line, X/Z metres. */
    center: [number, number];
    /** Direction along the wall (radians, atan2(dz, dx)). */
    yaw: number;
    /** Clear opening width along the wall and cut depth through the wall. */
    width: number;
    depth: number;
    /** Opening height from the floor. */
    height: number;
};

type V3 = [number, number, number];

/** Doorway local frame: u along the wall, v through the wall, y up. */
const toLocal = (cut: Doorway, [x, y, z]: V3): V3 => {
    const c = Math.cos(cut.yaw);
    const s = Math.sin(cut.yaw);
    const dx = x - cut.center[0];
    const dz = z - cut.center[1];
    return [dx * c + dz * s, y, -dx * s + dz * c];
};

const toWorld = (cut: Doorway, [u, y, v]: V3): V3 => {
    const c = Math.cos(cut.yaw);
    const s = Math.sin(cut.yaw);
    return [cut.center[0] + u * c - v * s, y, cut.center[1] + u * s + v * c];
};

/** True when the X/Z point lies inside the doorway footprint (used to clear raster cells offline). */
export const doorwayContains = (cut: Doorway, x: number, z: number, margin = 0) => {
    const [u, , v] = toLocal(cut, [x, 0, z]);
    return Math.abs(u) <= cut.width / 2 + margin && Math.abs(v) <= cut.depth / 2 + margin;
};

type Plane = { axis: 0 | 1 | 2; value: number; keepGreater: boolean };

const clipPolygon = (polygon: V3[], { axis, value, keepGreater }: Plane): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const da = keepGreater ? a[axis] - value : value - a[axis];
        const db = keepGreater ? b[axis] - value : value - b[axis];
        if (da >= 0) out.push(a);
        if (da >= 0 !== db >= 0) {
            const t = da / (da - db);
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
    }
    return out;
};

/**
 * Removes the part of a triangle inside the doorway box (|u| ≤ w/2, |v| ≤ d/2, y < height). Returns the remaining
 * pieces as convex polygons in world space; a triangle that does not touch the box is returned unchanged.
 */
export const cutPolygon = (polygon: V3[], cut: Doorway): V3[][] => {
    let inside = polygon.map((point) => toLocal(cut, point));
    const planes: Plane[] = [
        { axis: 0, value: -cut.width / 2, keepGreater: false },
        { axis: 0, value: cut.width / 2, keepGreater: true },
        { axis: 2, value: -cut.depth / 2, keepGreater: false },
        { axis: 2, value: cut.depth / 2, keepGreater: true },
        { axis: 1, value: cut.height, keepGreater: true },
        { axis: 1, value: -1, keepGreater: false }
    ];
    const pieces: V3[][] = [];
    for (const plane of planes) {
        const outside = clipPolygon(inside, plane);
        if (outside.length >= 3) pieces.push(outside);
        inside = clipPolygon(inside, { ...plane, keepGreater: !plane.keepGreater });
        if (inside.length < 3) {
            inside = [];
            break;
        }
    }
    // Nothing inside the box: keep the original polygon untouched (avoids needless splitting).
    if (inside.length < 3 || polygonArea(inside) < 1e-9) {
        if (pieces.length === 1) return [polygon];
    }
    return pieces.map((piece) => piece.map((point) => toWorld(cut, point)));
};

const polygonArea = (polygon: V3[]) => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 1; i + 1 < polygon.length; i++) {
        const a = polygon[0];
        const b = polygon[i];
        const c = polygon[i + 1];
        const ux = b[0] - a[0];
        const uy = b[1] - a[1];
        const uz = b[2] - a[2];
        const vx = c[0] - a[0];
        const vy = c[1] - a[1];
        const vz = c[2] - a[2];
        x += uy * vz - uz * vy;
        y += uz * vx - ux * vz;
        z += ux * vy - uy * vx;
    }
    return Math.hypot(x, y, z) / 2;
};

/** True when the triangle's X/Z bounding box overlaps the doorway's (expanded by `margin`). */
export const doorwayTouches = (cut: Doorway, triangle: V3[], margin = 0.1) => {
    const reach = Math.hypot(cut.width, cut.depth) / 2 + margin;
    const xs = triangle.map(([x]) => x);
    const zs = triangle.map(([, , z]) => z);
    return (
        Math.min(...xs) <= cut.center[0] + reach &&
        Math.max(...xs) >= cut.center[0] - reach &&
        Math.min(...zs) <= cut.center[1] + reach &&
        Math.max(...zs) >= cut.center[1] - reach
    );
};

/** Cuts every doorway out of a triangle soup; returns triangles (fan-triangulated convex pieces). */
export const cutTriangles = (triangles: V3[][], cuts: Doorway[]): V3[][] => {
    let polygons = triangles;
    for (const cut of cuts) {
        const next: V3[][] = [];
        for (const polygon of polygons) {
            // Cheap reject: polygon entirely clear of the doorway footprint.
            const local = polygon.map((point) => toLocal(cut, point));
            const outsideBox =
                local.every(([u]) => u < -cut.width / 2) ||
                local.every(([u]) => u > cut.width / 2) ||
                local.every(([, , v]) => v < -cut.depth / 2) ||
                local.every(([, , v]) => v > cut.depth / 2) ||
                local.every(([, y]) => y > cut.height);
            if (outsideBox) next.push(polygon);
            else next.push(...cutPolygon(polygon, cut));
        }
        polygons = next;
    }
    const out: V3[][] = [];
    for (const polygon of polygons) {
        for (let i = 1; i + 1 < polygon.length; i++) {
            const triangle = [polygon[0], polygon[i], polygon[i + 1]];
            if (polygonArea(triangle) > 1e-8) out.push(triangle);
        }
    }
    return out;
};

/** Reveal faces (two jambs and the head) lining a doorway, as quads with outward-facing normals. */
export const doorwayReveals = (cut: Doorway) => {
    const w = cut.width / 2;
    const d = cut.depth / 2;
    const h = cut.height;
    const quad = (points: V3[], normal: V3) => ({
        corners: points.map((point) => toWorld(cut, point)) as [V3, V3, V3, V3],
        normal: (() => {
            const [nx, , nz] = toWorld({ ...cut, center: [0, 0] }, normal);
            return [nx, normal[1], nz] as V3;
        })()
    });
    return [
        // Jamb at u = -w faces +u (into the opening).
        quad(
            [
                [-w, 0, -d],
                [-w, 0, d],
                [-w, h, d],
                [-w, h, -d]
            ],
            [1, 0, 0]
        ),
        quad(
            [
                [w, 0, d],
                [w, 0, -d],
                [w, h, -d],
                [w, h, d]
            ],
            [-1, 0, 0]
        ),
        // Head faces down.
        quad(
            [
                [-w, h, -d],
                [-w, h, d],
                [w, h, d],
                [w, h, -d]
            ],
            [0, -1, 0]
        )
    ];
};
