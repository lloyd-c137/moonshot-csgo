// Shared, pure 2D occlusion masks (X/Z grid bit sets generated offline from the campus colliders). No engine imports,
// so the browser, the Worker and node tests can all use them.

export type OcclusionMask = {
    readonly x0: number;
    readonly z0: number;
    readonly width: number;
    readonly height: number;
    readonly resolution: number;
    readonly bits: string;
};

const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** Returns a lookup for one mask: true where the cell is blocked; cells outside the grid count as blocked. */
export const maskLookup = (mask: OcclusionMask) => {
    const bits = decode(mask.bits);
    return (x: number, z: number) => {
        const i = Math.floor((x - mask.x0) / mask.resolution),
            j = Math.floor((z - mask.z0) / mask.resolution);
        if (i < 0 || j < 0 || i >= mask.width || j >= mask.height) return true;
        const index = j * mask.width + i;
        return !!(bits[index >> 3] & (1 << (index & 7)));
    };
};

type Lookup = ReturnType<typeof maskLookup>;
type Point = readonly number[];

/** Every 5 cm sample of the X/Z segment a→b is clear. */
export const lineClear = (blocked: Lookup, a: Point, b: Point) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.05));
    for (let i = 0; i <= steps; i++)
        if (blocked(a[0] + ((b[0] - a[0]) * i) / steps, a[2] + ((b[2] - a[2]) * i) / steps)) return false;
    return true;
};

/**
 * A flight segment passes unless it crosses a solid band: a sample is only "through a wall" when the centre line
 * and both lines offset `side` metres to either side are blocked at the same place (±1 sample). Grazing a door jamb
 * or a wall end therefore passes, a straight crossing of a wall does not. The `ends` metres next to either end are
 * skipped, since bounce points lie against a wall and the rasterised wall may cover them.
 */
export const flightSegmentClear = (blocked: Lookup, a: Point, b: Point, side = 0.15, ends = 0.3) => {
    const dx = b[0] - a[0],
        dz = b[2] - a[2],
        length = Math.hypot(dx, dz);
    if (length <= ends * 2) return true;
    const steps = Math.ceil(length / 0.05);
    const nx = -dz / length,
        nz = dx / length;
    const row = (offset: number) => {
        const hits = new Uint8Array(steps + 1);
        for (let i = 0; i <= steps; i++) {
            const along = (length * i) / steps;
            if (along < ends || along > length - ends) continue;
            hits[i] = blocked(a[0] + (dx * i) / steps + nx * offset, a[2] + (dz * i) / steps + nz * offset) ? 1 : 0;
        }
        return hits;
    };
    const centre = row(0),
        left = row(side),
        right = row(-side);
    const near = (hits: Uint8Array, i: number) => hits[i] || hits[i - 1] || hits[i + 1];
    for (let i = 0; i <= steps; i++) if (centre[i] && near(left, i) && near(right, i)) return false;
    return true;
};
