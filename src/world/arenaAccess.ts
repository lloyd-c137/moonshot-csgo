// Walkable access to the Lotus Arena's upper bowl (pure; tested in test/arena-access.test.js). GAMEPLAY_AUTHORED.
//
// - The FF-01 court-level stands collide as solid stepped rows instead of individual seat pedestals (the 0.33 m
//   gaps between pedestal rows trapped the capsule).
// - A central stair on the west and east stands climbs from the floor to the parapet (STADIUM.fasciaTop).
// - The upper bowl collides: tread/riser steps between aisles, and every radial aisle is a two-steps-per-tier stair
//   whose collider is the ramp through its nosings (a capsule cannot climb 0.31 m risers, but walks the ramp).
// Visual seat rows and the bowl outline are unchanged.

import type { Point2 } from './stadiumLayout.ts';
import { STADIUM, tierHeight } from './stadiumLayout.ts';

export const ARENA_ACCESS = {
    /** Half width (m) of a bowl aisle stair and its ramp collider. */
    aisleHalfWidth: 0.6,
    /** Two steps per tier in the aisles: each half tread is this fraction of a tier run. */
    halfStep: 0.5,
    /** Back wall collider top behind the highest tier. */
    backTop: 22,
    /** Court-level stand stair: width, step rise, and the slope it is laid out at. */
    stair: { width: 1.8, rise: 0.2, slopeDeg: 30 },
    /** Arena wall half depth inside the outline (wall box centred 0.12 m outside, 0.35 m deep). */
    wallInner: 0.055
} as const;

/** Exact aisle angles (rad): STADIUM.aisles evenly spaced from angle 0 (three per petal). */
export const aisleAngles = () => Array.from({ length: STADIUM.aisles }, (_, i) => (i * Math.PI * 2) / STADIUM.aisles);

/** The ring radius at any angle, interpolated between the `radii` samples (sample i is at angle i·2π/n). */
export const radiusAt = (radii: readonly number[], angle: number) => {
    const n = radii.length;
    const t = ((((angle / (Math.PI * 2)) * n) % n) + n) % n;
    const i = Math.floor(t);
    const f = t - i;
    return radii[i] * (1 - f) + radii[(i + 1) % n] * f;
};

/** Front-edge radius of tier `k` at `angle` (matches stadiumLayout.tierRadius at the samples). */
export const tierRadiusAt = (radii: readonly number[], angle: number, k: number) =>
    radiusAt(radii, angle) +
    STADIUM.setback +
    k * STADIUM.tierRun +
    (k > STADIUM.walkwayTier ? STADIUM.walkwayExtra : 0);

const tierRun = (k: number) => STADIUM.tierRun + (k === STADIUM.walkwayTier ? STADIUM.walkwayExtra : 0);

export type Tread = { r0: number; r1: number; y: number };

/**
 * An aisle stair's treads, outward from the parapet: the parapet cap, then two half steps per tier (rise
 * tierRise/2). On the walkway tier the stair only occupies the last half run, leaving the cross-aisle flat.
 */
export const aisleTreads = (radii: readonly number[], angle: number): Tread[] => {
    const half = STADIUM.tierRise / 2;
    const run = STADIUM.tierRun * ARENA_ACCESS.halfStep;
    const treads: Tread[] = [
        { r0: radiusAt(radii, angle) - 0.3, r1: tierRadiusAt(radii, angle, 0), y: STADIUM.fasciaTop }
    ];
    for (let k = 0; k < STADIUM.tiers; k++) {
        const r0 = tierRadiusAt(radii, angle, k);
        const r1 = r0 + tierRun(k);
        // Keep the cross-aisle at its actual level. Above it, begin each stair one tier-rise below that
        // seating row so the two half steps connect continuously to the next tier instead of leaving a
        // vertical 0.31 m collision edge at every tier boundary.
        const y = k > STADIUM.walkwayTier ? tierHeight(k) - STADIUM.tierRise : tierHeight(k);
        const secondY = k === STADIUM.walkwayTier ? y : y + half;
        treads.push({ r0, r1: r1 - run, y }, { r0: r1 - run, r1, y: secondY });
    }
    return treads;
};

/**
 * The walking line over a run of treads: the start of the first tread, the front edge (nosing) of every higher
 * tread, and the end of the last. Every step corner lies on or under it, so a capsule never meets a riser.
 */
