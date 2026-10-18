// 莲花球场 layout (pure; tested in test/stadium.test.js). GAMEPLAY_AUTHORED, proportioned after the owner's photos
// (twelve out-leaning petals; one continuous light-grey bowl with blue blocks, three stair aisles per petal and a
// cross-aisle walkway; a glazed band under a roof ring open over the court) and fitted to the
// FF-01 arena outline. Heights and radii are illustrative, not surveyed.

export type Point2 = readonly [number, number];

export const STADIUM = {
    /**
     * The bowl's front parapet: a low wall just above the 3.6 m building roof (owner photo 2026-10-17: one continuous
     * bowl rising from a low parapet). The 10 m collider above it stays (invisible).
     */
    fasciaTop: 4.6,
    /** Blue and white banner boards on the parapet's inner face. */
    ribbon: { bottom: 3.72, top: 4.42 },
    /** One continuous bowl: tiers rising outward from the parapet. */
    tiers: 18,
    tierRise: 0.62,
    tierRun: 0.85,
    /** A wider cross-aisle walkway (with a rail) in front of this tier, splitting lower and upper rows. */
    walkwayTier: 8,
    walkwayExtra: 1.1,
    /** Gap (m) between the arena outline and the first tier. */
    setback: 0.15,
    /** Twelve lotus petals (roof, facade, crowd seating). */
    petals: 12,
    /** Radial stair aisles: three per petal, as in the photo. */
    aisles: 36,
    aisleHalfWidth: 0.55,
    /** Glazed panel band above the top tier, under the roof ring. */
    glazingHeight: 3.2,
    seatPitch: 0.55,
    /** Roof ring: inner edge over the outline (the opening follows the court), outer edge beyond the top tier. */
    roofInnerHeight: 20.8,
    roofOuterHeight: 18.8,
    roofInnerInset: 1.2,
    roofOverhang: 2.5,
    /** Each petal's outer edge bulges this much at its middle, giving the lotus outline. */
    petalBulge: 1.8,
    /** Base of the outer shell: the building roof the stadium stands on. */
    facadeBottom: 3.6,
    /**
     * Outer shell (owner model stadium-shell.mjs, 2026-10-17 photos): twelve flat petals leaning out over a recessed
     * base. Each petal's foot sits `footOut` outside the bowl's back at `footHeight`, its top `lean` further out at
     * `topHeight`; it spans ±footSpread/±topSpread of its half-sector, leaving gaps between petals. Roof plates have
     * a central `ridge` and a `fascia`-deep outer edge.
     */
    shell: {
        footOut: 0.4,
        footHeight: 9,
        topHeight: 19,
        lean: 5.5,
        footSpread: 0.8,
        topSpread: 0.95,
        ridge: 0.6,
        fascia: 1.05
    },
    /** Samples around the ring. */
    segments: 96
} as const;

