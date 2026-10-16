// GAMEPLAY_AUTHORED door signage: one projecting blade sign and one flat wall plaque per room, at the room's main
// entrance, on the outside (corridor) face of the wall. Placement follows reference photos of M104: the kraft blade
// sign is fixed to the wall just beyond the door's jamb at the top of the door and projects into the corridor
// (bottom ≈2.2 m); the red plaque sits on the wall beside the other jamb at eye height.
//
// Entrances are found from the geometry: runs of the room outline where a straight 1.3 m crossing from inside the
// room to outside it meets no wall or glazing (authored doorway cuts are opened first). Not surveyed.
import type { Doorway } from '../src/world/doorways.ts';
import { doorwayContains } from '../src/world/doorways.ts';
import type { Vec2 } from '../src/world/geometry2d.ts';
import type { CampusRoom } from '../src/world/roomIndex.ts';
import { findRoomAt, pointInRoom } from '../src/world/roomIndex.ts';

import type { Grid } from './navAudit.ts';

/** `x, z` is a point on the outside wall face; `yaw` turns local +X to the outward wall normal. */
export type SignMount = { x: number; z: number; yaw: number };
export type SignRecord = { room: string; blade: SignMount; plaque: SignMount };
/** An entrance given explicitly: jambs on the room-side wall face (for authored rooms). */
export type AuthoredEntrance = { room: string; a: Vec2; b: Vec2 };

const round = (value: number) => Math.round(value * 1000) / 1000;
const MIN_OPENING = 0.6;
/** Rooms that get no door sign (open-air courtyards). */
const UNSIGNED_KINDS = new Set(['garden']);

type Entrance = { a: Vec2; b: Vec2; o: Vec2; corridor: boolean; width: number };

/** Walls and glazing rasterised on a grid. */
export type SolidRaster = { grid: Grid; solid: Uint8Array };