export const nosingLine = (treads: readonly Tread[]): Point2[] => {
    const points: Point2[] = [[treads[0].r0, treads[0].y]];
    for (let i = 0; i < treads.length; i++) {
        const next = treads[i + 1];
        // A ramp rises over the tread, ending at the next tread's height. Placing the height change
        // at the next tread's start creates a vertical, degenerate ramp face that catches the capsule.
        const endY = next?.y ?? treads[i].y + STADIUM.tierRise / 2;
        points.push([treads[i].r1, endY]);
    }
    return points;
};

/** Height of a polyline (r, y) at radius r (clamped to its ends). */
export const lineHeight = (line: readonly Point2[], r: number) => {
    if (r <= line[0][0]) return line[0][1];
    for (let i = 1; i < line.length; i++) {
        const [r0, y0] = line[i - 1];
        const [r1, y1] = line[i];
        if (r <= r1) return r1 === r0 ? y1 : y0 + ((y1 - y0) * (r - r0)) / (r1 - r0);
    }
    return line[line.length - 1][1];
};

type V3 = [number, number, number];
export type ColliderMesh = { positions: number[]; indices: number[] };

const pushQuad = (mesh: ColliderMesh, a: V3, b: V3, c: V3, d: V3) => {
    const base = mesh.positions.length / 3;
    mesh.positions.push(...a, ...b, ...c, ...d);
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
};

/**
 * One static collision mesh for the upper bowl: stepped treads/risers in each gap between aisles, a ramp along
 * every aisle stair, and a tall wall behind the top tier so nobody walks off the back.
 */
export const bowlCollider = (radii: readonly number[], center: Point2, subdivisions = 4): ColliderMesh => {
    const [cx, cz] = center;
    const mesh: ColliderMesh = { positions: [], indices: [] };
    const at = (angle: number, r: number, y: number): V3 => [cx + Math.cos(angle) * r, y, cz + Math.sin(angle) * r];
    const top = STADIUM.tiers - 1;
    const backY = tierHeight(top);
    const angles = aisleAngles();
    const halfAngle = (angle: number) => ARENA_ACCESS.aisleHalfWidth / tierRadiusAt(radii, angle, 0);

    angles.forEach((aisle, index) => {
        const next = index + 1 < angles.length ? angles[index + 1] : Math.PI * 2;
        // The stepped seating between this aisle and the next (overlapping the ramps by a few centimetres).
        const g0 = aisle + halfAngle(aisle) * 0.9;
        const g1 = next - halfAngle(next) * 0.9;
        for (let s = 0; s < subdivisions; s++) {
            const a0 = g0 + ((g1 - g0) * s) / subdivisions;
            const a1 = g0 + ((g1 - g0) * (s + 1)) / subdivisions;
            const cap0 = radiusAt(radii, a0) - 0.3,
                cap1 = radiusAt(radii, a1) - 0.3;
            const f0 = tierRadiusAt(radii, a0, 0),
                f1 = tierRadiusAt(radii, a1, 0);
            const y0 = STADIUM.fasciaTop;
            pushQuad(mesh, at(a0, cap0, y0), at(a0, f0, y0), at(a1, f1, y0), at(a1, cap1, y0));
            for (let k = 0; k <= top; k++) {
                const y = tierHeight(k);
                const r00 = tierRadiusAt(radii, a0, k),
                    r01 = tierRadiusAt(radii, a1, k);
                const r10 = r00 + tierRun(k),
                    r11 = r01 + tierRun(k);
                pushQuad(mesh, at(a0, r00, y), at(a0, r10, y), at(a1, r11, y), at(a1, r01, y));
                const riserTop = k === top ? ARENA_ACCESS.backTop : y + STADIUM.tierRise;
                pushQuad(mesh, at(a0, r10, y), at(a1, r11, y), at(a1, r11, riserTop), at(a0, r10, riserTop));
            }
        }
        // The aisle stair: its walking ramp, and the back wall behind it.
        const a0 = aisle - halfAngle(aisle),
            a1 = aisle + halfAngle(aisle);
        const line0 = nosingLine(aisleTreads(radii, a0));
        const line1 = nosingLine(aisleTreads(radii, a1));
        for (let i = 1; i < line0.length; i++) {
            pushQuad(
                mesh,
                at(a0, line0[i - 1][0], line0[i - 1][1]),
                at(a0, line0[i][0], line0[i][1]),
                at(a1, line1[i][0], line1[i][1]),
                at(a1, line1[i - 1][0], line1[i - 1][1])
            );
        }
        const back0 = line0[line0.length - 1][0],
            back1 = line1[line1.length - 1][0];
        pushQuad(
            mesh,
            at(a0, back0, backY),
            at(a1, back1, backY),
            at(a1, back1, ARENA_ACCESS.backTop),
            at(a0, back0, ARENA_ACCESS.backTop)
        );
    });
    return mesh;
};

