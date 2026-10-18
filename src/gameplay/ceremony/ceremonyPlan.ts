// The final-minute entrance ceremony (pure; tested in test/ceremony.test.js). GAMEPLAY_AUTHORED.
//
// It plays in the CEREMONY.seconds before the final minute, on every client from the shared room clock, so no
// message is needed: the arena goes dark; the players still in the game walk in one after another through the
// arena's five entrances, waving, each followed by a spotlight from the roof and a camera in front; the entrances'
// shutters come down behind them; then the bowl lights up ring by ring from the centre out, and the fight starts.

import { ROUND } from '../../net/protocol.ts';
import type { Point2 } from '../../world/stadiumLayout.ts';

export type V3 = [number, number, number];

export const CEREMONY = {
    /** The whole ceremony, ending exactly when the final minute starts. */
    seconds: ROUND.ceremonySeconds,
    /** Fade to black; everyone is moved to their entrance during it. */
    fade: 0.6,
    /** Establishing shot of the dark arena before the first entrant. */
    establishing: 3.2,
    /** Walking pace (m/s) and the pause on the mark before turning to face the court. */
    walkSpeed: 1.45,
    /** Seconds between entrants: at most this… */
    maxStagger: 3,
    /** Ring-by-ring lighting, the hold on the lit arena, and the fade back to the player's own view. */
    rings: 7,
    ringInterval: 0.6,
    hold: 1.6,
    fadeOut: 0.4,
    /** Entrance shutters drop one after another from this long before the rings start. */
    shutterLead: 1.4,
    shutterStep: 0.22,
    shutterDrop: 0.7,
    /** Players further down the order than this walk in without their own camera shot. */
    featured: 8
} as const;

/**
 * The arena's entrances by direction from the court centre (measured as the gaps in the arena's wall ring):
 * north, and the four diagonals. `width` is the shutter width.
 */
export const ENTRANCE_ANGLES = [
    { id: 'N', deg: -90, width: 4.6 },
    { id: 'SE', deg: 50, width: 3.4 },
    { id: 'SW', deg: 130, width: 3.4 },
    { id: 'NE', deg: -50, width: 3.4 },
    { id: 'NW', deg: -130, width: 3.4 }
] as const;

export type Entrance = {
    id: string;
    angle: number;
    /** Distance of the wall gap from the centre (the shutter line). */
    radius: number;
    width: number;
    /** Unit direction outward. */
    out: Point2;
};

/** Entrances from the arena outline (`wallRadius(angle)` = outline distance along that direction). */
export const entrances = (wallRadius: (angle: number) => number): Entrance[] =>
    ENTRANCE_ANGLES.map(({ id, deg, width }) => {
        const angle = (deg * Math.PI) / 180;
        return { id, angle, radius: wallRadius(angle), width, out: [Math.cos(angle), Math.sin(angle)] };
    });

/** How far inside the shutter line the marks are (clear of the court's surround boards), and where walks start. */
const MARK_INSET = { N: 4.9, diagonal: 3.3 } as const;
const TUNNEL_DEPTH = 2.2;
/** Side offsets for the second, third… player on the same entrance. */
const LANES = [0, 1.7, -1.7, 3.4, -3.4];

export type Entrant = { id: string; name: string; kills: number; colour: [number, number, number]; skill?: string };

export type EntrantPlan = Entrant & {
    order: number;
    entrance: Entrance;
    from: V3;
    to: V3;
    /** Facing at the mark (rad, yaw about +y; 0 faces −z): toward the court centre. */
    faceYaw: number;
    start: number;
    walk: number;
    featured: boolean;
};

export type CeremonyPlan = {
    entrants: EntrantPlan[];
    /** When each entrance's shutter starts to drop (by entrance id). */
    shutters: Record<string, number>;
    ringsAt: number;
    /** Ring k lights at ringsAt + k·ringInterval. */
    ring: (k: number) => number;
    holdAt: number;
    fadeOutAt: number;
};

const yawToward = (from: Point2, to: Point2) => Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));