export const intersectRadius = (outline: readonly Point2[], center: Point2, angle: number) => {
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

/** Radius of tier `k` (its front edge) at sample `i`; tiers behind the walkway sit further out. */
export const tierRadius = (radii: readonly number[], i: number, k: number) =>
    radii[i % radii.length] +
    STADIUM.setback +
    k * STADIUM.tierRun +
    (k > STADIUM.walkwayTier ? STADIUM.walkwayExtra : 0);

/** Floor height of upper tier `k`. */
export const tierHeight = (k: number) => STADIUM.fasciaTop + k * STADIUM.tierRise;

/** Angular distance (rad) to the nearest radial stair aisle (three per petal, one on each petal join). */
export const aisleDistance = (angle: number) => {
    const step = (Math.PI * 2) / STADIUM.aisles;
    const offset = (((angle % step) + step) % step) - step / 2;
    return Math.abs(Math.abs(offset) - step / 2);
};

/** Angular distance (rad) to the nearest join between two of the twelve petals. */
export const petalJoinDistance = (angle: number) => {
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
/**
 * The fans' section (owner request 2026-10-18: the spectators sit together, so the ceremony camera can find them):
 * the upper rows of the south petal. Rows fill front to back, each from the middle outward, clear of the aisles.
 */
export const FAN_SECTION = { angle: Math.PI / 2, tiers: [10, 11, 12, 13, 14, 15, 16], perRow: 10 } as const;

const fanSeatAt = (radii: readonly number[], center: Point2, angle: number, k: number): SeatSlot => {
    const segments = radii.length;
    const i = Math.round((angle / (Math.PI * 2)) * segments) % segments;
    const r = tierRadius(radii, i, k) + STADIUM.tierRun * 0.45;
    return {
        x: center[0] + Math.cos(angle) * r,
        y: tierHeight(k),
        z: center[1] + Math.sin(angle) * r,
        // Facing the court centre (same yaw convention as the execution actors: atan2(-dx, -dz) toward the target).
        yaw: (Math.atan2(Math.cos(angle), Math.sin(angle)) * 180) / Math.PI
    };
};

/** Seats for players out for the round, all in the fans' section: a compact block that grows row by row. */
export const spectatorSeats = (radii: readonly number[], center: Point2, count = 48): SeatSlot[] => {
    const slots: SeatSlot[] = [];
    for (const k of FAN_SECTION.tiers) {
        const segments = radii.length;
        const i = Math.round((FAN_SECTION.angle / (Math.PI * 2)) * segments) % segments;
        const r = tierRadius(radii, i, k) + STADIUM.tierRun * 0.45;
        const step = STADIUM.seatPitch / r;
        let placed = 0;
        for (let j = 0; placed < FAN_SECTION.perRow && j < 60; j++) {
            // 0, +1, −1, +2, −2 … seats from the middle of the row.
            const offset = j === 0 ? 0 : (j % 2 ? 1 : -1) * Math.ceil(j / 2);
            const angle = FAN_SECTION.angle + offset * step;
            if (aisleDistance(angle) < 0.85 / r) continue;
            slots.push(fanSeatAt(radii, center, angle, k));
            placed++;
        }
        if (slots.length >= count) break;
    }
    return slots.slice(0, count);
};

/** Where the camera looks to film the fans: the middle of their section, at chest height. */
export const fanSectionFocus = (radii: readonly number[], center: Point2): [number, number, number] => {
    const seat = fanSeatAt(radii, center, FAN_SECTION.angle, FAN_SECTION.tiers[2]);
    return [seat.x, seat.y + 1.1, seat.z];
};

/** Seat index for each spectator: stable order by id, so every client seats the crowd identically. */
export const seatAssignment = (spectatorIds: readonly string[], seats: number) => {
    const out = new Map<string, number>();
    [...spectatorIds].sort().forEach((id, index) => {
        if (index < seats) out.set(id, index);
    });
    return out;
};

/**
 * Court level (owner photo 2026-10-17): the green apron and its low blue/white boards, a rounded rectangle round the
 * FF-01 court (x −13.9…−2.9, z −14.7…9.0) clear of both source stands (x ≤ −25, x ≥ 7) and inside the outline.
 * Boards are decoration only (no collider), with a walk-through in the middle of every side.
 */
export const COURT_SURROUND = {
    x0: -21,
    x1: 4,
    z0: -19.5,
    z1: 13.5,
    corner: 3,
    boardHeight: 0.9,
    gap: 2.4
} as const;

/** Closed outline of the surround (rounded corners), as points about a metre apart. */
export const courtSurroundPath = (): Point2[] => {
    const { x0, x1, z0, z1, corner } = COURT_SURROUND;
    const points: Point2[] = [];
    const straight = (ax: number, az: number, bx: number, bz: number) => {
        const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az)));
        for (let s = 0; s < steps; s++) points.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
    };
    const arc = (ox: number, oz: number, from: number) => {
        for (let s = 0; s < 6; s++) {
            const a = from + (s / 6) * (Math.PI / 2);
            points.push([ox + Math.cos(a) * corner, oz + Math.sin(a) * corner]);
        }
    };
    straight(x0 + corner, z0, x1 - corner, z0);
    arc(x1 - corner, z0 + corner, -Math.PI / 2);
    straight(x1, z0 + corner, x1, z1 - corner);
    arc(x1 - corner, z1 - corner, 0);
    straight(x1 - corner, z1, x0 + corner, z1);
    arc(x0 + corner, z1 - corner, Math.PI / 2);
    straight(x0, z1 - corner, x0, z0 + corner);
    arc(x0 + corner, z0 + corner, Math.PI);
    return points;
};

