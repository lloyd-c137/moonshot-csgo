// Derives the room naming/division layer from the owner's 2026-08-06 drawing model onto the FF-01 geometry
// (owner decision 2026-10-17: names and room division follow the 2026-08-06 model, scale follows FF-01).
//
// - FF-01 keeps every wall, collider, floor patch and derived presentation; it is cut into "pieces" (its region
//   polygons, which follow its walls).
// - The 2026-08-06 rooms (traced plan pixels) are brought into FF-01 metres by an affine fit on the rooms both models
//   share, refitted without outliers (rooms that moved or were renumbered between the drawings).
// - Each FF-01 piece belongs to the 2026-08-06 room covering most of it (≥ PIECE_SHARE); several pieces can form one
//   room. A 2026-08-06 room that owns no piece gets its own fitted polygon (only spaces FF-01 has no region for).
// - Pieces no 2026-08-06 room covers (service rooms, stairs, courtyards… the newer model leaves these out) keep their
//   FF-01 identity, unless their id now names a different place, in which case they lose the number.
import { createHash as hash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { CampusRoom, Point2 } from '../src/world/roomIndex.ts';
import { parseCampusRooms, pointInRoom } from '../src/world/roomIndex.ts';

import { GlbScene } from './glb.ts';

const SOURCE = new URL('../public/assets/campus/source-20260806/rooms.json', import.meta.url);
const FF01_ROOMS = new URL('../public/assets/campus/rooms.json', import.meta.url);
const GLB = new URL('../public/assets/campus/MAC_Campus_FF01.glb', import.meta.url);

/** A piece joins the 2026-08-06 room that covers at least this share of it… */
export const PIECE_SHARE = 0.4;
/** …but a piece numbered like a 2026-08-06 room stays with it when that room covers at least this share. */
export const SAME_ID_SHARE = 0.25;
/** Pieces whose kind shapes the geometry (open-air courtyards, stairwells) keep their FF-01 identity. */
const FIXED_KINDS = new Set(['garden', 'stair']);
/** Shared rooms whose fitted centroid is further off than this (m) are left out of the refit. */
const OUTLIER_METRES = 4;
const CELL = 0.1;

/** 2026-08-06 kinds → the game's existing kind vocabulary (stripe colours, floor finishes) and a display label. */
export const KIND_MAP: Record<string, { kind: string; kindLabel: string }> = {
    classroom: { kind: 'classroom', kindLabel: '教室与书院' },
    office: { kind: 'office', kindLabel: '办公与服务' },
    nurse: { kind: 'office', kindLabel: '医务与服务' },
    meeting: { kind: 'meeting', kindLabel: '会议与研讨' },
    study: { kind: 'library', kindLabel: '自习与阅读' },
    library: { kind: 'library', kindLabel: '图书与阅读' },
    storage: { kind: 'service', kindLabel: '库房与设备' },
    restroom: { kind: 'restroom', kindLabel: '卫生间' },
    workshop: { kind: 'lab', kindLabel: '创客与工作坊' },
    science: { kind: 'lab', kindLabel: '实验与科创' },
    computer: { kind: 'lab', kindLabel: '实验与科创' },
    music: { kind: 'creative', kindLabel: '音乐与表演' },
    art: { kind: 'creative', kindLabel: '艺术与创作' },
    cafeteria: { kind: 'dining', kindLabel: '餐饮' },
    theater: { kind: 'hall', kindLabel: '剧场与活动' },
    garden: { kind: 'garden', kindLabel: '中庭花园' }
};

type SourceRoom = { id: string; name: string; kind: string; points: [number, number][]; area?: number };
export type Affine = [[number, number], [number, number], [number, number]];
export type NamedRoom = {
    id: string;
    name: string;
    kind: string;
    kindLabel: string;
    /** FF-01 region ids that make up this room (largest first). */
    pieces: string[];
    /** Only when no FF-01 piece exists: the fitted 2026-08-06 outline (m, X/Z). */
    polygon?: Point2[];
};
export type RoomNaming = {
    source: { model: string; sha256: string };
    fit: { matrix: Affine; rooms: number; outliers: string[]; medianError: number };
    rooms: NamedRoom[];
    /** FF-01 pieces kept as they are, under their FF-01 identity (id → name). */
    kept: string[];
    /** FF-01 pieces whose number now belongs to another place: shown without a number. */
    unnumbered: { piece: string; name: string }[];
    /** FF-01 label-only spaces superseded by a 2026-08-06 room. */
    retired: string[];
};

const centroid = (points: readonly (readonly number[])[]) => [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length
];

/** Least-squares affine map [x, y, 1] → [X, Z] (solves the 3×3 normal equations twice). */
export const fitAffine = (pairs: [number[], number[]][]): Affine => {
    const m = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
    ];
    const r = [
        [0, 0],
        [0, 0],
        [0, 0]
    ];
    for (const [p, q] of pairs) {
        const v = [p[0], p[1], 1];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) m[i][j] += v[i] * v[j];
            r[i][0] += v[i] * q[0];
            r[i][1] += v[i] * q[1];
        }
    }
    const solve = (column: number) => {
        const a = m.map((row, i) => [...row, r[i][column]]);
        for (let c = 0; c < 3; c++) {
            const pivot = a
                .slice(c)
                .reduce((best, row, k) => (Math.abs(row[c]) > Math.abs(a[best][c]) ? k + c : best), c);
            [a[c], a[pivot]] = [a[pivot], a[c]];
            for (let k = 0; k < 3; k++) {
                if (k === c) continue;
                const f = a[k][c] / a[c][c];
                for (let j = c; j < 4; j++) a[k][j] -= f * a[c][j];
            }
        }
        return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
    };
    const x = solve(0),
        z = solve(1);
    return [
        [x[0], z[0]],
        [x[1], z[1]],
        [x[2], z[2]]
    ];
};