/** Order: most eliminations first, then name (every client computes the same order). */
export const ceremonyOrder = (players: readonly Entrant[]) =>
    [...players].sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export const planCeremony = (players: readonly Entrant[], center: Point2, doors: readonly Entrance[]): CeremonyPlan => {
    const ordered = ceremonyOrder(players);
    const perEntrance = new Map<string, number>();
    const ringsAt = CEREMONY.seconds - CEREMONY.fadeOut - CEREMONY.hold - CEREMONY.rings * CEREMONY.ringInterval;
    const firstStart = CEREMONY.fade + CEREMONY.establishing;
    const entrantsRaw = ordered.map((player, order) => {
        const entrance = doors[order % doors.length];
        const lane = perEntrance.get(entrance.id) ?? 0;
        perEntrance.set(entrance.id, lane + 1);
        const side = LANES[lane % LANES.length];
        const [ox, oz] = entrance.out;
        const across: Point2 = [-oz, ox];
        const inset = entrance.id === 'N' ? MARK_INSET.N : MARK_INSET.diagonal;
        const at = (r: number, s: number): V3 => [
            center[0] + ox * r + across[0] * s,
            0,
            center[1] + oz * r + across[1] * s
        ];
        const from = at(entrance.radius + TUNNEL_DEPTH, side * 0.4);
        const to = at(entrance.radius - inset, side);
        const walk = Math.hypot(to[0] - from[0], to[2] - from[2]) / CEREMONY.walkSpeed;
        return { ...player, order, entrance, from, to, walk, faceYaw: yawToward([to[0], to[2]], center) };
    });
    const longest = Math.max(0, ...entrantsRaw.map((e) => e.walk));
    // Everyone must be on their mark (plus a breath) before the shutters start to drop.
    const lastStart = ringsAt - CEREMONY.shutterLead - longest - 0.3;
    const stagger =
        entrantsRaw.length > 1
            ? Math.min(CEREMONY.maxStagger, Math.max(0, (lastStart - firstStart) / (entrantsRaw.length - 1)))
            : 0;
    const entrants = entrantsRaw.map((e) => ({
        ...e,
        start: firstStart + e.order * stagger,
        featured: e.order < CEREMONY.featured
    }));
    const shutters: Record<string, number> = {};
    doors.forEach((door, i) => (shutters[door.id] = ringsAt - CEREMONY.shutterLead + i * CEREMONY.shutterStep));
    return {
        entrants,
        shutters,
        ringsAt,
        ring: (k) => ringsAt + k * CEREMONY.ringInterval,
        holdAt: ringsAt + CEREMONY.rings * CEREMONY.ringInterval,
        fadeOutAt: CEREMONY.seconds - CEREMONY.fadeOut
    };
};

/** Where an entrant is at ceremony time t (they wait in the tunnel, walk in, then stand on the mark). */
export const entrantAt = (e: EntrantPlan, t: number) => {
    const u = Math.max(0, Math.min(1, (t - e.start) / e.walk));
    const position: V3 = [e.from[0] + (e.to[0] - e.from[0]) * u, 0, e.from[2] + (e.to[2] - e.from[2]) * u];
    const walking = t >= e.start && u < 1;
    const walkYaw = yawToward([e.from[0], e.from[2]], [e.to[0], e.to[2]]);
    // Turn to face the court over half a second after arriving.
    const turn = Math.max(0, Math.min(1, (t - e.start - e.walk) / 0.5));
    let delta = e.faceYaw - walkYaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return {
        position,
        yaw: walkYaw + delta * turn * turn * (3 - 2 * turn),
        walking,
        arrived: u >= 1,
        visible: t >= e.start - 0.2
    };
};

/** Shutter drop (0 open … 1 shut) at ceremony time t. */
export const shutterAt = (plan: CeremonyPlan, id: string, t: number) => {
    const u = Math.max(0, Math.min(1, (t - plan.shutters[id]) / CEREMONY.shutterDrop));
    // Falls with a little bounce at the bottom.
    return u < 1 ? u * u : 1;
};

/** Brightness (0…1) of light ring k at time t: off, a bright flash as it strikes, then steady. */
export const ringLevel = (plan: CeremonyPlan, k: number, t: number) => {
    const dt = t - plan.ring(k);
    if (dt < 0) return 0;
    if (dt < 0.12) return (dt / 0.12) * 1.4;
    return Math.max(1, 1.4 - (dt - 0.12) * 1.2);
};

export type Shot = { eye: V3; target: V3; fov: number };

/**
 * The ceremony camera at time t: a high establishing crane; then for each featured entrant a shot from a little
 * ahead of them, low and to the side, looking back at them as they walk toward it; during the rings a rising,
 * turning aerial over the court.
 */
export const shotAt = (plan: CeremonyPlan, center: Point2, t: number): Shot => {
    const [cx, cz] = center;
    const featured = plan.entrants.filter((e) => e.featured);
    const shutterStart = Math.min(...Object.values(plan.shutters));
    const current = [...featured].reverse().find((e) => t >= e.start - 0.15);
    if (t >= shutterStart - 0.6 || !current) {
        // Aerial, always inside the roof ring's opening (it starts ~21 m out at 18.8 m up): before the first entrant
        // it sinks and drifts outward under the roof's edge; from the shutters on it rises back up through the opening.
        const before = t < shutterStart - 0.6;
        const k = before
            ? Math.min(1, t / Math.max(1, featured[0]?.start ?? 1))
            : Math.min(1, (t - shutterStart + 0.6) / 8);
        const angle = -2.2 + k * 0.9 + (before ? 0 : 0.9);
        const radius = before ? 16 + 3.5 * k : 19.5 - 6 * k;
        const height = before ? 24 - 10 * k : 13 + 12 * k;
        return {
            eye: [cx + Math.cos(angle) * radius, height, cz + Math.sin(angle) * radius],
            target: [cx, 0.5, cz],
            fov: 62
        };
    }
    const at = entrantAt(current, t).position;
    const [dx, dz] = [current.to[0] - current.from[0], current.to[2] - current.from[2]];
    const length = Math.hypot(dx, dz) || 1;
    const fx = dx / length,
        fz = dz / length;
    // The camera holds a spot ahead of the walk line and a little to the side.
    const ahead = 3.2;
    const side = current.order % 2 ? 1.3 : -1.3;
    const eye: V3 = [current.to[0] + fx * ahead - fz * side, 1.35, current.to[2] + fz * ahead + fx * side];
    return { eye, target: [at[0], 1.35, at[2]], fov: 44 };
};