export const deriveSigns = (
    rooms: CampusRoom[],
    fineRaster: SolidRaster & { coarse: SolidRaster },
    doorways: Doorway[],
    authored: AuthoredEntrance[] = []
): SignRecord[] => {
    const regionRooms = rooms.filter((room) => room.hasRegion);
    // Authored doorway cuts open the walls before anything is measured.
    const applyCuts = (raster: SolidRaster, cells: Uint8Array) => {
        const out = cells.slice();
        for (const cut of doorways) {
            const reach = Math.max(cut.width, cut.depth);
            const step = raster.grid.resolution / 2;
            for (let x = cut.center[0] - reach; x <= cut.center[0] + reach; x += step) {
                for (let z = cut.center[1] - reach; z <= cut.center[1] + reach; z += step) {
                    const k = raster.grid.index(x, z);
                    if (k >= 0 && doorwayContains(cut, x, z)) out[k] = 0;
                }
            }
        }
        return out;
    };
    const grid = fineRaster;
    const solid = applyCuts(fineRaster, fineRaster.solid);
    const isSolid = (x: number, z: number) => {
        const k = grid.grid.index(x, z);
        return k < 0 || solid[k] > 0;
    };
    /** Outside wall face crossed from `p` (room side) along `o`, or null when no wall is there. */
    const outsideFace = (p: Vec2, o: Vec2): Vec2 | null => {
        let inWall = false;
        for (let t = -0.7; t <= 1.2; t += grid.grid.resolution / 2) {
            const here = isSolid(p[0] + o[0] * t, p[1] + o[1] * t);
            if (here) inWall = true;
            else if (inWall) return [p[0] + o[0] * t, p[1] + o[1] * t];
        }
        return null;
    };

    // Openings: close the wall raster (dilate then erode) so door-sized gaps seal; the cells that closing fills
    // between a room's sealed interior and the outside are its entrances.
    const coarse = grid.coarse;
    const coarseSolid = applyCuts(coarse, coarse.solid);
    const closings = [0.6, 1.0, 1.6, 0.8].map((radius) => {
        const dilated = coarse.grid.inflate(coarseSolid, radius);
        const outside = new Uint8Array(dilated.length);
        for (let k = 0; k < dilated.length; k++) outside[k] = dilated[k] ? 0 : 1;
        const grown = coarse.grid.inflate(outside, radius);
        const closed = new Uint8Array(dilated.length);
        for (let k = 0; k < dilated.length; k++) closed[k] = grown[k] ? 0 : 1;
        for (let k = 0; k < dilated.length; k++) if (coarseSolid[k]) closed[k] = 1;
        return { closed, radius };
    });

    const entrancesOf = (room: CampusRoom): Entrance[] => {
        const g = coarse.grid;
        const ring = room.polygon!.outer;
        const area =
            Math.abs(
                ring.reduce((sum, [x, z], i) => {
                    const [nx, nz] = ring[(i + 1) % ring.length];
                    return sum + x * nz - nx * z;
                }, 0)
            ) / 2;
        const xs = ring.map(([x]) => x);
        const zs = ring.map(([, z]) => z);
        for (const { closed, radius } of closings) {
            const maxDepth = Math.ceil((2 * radius + 1.6) / g.resolution);
            // Seed: the polygon point farthest from walls in the closed raster (coarse search).
            let seed = -1;
            let best = -1;
            for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2) {
                for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.2) {
                    const k = g.index(x, z);
                    if (k < 0 || closed[k] || !pointInRoom([x, z], room)) continue;
                    let clearance = 0;
                    while (
                        clearance < 1.5 &&
                        !closed[g.index(x + clearance, z)] &&
                        !closed[g.index(x - clearance, z)] &&
                        !closed[g.index(x, z + clearance)] &&
                        !closed[g.index(x, z - clearance)]
                    )
                        clearance += 0.1;
                    if (clearance > best) {
                        best = clearance;
                        seed = k;
                    }
                }
            }
            if (seed < 0) continue;
            const { reached: interior, count } = g.flood((k) => !closed[k], seed);
            const flooded = count * g.resolution * g.resolution;
            if (flooded > area * 2.5 + 6) continue; // leaked through a wide opening: try a larger closing
            const gap = (k: number) => closed[k] && !coarseSolid[k];
            const seen = new Uint8Array(closed.length);
            const entrances: Entrance[] = [];
            const neighbours = (k: number) => [k - 1, k + 1, k - g.width, k + g.width];
            for (let k0 = 0; k0 < closed.length; k0++) {
                if (!interior[k0]) continue;
                for (const start of neighbours(k0)) {
                    if (seen[start] || !gap(start)) continue;
                    // Bounded search (closing diameter + 0.6 m) so a corridor that the closing also filled is not swallowed.
                    const rim: number[] = [];
                    const queue: [number, number][] = [[start, 0]];
                    seen[start] = 1;
                    let touchesOutside = false;
                    let ix = 0;
                    let iz = 0;
                    let inner = 0;
                    while (queue.length) {
                        const [k, depth] = queue.shift()!;
                        let onRim = false;
                        for (const n of neighbours(k)) {
                            if (interior[n]) {
                                onRim = true;
                                const [cx, cz] = g.centre(n);
                                ix += cx;
                                iz += cz;
                                inner++;
                            } else if (gap(n)) {
                                if (!seen[n] && depth < maxDepth) {
                                    seen[n] = 1;
                                    queue.push([n, depth + 1]);
                                }
                            } else if (!closed[n]) touchesOutside = true;
                        }
                        if (onRim) rim.push(k);
                    }
                    if (!touchesOutside || rim.length < 5) continue;
                    // Opening line: principal axis of the rim cells (the opening on the room side).
                    const points = rim.map((k) => g.centre(k));
                    const mx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
                    const mz = points.reduce((sum, p) => sum + p[1], 0) / points.length;
                    let sxx = 0;
                    let szz = 0;
                    let sxz = 0;
                    for (const [x, z] of points) {
                        sxx += (x - mx) ** 2;
                        szz += (z - mz) ** 2;
                        sxz += (x - mx) * (z - mz);
                    }
                    const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
                    const dir: Vec2 = [Math.cos(angle), Math.sin(angle)];
                    let o: Vec2 = [-dir[1], dir[0]];
                    if (inner && (ix / inner - mx) * o[0] + (iz / inner - mz) * o[1] > 0) o = [-o[0], -o[1]];
                    const along = points.map(([x, z]) => (x - mx) * dir[0] + (z - mz) * dir[1]);
                    const lo = Math.min(...along) - g.resolution / 2;
                    const hi = Math.max(...along) + g.resolution / 2;
                    const width = hi - lo;
                    if (width < MIN_OPENING) continue;
                    const beyond = findRoomAt([mx + o[0] * 1.6, mz + o[1] * 1.6], regionRooms);
                    entrances.push({
                        a: [mx + dir[0] * lo, mz + dir[1] * lo],
                        b: [mx + dir[0] * hi, mz + dir[1] * hi],
                        o,
                        corridor: !beyond || beyond === room,
                        width
                    });
                }
            }
            return entrances;
        }
        return [];
    };

    /** Fallback for rooms open along a side: outline runs with a clear straight crossing to outside the room. */
    const openSides = (room: CampusRoom): Entrance[] => {
        const ring = room.polygon!.outer;
        const clearLine = (p: Vec2, q: Vec2) => {
            const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / (grid.grid.resolution / 2));
            for (let i = 0; i <= steps; i++) {
                if (isSolid(p[0] + ((q[0] - p[0]) * i) / steps, p[1] + ((q[1] - p[1]) * i) / steps)) return false;
            }
            return true;
        };
        const samples: { p: Vec2; o: Vec2; open: boolean }[] = [];
        for (let i = 0; i < ring.length; i++) {
            const [ax, az] = ring[i];
            const [bx, bz] = ring[(i + 1) % ring.length];
            const length = Math.hypot(bx - ax, bz - az);
            for (let t = 0; t < length; t += 0.1) {
                const dir: Vec2 = [(bx - ax) / length, (bz - az) / length];
                const p: Vec2 = [ax + dir[0] * t, az + dir[1] * t];
                let o: Vec2 = [dir[1], -dir[0]];
                if (pointInRoom([p[0] + o[0] * 0.2, p[1] + o[1] * 0.2], room)) o = [-o[0], -o[1]];
                const inside: Vec2 = [p[0] - o[0] * 0.4, p[1] - o[1] * 0.4];
                const outside: Vec2 = [p[0] + o[0] * 1.0, p[1] + o[1] * 1.0];
                const open = pointInRoom(inside, room) && !pointInRoom(outside, room) && clearLine(inside, outside);
                samples.push({ p, o, open });
            }
        }
        const entrances: Entrance[] = [];
        let run: typeof samples = [];
        const flush = () => {
            if (run.length > 7) {
                const a = run[0].p;
                const b = run[run.length - 1].p;
                const ox = run.reduce((sum, sample) => sum + sample.o[0], 0);
                const oz = run.reduce((sum, sample) => sum + sample.o[1], 0);
                const ol = Math.hypot(ox, oz) || 1;
                entrances.push({
                    a,
                    b,
                    o: [ox / ol, oz / ol],
                    corridor: true,
                    width: Math.hypot(b[0] - a[0], b[1] - a[1])
                });
            }
            run = [];
        };
        for (const sample of samples) {
            if (sample.open) run.push(sample);
            else flush();
        }
        flush();
        return entrances;
    };

    /** Tries the measured outward direction and its nearest 45° direction (walls are mostly on that lattice). */
    const place = (room: string, entrance: Entrance): SignRecord | null => {
        const angle = Math.atan2(entrance.o[1], entrance.o[0]);
        const lattice = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4 - Math.PI);
        const gap = (value: number) => Math.abs(Math.atan2(Math.sin(value - angle), Math.cos(value - angle)));
        const near = lattice.filter((value) => gap(value) < 0.9).sort((p, q) => gap(p) - gap(q));
        const angles = gap(near[0]) < 0.2 ? [near[0], angle, ...near.slice(1)] : [angle, ...near];
        for (const candidate of angles) {
            const sign = placeAlong(room, entrance, [Math.cos(candidate), Math.sin(candidate)]);
            if (sign) return sign;
        }
        return null;
    };

    const placeAlong = (room: string, entrance: Entrance, o: Vec2): SignRecord | null => {
        const mid: Vec2 = [(entrance.a[0] + entrance.b[0]) / 2, (entrance.a[1] + entrance.b[1]) / 2];
        const half = Math.hypot(entrance.b[0] - entrance.a[0], entrance.b[1] - entrance.a[1]) / 2;
        // Opening line perpendicular to `o`, oriented like a→b.
        let dir: Vec2 = [-o[1], o[0]];
        if (dir[0] * (entrance.b[0] - entrance.a[0]) + dir[1] * (entrance.b[1] - entrance.a[1]) < 0)
            dir = [o[1], -o[0]];
        const a: Vec2 = [mid[0] - dir[0] * half, mid[1] - dir[1] * half];
        const b: Vec2 = [mid[0] + dir[0] * half, mid[1] + dir[1] * half];
        const at = (from: Vec2, distance: number): Vec2 => [from[0] + dir[0] * distance, from[1] + dir[1] * distance];
        // Blade just beyond one jamb, plaque 0.32 m beyond the other; swapped when a side has no wall.
        const pairs: [Vec2, Vec2][] = [];
        for (const bladeOffset of [0.08, 0.2, 0.35]) {
            for (const plaqueOffset of [0.32, 0.5, 0.7]) {
                pairs.push([at(b, bladeOffset), at(a, -plaqueOffset)], [at(a, -bladeOffset), at(b, plaqueOffset)]);
            }
        }
        for (const plaqueOffset of [0.45, 0.6])
            pairs.push([at(b, 0.08), at(b, plaqueOffset)], [at(a, -0.08), at(a, -plaqueOffset)]);
        for (const [bladeAt, plaqueAt] of pairs) {
            const blade = outsideFace(bladeAt, o);
            const plaque = outsideFace(plaqueAt, o);
            if (!blade || !plaque) continue;
            const yaw = round(Math.atan2(o[1], o[0]));
            return {
                room,
                blade: { x: round(blade[0]), z: round(blade[1]), yaw },
                plaque: { x: round(plaque[0]), z: round(plaque[1]), yaw }
            };
        }
        return null;
    };

    const signs: SignRecord[] = [];
    for (const room of regionRooms) {
        if (UNSIGNED_KINDS.has(room.kind)) continue;
        const given = authored.filter((entry) => entry.room === room.id);
        let entrances: Entrance[];
        if (given.length) {
            entrances = given.map(({ a, b }) => {
                const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
                let o: Vec2 = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
                const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                if (
                    !isSolid(mid[0] + o[0] * 0.8, mid[1] + o[1] * 0.8) &&
                    pointInRoom([mid[0] + o[0] * 0.8, mid[1] + o[1] * 0.8], room)
                )
                    o = [-o[0], -o[1]];
                return { a, b, o, corridor: true, width: length };
            });
        } else {
            entrances = entrancesOf(room);
            if (!entrances.length) entrances = openSides(room);
            entrances.sort(
                (p, q) =>
                    Number(q.corridor) - Number(p.corridor) ||
                    // Prefer door-sized openings over open sides.
                    Math.abs(Math.min(p.width, 4) - 1.2) - Math.abs(Math.min(q.width, 4) - 1.2)
            );
        }
        for (const entrance of entrances) {
            const sign = place(room.id, entrance);
            if (sign) {
                signs.push(sign);
                break;
            }
        }
    }
    return signs;
};