export const applyAffine = (matrix: Affine, [x, y]: readonly number[]): Point2 => [
    matrix[0][0] * x + matrix[1][0] * y + matrix[2][0],
    matrix[0][1] * x + matrix[1][1] * y + matrix[2][1]
];

const round = (value: number) => Math.round(value * 100) / 100;
const createHash = (text: string) => hash('sha256').update(text).digest('hex');
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Point-in-polygon for plain rings (the fitted 2026-08-06 outlines have no holes). */
const inRing = ([x, z]: readonly number[], ring: readonly Point2[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j],
            [bx, bz] = ring[i];
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside;
};

const bounds = (ring: readonly Point2[]) => ({
    x0: Math.min(...ring.map((p) => p[0])),
    x1: Math.max(...ring.map((p) => p[0])),
    z0: Math.min(...ring.map((p) => p[1])),
    z1: Math.max(...ring.map((p) => p[1]))
});

export const deriveRoomNaming = (): RoomNaming => {
    const sourceText = readFileSync(SOURCE, 'utf8');
    const source = (JSON.parse(sourceText) as { rooms: SourceRoom[] }).rooms;
    const ff01 = parseCampusRooms(JSON.parse(readFileSync(FF01_ROOMS, 'utf8'))).rooms;
    const ffById = new Map(ff01.map((room) => [room.id, room]));
    const regions = ff01.filter((room) => room.hasRegion && room.polygon);

    // Fit, then refit without rooms that moved between the drawings.
    const shared = source.filter((room) => ffById.get(room.id)?.polygon);
    const pair = (room: SourceRoom): [number[], number[]] => [
        centroid(room.points),
        centroid(ffById.get(room.id)!.polygon!.outer)
    ];
    let matrix = fitAffine(shared.map(pair));
    const error = (room: SourceRoom) => {
        const [p, q] = pair(room);
        const f = applyAffine(matrix, p);
        return Math.hypot(f[0] - q[0], f[1] - q[1]);
    };
    const outliers = shared.filter((room) => error(room) > OUTLIER_METRES).map((room) => room.id);
    matrix = fitAffine(shared.filter((room) => !outliers.includes(room.id)).map(pair));
    const inliers = shared.filter((room) => !outliers.includes(room.id));
    const fitted = new Map(source.map((room) => [room.id, room.points.map((p) => applyAffine(matrix, p))]));

    // Coverage of each FF-01 piece by each fitted 2026-08-06 room, sampled on a 0.1 m grid.
    const owner = new Map<string, { id: string; share: number }>();
    for (const piece of regions) {
        if (FIXED_KINDS.has(piece.kind)) continue;
        const box = bounds(piece.polygon!.outer);
        const candidates = source.filter((room) => {
            const b = bounds(fitted.get(room.id)!);
            return b.x0 < box.x1 && b.x1 > box.x0 && b.z0 < box.z1 && b.z1 > box.z0;
        });
        let total = 0;
        const counts = new Map<string, number>();
        for (let x = box.x0 + CELL / 2; x < box.x1; x += CELL) {
            for (let z = box.z0 + CELL / 2; z < box.z1; z += CELL) {
                if (!pointInRoom([x, z], piece)) continue;
                total++;
                for (const room of candidates)
                    if (inRing([x, z], fitted.get(room.id)!)) counts.set(room.id, (counts.get(room.id) ?? 0) + 1);
            }
        }
        if (!total) continue;
        const same = counts.get(piece.id) ?? 0;
        const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (same / total >= SAME_ID_SHARE) owner.set(piece.id, { id: piece.id, share: same / total });
        else if (best && best[1] / total >= PIECE_SHARE) owner.set(piece.id, { id: best[0], share: best[1] / total });
    }

    const area = (room: CampusRoom) => {
        const ring = room.polygon!.outer;
        return (
            Math.abs(
                ring.reduce(
                    (s, [x, z], i) => s + x * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * z,
                    0
                )
            ) / 2
        );
    };
    const rooms: NamedRoom[] = source.map((room) => {
        const mapped = KIND_MAP[room.kind] ?? { kind: 'room', kindLabel: '其他房间' };
        const pieces = regions
            .filter((piece) => owner.get(piece.id)?.id === room.id)
            .sort((a, b) => area(b) - area(a) || a.id.localeCompare(b.id))
            .map((piece) => piece.id);
        return {
            id: room.id,
            name: room.name,
            ...mapped,
            pieces,
            ...(pieces.length ? {} : { polygon: fitted.get(room.id)!.map(([x, z]) => [round(x), round(z)] as Point2) })
        };
    });
    const newIds = new Set(source.map((room) => room.id));
    const unowned = regions.filter((piece) => !owner.has(piece.id));
    const kept = unowned.filter((piece) => !newIds.has(piece.id)).map((piece) => piece.id);
    const unnumbered = unowned
        .filter((piece) => newIds.has(piece.id))
        .map((piece) => ({ piece: piece.id, name: piece.name }));

    // FF-01 label-only spaces: superseded when their source label anchor lies in a fitted 2026-08-06 room.
    const scene = new GlbScene(GLB);
    const retired = ff01
        .filter((room) => !room.hasRegion)
        .filter((room) => {
            const [x, , z] = scene.position(`Label_${room.id}`);
            return newIds.has(room.id) || source.some((s) => inRing([x, z], fitted.get(s.id)!));
        })
        .map((room) => room.id);

    return {
        source: {
            model: 'Campus Living Atlas rooms traced from the 2026-08-06 plan (owner upload 2026-10-17)',
            sha256: createHash(sourceText)
        },
        fit: {
            matrix: matrix.map((row) => row.map((v) => Math.round(v * 1e6) / 1e6)) as Affine,
            rooms: inliers.length,
            outliers,
            medianError: round(median(inliers.map(error)))
        },
        rooms,
        kept,
        unnumbered,
        retired
    };
};