/** True when (x, z) lies under the upper bowl: outward from just inside the parapet to just past its back wall. */
export const underBowl = (radii: readonly number[], center: Point2, x: number, z: number) => {
    const dx = x - center[0],
        dz = z - center[1];
    const angle = Math.atan2(dz, dx);
    const r = Math.hypot(dx, dz);
    const inner = radiusAt(radii, angle) - 0.45;
    const outer = tierRadiusAt(radii, angle, STADIUM.tiers - 1) + STADIUM.tierRun + 0.6;
    return r >= inner && r <= outer;
};

/**
 * FF-01 court-level stands (source Arena_Seats_Row00–07, measured from the GLB): each row's front edge (inner x),
 * seat top and z extent. West rows step out toward −x, east rows toward +x, 0.85 m apart.
 */
export const SOURCE_STAND_ROWS = [
    { top: 0.45, z0: -16.55, z1: 10.85 },
    { top: 0.83, z0: -16.55, z1: 10.85 },
    { top: 1.21, z0: -16.04, z1: 10.34 },
    { top: 1.59, z0: -14.54, z1: 8.84 },
    { top: 1.97, z0: -13.04, z1: 7.34 },
    { top: 2.35, z0: -11.54, z1: 5.84 },
    { top: 2.73, z0: -6.32, z1: 0.62 },
    { top: 3.11, z0: -6.82, z1: 1.13 }
] as const;
export const SOURCE_STAND_FRONT = { west: -24.55, east: 7.75 } as const;
export const SOURCE_STAND_PITCH = 0.85;

export type StandBlock = { x0: number; x1: number; z0: number; z1: number; top: number };

/**
 * Solid stepped blocks replacing the seat-pedestal colliders: row k fills from its front edge to the next row's
 * front edge (the last row reaches the arena wall at `wallX`), so no gap is left to fall into.
 */
/**
 * The two walkways that cross each court-level stand in the FF-01 model (gaps in every seat row, measured from the
 * GLB): the row colliders stop at their edges so the walkways stay open (owner report 2026-10-18: filled in, they
 * were invisible walls that trapped anyone who got inside).
 */
export const SOURCE_STAND_AISLES: readonly (readonly [number, number])[] = [
    [-10.1, -8.83],
    [3.12, 4.39]
];

export const standBlocks = (side: 'west' | 'east', wallX: number): StandBlock[] => {
    const dir = side === 'west' ? -1 : 1;
    const front = SOURCE_STAND_FRONT[side];
    const blocks: StandBlock[] = [];
    SOURCE_STAND_ROWS.forEach((row, k) => {
        const a = front + dir * SOURCE_STAND_PITCH * k;
        const b = k + 1 < SOURCE_STAND_ROWS.length ? front + dir * SOURCE_STAND_PITCH * (k + 1) : wallX;
        // The row, cut at each walkway it crosses.
        let z0: number = row.z0;
        for (const [g0, g1] of SOURCE_STAND_AISLES) {
            if (g1 <= z0 || g0 >= row.z1) continue;
            if (g0 > z0) blocks.push({ x0: Math.min(a, b), x1: Math.max(a, b), z0, z1: g0, top: row.top });
            z0 = Math.max(z0, g1);
        }
        if (z0 < row.z1) blocks.push({ x0: Math.min(a, b), x1: Math.max(a, b), z0, z1: row.z1, top: row.top });
    });
    return blocks;
};

export type StandStair = {
    side: 'west' | 'east';
    /** Centre line z and width. */
    z: number;
    width: number;
    /** Foot (floor) and top (parapet height, just inside the wall) x; the landing runs on to `landingX`. */
    footX: number;
    topX: number;
    landingX: number;
    /** Visible steps from foot to top: [x of the step's front edge, its tread height]. */
    steps: { x0: number; x1: number; y: number }[];
};

/**
 * The central stair on each court-level stand, aligned with the bowl aisle at angle π (west) or 0 (east): from the
 * floor in front of the stand, over the seat rows, to the parapet, then a landing across the wall onto tier 0.
 * `wallRadius` is the arena outline's distance from the centre along that axis.
 */