/** Whether a board midpoint falls in one of the four walk-throughs (middle of each side). */
export const inSurroundGap = (x: number, z: number) => {
    const { x0, x1, z0, z1, gap } = COURT_SURROUND;
    const mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
    const onEnd = Math.abs(z - z0) < 0.5 || Math.abs(z - z1) < 0.5;
    const onSide = Math.abs(x - x0) < 0.5 || Math.abs(x - x1) < 0.5;
    return (onEnd && Math.abs(x - mx) < gap / 2) || (onSide && Math.abs(z - mz) < gap / 2);
};

/**
 * Tennis court on the FF-01 court surface (x −13.9…−2.9, z −14.7…9.0: a 10.97 × 23.77 m doubles court, long axis
 * along z). Standard ITF markings; the net crosses the court's middle at z = netZ.
 */
export const TENNIS = {
    centerX: -8.4,
    netZ: -2.85,
    doublesHalfWidth: 10.97 / 2,
    singlesHalfWidth: 8.23 / 2,
    halfLength: 23.77 / 2,
    serviceFromNet: 6.4,
    line: 0.05,
    baseline: 0.1,
    /**
     * Net, 0.914 m outside the doubles lines. Owner request 2026-10-17: raised above the ITF 1.07/0.914 m so it reads
     * from across the arena and gives chest-high cover: 1.45 m at the posts, sagging to 1.3 m at the centre strap.
     */
    postOffset: 0.914,
    postHeight: 1.45,
    centreHeight: 1.3
} as const;

/** Net top height at x (sags from the posts to the centre strap). */
export const netHeightAt = (x: number) => {
    const half = TENNIS.doublesHalfWidth + TENNIS.postOffset;
    const t = Math.min(1, Math.abs(x - TENNIS.centerX) / half);
    return TENNIS.centreHeight + (TENNIS.postHeight - TENNIS.centreHeight) * t * t;
};

/** White court lines as axis-aligned rectangles [x0, z0, x1, z1]. */
export const tennisLines = (): [number, number, number, number][] => {
    const { centerX: cx, netZ: nz, doublesHalfWidth: dw, singlesHalfWidth: sw, halfLength: hl } = TENNIS;
    const { serviceFromNet: sf, line, baseline } = TENNIS;
    const h = line / 2;
    const rects: [number, number, number, number][] = [];
    for (const side of [-1, 1]) {
        const base = nz + side * hl;
        // Baseline (wider), service line, centre mark.
        rects.push([
            cx - dw,
            base - (side * baseline) / 2 - baseline / 2,
            cx + dw,
            base - (side * baseline) / 2 + baseline / 2
        ]);
        rects.push([cx - sw, nz + side * sf - h, cx + sw, nz + side * sf + h]);
        rects.push([cx - h, Math.min(base, base - side * 0.1), cx + h, Math.max(base, base - side * 0.1)]);
        // Centre service line (net to service line).
        rects.push([cx - h, Math.min(nz, nz + side * sf), cx + h, Math.max(nz, nz + side * sf)]);
    }
    // Doubles and singles sidelines, full length.
    for (const x of [cx - dw + h, cx + dw - h, cx - sw + h, cx + sw - h]) rects.push([x - h, nz - hl, x + h, nz + hl]);
    return rects;
};
