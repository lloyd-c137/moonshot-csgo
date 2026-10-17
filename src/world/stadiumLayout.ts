// 莲花球场 layout (pure; tested in test/stadium.test.js). GAMEPLAY_AUTHORED, proportioned after the owner's photos
// (twelve out-leaning petals, red lower seats, teal upper bowl, a roof ring open over the court) and fitted to the
// FF-01 arena outline. Heights and radii are illustrative, not surveyed.

export type Point2 = readonly [number, number];

export const STADIUM = {
    /** The lower bowl's front fascia now stops here; the 10 m collider above it stays (invisible). */
    fasciaTop: 4.8,
    /** LED ribbon on the fascia's inner face. */
    ribbon: { bottom: 4.15, top: 4.6 },
    /** Upper bowl: tiers rising outward from the fascia. */
    tiers: 14,
    tierRise: 0.75,
    tierRun: 0.9,
    /** Gap (m) between the arena outline and the first upper tier. */
    setback: 0.6,
    /** Radial aisles (one per petal). */
    petals: 12,
    aisleHalfWidth: 0.7,
    seatPitch: 0.55,
    /** Roof ring: inner edge over the outline (the opening follows the court), outer edge beyond the top tier. */
    roofInnerHeight: 20.8,
    roofOuterHeight: 18.8,
    roofInnerInset: 1.2,
    roofOverhang: 2.5,
    /** Each petal's outer edge bulges this much at its middle, giving the lotus outline. */
    petalBulge: 1.8,
    /** Facade: leans outward from the building roof up to the roof edge. */
    facadeBottom: 3.6,
    /** Samples around the ring. */
    segments: 96
} as const;

const intersectRadius = (outline: readonly Point2[], center: Point2, angle: number) => {
    const dx = Math.cos(angle),
        dz = Math.sin(angle);
    let best = 0;
    for (let i = 0; i < outline.length; i++) {
        const [ax, az] = outline[i];
        const [bx, bz] = outline[(i + 1) % outline.length];
        const ex = bx - ax,
            ez = bz - az;
        const denom = dx * ez - dz * ex;
        if (Math.abs(denom) < 1e-9) continue;
        const ox = ax - center[0],
            oz = az - center[1];
        const t = (ox * ez - oz * ex) / denom;
        const u = (ox * dz - oz * dx) / denom;
        if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
    }
    return best;
};

/** Outline radius around the centre at `segments` even angles, smoothed so the bowl reads as one curve. */
export const ringRadii = (outline: readonly Point2[], center: Point2, segments: number = STADIUM.segments) => {
    const raw = Array.from({ length: segments }, (_, i) =>
        intersectRadius(outline, center, (i / segments) * Math.PI * 2)
    );
    return raw.map((_, i) => {
        let sum = 0;
        for (let k = -3; k <= 3; k++) sum += raw[(i + k + segments) % segments];
        return sum / 7;
    });
};

export const angleOf = (i: number, segments: number = STADIUM.segments) => (i / segments) * Math.PI * 2;

/** Radius of upper tier `k` (its front edge) at sample `i`. */
export const tierRadius = (radii: readonly number[], i: number, k: number) =>
    radii[i % radii.length] + STADIUM.setback + k * STADIUM.tierRun;

/** Floor height of upper tier `k`. */
export const tierHeight = (k: number) => STADIUM.fasciaTop + k * STADIUM.tierRise;

/** Angular distance (rad) to the nearest radial aisle; aisles sit between petals. */
export const aisleDistance = (angle: number) => {
    const step = (Math.PI * 2) / STADIUM.petals;
    const offset = (((angle % step) + step) % step) - step / 2;
    return Math.abs(Math.abs(offset) - step / 2);
};

/** 0 at petal joins, 1 at a petal's middle: shapes the lotus scallop of the roof edge. */
export const petalShape = (angle: number) => {
    const step = (Math.PI * 2) / STADIUM.petals;
    const phase = (((angle % step) + step) % step) / step;
    return Math.sin(Math.PI * phase);
};

export type SeatSlot = { x: number; y: number; z: number; yaw: number };

/**
 * Seats for eliminated spectators: spread round-robin over all twelve petals and a band of tiers, so the crowd
 * fills the bowl evenly and a seat says nothing about where its player was.
 */
export const spectatorSeats = (radii: readonly number[], center: Point2, count = 48): SeatSlot[] => {
    const segments = radii.length;
    const slots: SeatSlot[] = [];
    const tiers = [3, 5, 7, 9];
    for (let n = 0; n < count; n++) {
        const petal = n % STADIUM.petals;
        const row = Math.floor(n / STADIUM.petals) % tiers.length;
        const angle = ((petal + 0.5 + (row % 2 ? 0.18 : -0.18)) / STADIUM.petals) * Math.PI * 2;
        const i = Math.round((angle / (Math.PI * 2)) * segments) % segments;
        const k = tiers[row];
        const r = tierRadius(radii, i, k) + STADIUM.tierRun * 0.45;
        slots.push({
            x: center[0] + Math.cos(angle) * r,
            y: tierHeight(k),
            z: center[1] + Math.sin(angle) * r,
            // Facing the court centre (same yaw convention as the execution actors: atan2(-dx, -dz) toward the target).
            yaw: (Math.atan2(Math.cos(angle), Math.sin(angle)) * 180) / Math.PI
        });
    }
    return slots;
};

/** Seat index for each spectator: stable order by id, so every client seats the crowd identically. */
export const seatAssignment = (spectatorIds: readonly string[], seats: number) => {
    const out = new Map<string, number>();
    [...spectatorIds].sort().forEach((id, index) => {
        if (index < seats) out.set(id, index);
    });
    return out;
};