export const standStair = (
    side: 'west' | 'east',
    center: Point2,
    wallRadius: number,
    tier0Radius: number
): StandStair => {
    const dir = side === 'west' ? -1 : 1;
    const { width, rise, slopeDeg } = ARENA_ACCESS.stair;
    const height = STADIUM.fasciaTop;
    const topR = wallRadius - ARENA_ACCESS.wallInner - 0.2;
    const run = height / Math.tan((slopeDeg * Math.PI) / 180);
    const count = Math.round(height / rise);
    const tread = run / count;
    const footR = topR - run;
    const steps = Array.from({ length: count }, (_, i) => {
        const r0 = footR + tread * i,
            r1 = footR + tread * (i + 1);
        return { x0: center[0] + dir * r0, x1: center[0] + dir * r1, y: rise * (i + 1) };
    });
    return {
        side,
        z: center[1],
        width,
        footX: center[0] + dir * footR,
        topX: center[0] + dir * topR,
        landingX: center[0] + dir * (tier0Radius + 0.4),
        steps
    };
};

/**
 * Collision for a stand stair: the ramp through its nosings, the landing at parapet height, and solid sides from
 * the floor up to the ramp so nobody walks underneath it.
 */
export const standStairCollider = (stair: StandStair): ColliderMesh => {
    const mesh: ColliderMesh = { positions: [], indices: [] };
    const zA = stair.z - stair.width / 2,
        zB = stair.z + stair.width / 2;
    const top = STADIUM.fasciaTop;
    // Ramp: from the foot (y 0) through the step nosings to the top.
    pushQuad(mesh, [stair.footX, 0, zA], [stair.topX, top, zA], [stair.topX, top, zB], [stair.footX, 0, zB]);
    pushQuad(mesh, [stair.topX, top, zA], [stair.landingX, top, zA], [stair.landingX, top, zB], [stair.topX, top, zB]);
    for (const z of [zA, zB]) {
        const base = mesh.positions.length / 3;
        mesh.positions.push(stair.footX, 0, z, stair.topX, 0, z, stair.topX, top, z);
        mesh.indices.push(base, base + 1, base + 2);
    }
    return mesh;
};

/** Collision for the solid stand rows (boxes from the floor to each row's top). */
export const standBlocksCollider = (blocks: readonly StandBlock[]): ColliderMesh => {
    const mesh: ColliderMesh = { positions: [], indices: [] };
    for (const { x0, x1, z0, z1, top } of blocks) {
        pushQuad(mesh, [x0, top, z0], [x0, top, z1], [x1, top, z1], [x1, top, z0]);
        pushQuad(mesh, [x0, 0, z0], [x0, top, z0], [x1, top, z0], [x1, 0, z0]);
        pushQuad(mesh, [x0, 0, z1], [x1, 0, z1], [x1, top, z1], [x0, top, z1]);
        pushQuad(mesh, [x0, 0, z0], [x0, 0, z1], [x0, top, z1], [x0, top, z0]);
        pushQuad(mesh, [x1, 0, z0], [x1, top, z0], [x1, top, z1], [x1, 0, z1]);
    }
    return mesh;
};

/** Height range of the parapet barrier that seals the stands off from the court (final ceremony and minute). */
export const PARAPET_BARRIER = { bottom: STADIUM.fasciaTop - 0.25, top: STADIUM.fasciaTop + 4, inset: 0.05 } as const;

/**
 * An invisible wall all round the parapet, just inside its edge: with it up, nobody climbs from the court into the
 * stands (the stand stairs' landings cross it) and nobody in the stands drops into the court.
 */
export const parapetBarrier = (radii: readonly number[], center: Point2, segments = 144): ColliderMesh => {
    const mesh: ColliderMesh = { positions: [], indices: [] };
    const at = (angle: number, y: number): [number, number, number] => {
        const r = radiusAt(radii, angle) - PARAPET_BARRIER.inset;
        return [center[0] + Math.cos(angle) * r, y, center[1] + Math.sin(angle) * r];
    };
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2,
            a1 = ((i + 1) / segments) * Math.PI * 2;
        pushQuad(mesh, at(a0, PARAPET_BARRIER.bottom), at(a1, PARAPET_BARRIER.bottom), at(a1, PARAPET_BARRIER.top), at(a0, PARAPET_BARRIER.top));
    }
    return mesh;
};
