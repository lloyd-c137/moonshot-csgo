// Pure 2D (X/Z) geometry helpers shared by the runtime and the offline derivation tools.

export type Vec2 = [number, number];

export const signedArea = (ring: Vec2[]) => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return area / 2;
};

const pointSegmentDistance = ([px, pz]: Vec2, [ax, az]: Vec2, [bx, bz]: Vec2) => {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared)) : 0;
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

/** Douglas–Peucker simplification of a closed ring. */
export const simplifyRing = (ring: Vec2[], tolerance: number): Vec2[] => {
    if (ring.length <= 4) return ring;
    const simplify = (points: Vec2[]): Vec2[] => {
        let index = -1;
        let max = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const distance = pointSegmentDistance(points[i], points[0], points[points.length - 1]);
            if (distance > max) {
                max = distance;
                index = i;
            }
        }
        if (max <= tolerance || index < 0) return [points[0], points[points.length - 1]];
        const left = simplify(points.slice(0, index + 1));
        return [...left.slice(0, -1), ...simplify(points.slice(index))];
    };
    // Split the ring at its two farthest-apart vertices so both halves are open polylines.
    let far = 0;
    for (let i = 1; i < ring.length; i++) {
        if (
            Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) >
            Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])
        )
            far = i;
    }
    const first = simplify(ring.slice(0, far + 1));
    const second = simplify([...ring.slice(far), ring[0]]);
    return [...first.slice(0, -1), ...second.slice(0, -1)];
};

/** Ear-clipping triangulation of a simple polygon; returns index triples into `ring`. */
export const triangulate = (ring: Vec2[]): [number, number, number][] => {
    const ccw = signedArea(ring) > 0;
    const remaining = ring.map((_, index) => index);
    const triangles: [number, number, number][] = [];
    const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => {
        const d1 = cross(a, b, p);
        const d2 = cross(b, c, p);
        const d3 = cross(c, a, p);
        return ccw ? d1 >= 0 && d2 >= 0 && d3 >= 0 : d1 <= 0 && d2 <= 0 && d3 <= 0;
    };
    let guard = remaining.length * remaining.length;
    while (remaining.length > 3 && guard-- > 0) {
        let clipped = false;
        for (let i = 0; i < remaining.length; i++) {
            const ia = remaining[(i + remaining.length - 1) % remaining.length];
            const ib = remaining[i];
            const ic = remaining[(i + 1) % remaining.length];
            const turn = cross(ring[ia], ring[ib], ring[ic]);
            if (ccw ? turn <= 1e-12 : turn >= -1e-12) continue;
            if (
                remaining.some((k) => k !== ia && k !== ib && k !== ic && inside(ring[k], ring[ia], ring[ib], ring[ic]))
            ) {
                continue;
            }
            triangles.push([ia, ib, ic]);
            remaining.splice(i, 1);
            clipped = true;
            break;
        }
        if (!clipped) break;
    }
    if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
    return triangles;
};
