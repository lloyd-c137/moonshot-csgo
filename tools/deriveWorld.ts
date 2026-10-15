// Offline derivation of GAMEPLAY_AUTHORED presentation data from the immutable source GLB and rooms.json.
// Outputs (public/assets/campus/derived/): world.json, ceiling-mask.png, minimap.png, manifest.json.
// Run with `npm run derive:world`; `npm test` re-derives in memory and checks the committed outputs match.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
    ARENA_CLIP_RADIUS,
    CEILING_HEIGHT,
    DERIVED_GRID,
    DOOR_HEIGHT,
    MINIMAP_RESOLUTION,
    WALL_HEIGHT
} from '../src/config/presentation.ts';
import type { Doorway } from '../src/world/doorways.ts';
import type { Vec2 } from '../src/world/geometry2d.ts';
import { signedArea, simplifyRing } from '../src/world/geometry2d.ts';
import type { CampusRoom } from '../src/world/roomIndex.ts';
import { findRoomAt, pointInRoom } from '../src/world/roomIndex.ts';

import { auditFloor, CELL, Grid, loadCampusGeometry } from './navAudit.ts';
import type { Image } from './png.ts';

export const DERIVED_SCHEMA = 1;
const GLB = new URL('../public/assets/campus/MAC_Campus_FF01.glb', import.meta.url);
const ROOMS = new URL('../public/assets/campus/rooms.json', import.meta.url);
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const roundPoint = ([x, z]: Vec2): Vec2 => [round(x), round(z)];

type Geometry = ReturnType<typeof loadCampusGeometry>;

export type DoorRecord = {
    /** Hinge jamb, closed-leaf tip (other jamb) and open-leaf tip, X/Z metres. */
    hinge: Vec2;
    closed: Vec2;
    open: Vec2;
    /** Lintel centre-line offset from the hinge→closed line (along its left normal) and wall thickness. */
    offset: number;
    thickness: number;
    /** Set for doors in authored doorways: the source wall above the cut is the lintel. */
    authored?: true;
};
export type FurnitureType =
    'seat' | 'table' | 'counter' | 'desk' | 'teacher-desk' | 'chair' | 'stool' | 'bench' | 'lab-bench' | 'shelf';
/**
 * `source: 'linework'` items are interpreted from enclosed source furniture outlines; `'layout'` items are authored
 * per room kind where the source draws none. Chairs face local +X (backrest at −X).
 */
export type FurnitureRecord = {
    type: FurnitureType;
    source: 'linework' | 'layout';
    room?: string;
    center: Vec2;
    size: Vec2;
    yaw: number;
    height: number;
    collide: boolean;
};
export type LightRecord = [number, number, number, number]; // x, z, height, kind (0 room, 1 corridor)
export type DerivedWorld = {
    schema: number;
    status: 'GAMEPLAY_AUTHORED';
    note: string;
    wallHeight: number;
    ceilingHeight: number;
    /** Open-air arena region (no ceiling). */
    arena: { outline: Vec2[]; center: Vec2 };
    doorHeight: number;
    doors: DoorRecord[];
    doorways: Doorway[];
    furniture: FurnitureRecord[];
    partitions: [Vec2, Vec2][];
    lights: LightRecord[];
};

/** Rasterises polygons (with holes) of the given rooms into `cells`. */
const rasteriseRooms = (grid: Grid, cells: Uint8Array, rooms: CampusRoom[], value = 1) => {
    for (const room of rooms) {
        if (!room.polygon) continue;
        const xs = room.polygon.outer.map(([x]) => x);
        const zs = room.polygon.outer.map(([, z]) => z);
        for (let x = Math.min(...xs); x <= Math.max(...xs) + grid.resolution; x += grid.resolution) {
            for (let z = Math.min(...zs); z <= Math.max(...zs) + grid.resolution; z += grid.resolution) {
                const k = grid.index(x, z);
                if (k < 0) continue;
                const [cx, cz] = grid.centre(k);
                if (pointInRoom([cx, cz], room)) cells[k] = value;
            }
        }
    }
};

const rasterisePolygon = (grid: Grid, cells: Uint8Array, ring: Vec2[]) => {
    const xs = ring.map(([x]) => x);
    const zs = ring.map(([, z]) => z);
    for (let x = Math.min(...xs); x <= Math.max(...xs) + grid.resolution; x += grid.resolution) {
        for (let z = Math.min(...zs); z <= Math.max(...zs) + grid.resolution; z += grid.resolution) {
            const k = grid.index(x, z);
            if (k < 0) continue;
            const [cx, cz] = grid.centre(k);
            let inside = false;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [ax, az] = ring[j];
                const [bx, bz] = ring[i];
                if (az > cz !== bz > cz && cx < ((bx - ax) * (cz - az)) / (bz - az) + ax) inside = !inside;
            }
            if (inside) cells[k] = 1;
        }
    }
};

/** Outer boundary of the largest 4-connected region of `cells`, as a counter-clockwise ring of cell corners. */
export const traceLargestRegion = (grid: Grid, cells: Uint8Array): Vec2[] => {
    const size = grid.width * grid.height;
    const label = new Int32Array(size).fill(-1);
    let best = -1;
    let bestCount = 0;
    const queue = new Int32Array(size);
    for (let start = 0, id = 0; start < size; start++) {
        if (!cells[start] || label[start] >= 0) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        label[start] = id;
        while (head < tail) {
            const k = queue[head++];
            const i = k % grid.width;
            for (const n of [i > 0 ? k - 1 : -1, i < grid.width - 1 ? k + 1 : -1, k - grid.width, k + grid.width]) {
                if (n >= 0 && n < size && cells[n] && label[n] < 0) {
                    label[n] = id;
                    queue[tail++] = n;
                }
            }
        }
        if (tail > bestCount) {
            bestCount = tail;
            best = id;
        }
        id++;
    }
    // Directed boundary edges between corner lattice points, region on the left.
    const W = grid.width + 1;
    const next = new Map<number, number>();
    const inRegion = (i: number, j: number) =>
        i >= 0 && j >= 0 && i < grid.width && j < grid.height && label[j * grid.width + i] === best;
    for (let j = 0; j < grid.height; j++) {
        for (let i = 0; i < grid.width; i++) {
            if (!inRegion(i, j)) continue;
            if (!inRegion(i, j - 1)) next.set(j * W + i + 1, j * W + i); // top edge, walking -x
            if (!inRegion(i, j + 1)) next.set((j + 1) * W + i, (j + 1) * W + i + 1); // bottom edge, +x
            if (!inRegion(i - 1, j)) next.set(j * W + i, (j + 1) * W + i); // left edge, +z
            if (!inRegion(i + 1, j)) next.set((j + 1) * W + i + 1, j * W + i + 1); // right edge, -z
        }
    }
    // The outer loop contains the lattice corner with the smallest index.
    const start = Math.min(...next.keys());
    const ring: Vec2[] = [];
    let corner = start;
    do {
        ring.push([grid.x0 + (corner % W) * grid.resolution, grid.z0 + Math.floor(corner / W) * grid.resolution]);
        corner = next.get(corner)!;
    } while (corner !== start && ring.length <= next.size);
    return signedArea(ring) < 0 ? ring.reverse() : ring;
};

/** Region dilated by `radius`, restricted to `allowed` cells. */
const dilate = (grid: Grid, region: Uint8Array, radius: number, allowed: (k: number) => boolean) => {
    const grown = grid.inflate(region, radius);
    for (let k = 0; k < grown.length; k++) if (grown[k] && !allowed(k)) grown[k] = 0;
    return grown;
};

const erode = (grid: Grid, region: Uint8Array, radius: number) => {
    const outside = new Uint8Array(region.length);
    for (let k = 0; k < region.length; k++) outside[k] = region[k] ? 0 : 1;
    const grown = grid.inflate(outside, radius);
    const out = new Uint8Array(region.length);
    for (let k = 0; k < region.length; k++) out[k] = region[k] && !grown[k] ? 1 : 0;
    return out;
};

const deriveArena = (geometry: Geometry, grid: Grid, solid: Uint8Array, roomCells: Uint8Array) => {
    const court = geometry.scene.triangles('Arena_Court').flat();
    const center: Vec2 = [
        court.reduce((sum, [x]) => sum + x, 0) / court.length,
        court.reduce((sum, [, , z]) => sum + z, 0) / court.length
    ];
    const blocked = grid.inflate(solid, 0.5);
    const withinClip = (k: number) => {
        const [x, z] = grid.centre(k);
        return Math.hypot(x - center[0], z - center[1]) < ARENA_CLIP_RADIUS;
    };
    const { reached } = grid.flood((k) => !blocked[k] && !roomCells[k] && withinClip(k), grid.index(...center));
    // Opening removes the thin tongues into side passages; dilation then brings the edge back to the wall faces.
    const opened = dilate(grid, erode(grid, reached, 1.5), 1.5, (k) => !!reached[k]);
    const region = dilate(grid, opened, 0.6, (k) => !solid[k] && !roomCells[k] && withinClip(k));
    const outline = simplifyRing(traceLargestRegion(grid, region), 0.12).map(roundPoint);
    return { center: roundPoint(center), outline };
};

type Segment = [Vec2, Vec2];

/** Polylines from line segments: endpoints welded at `tolerance`, chains walked through degree-2 vertices. */
export const chainSegments = (segments: Segment[], tolerance = 0.005): Vec2[][] => {
    const key = ([x, z]: Vec2) => `${Math.round(x / tolerance)},${Math.round(z / tolerance)}`;
    const adjacency = new Map<string, { point: Vec2; edges: number[] }>();
    segments.forEach(([a, b], index) => {
        for (const point of [a, b]) {
            const k = key(point);
            if (!adjacency.has(k)) adjacency.set(k, { point, edges: [] });
            adjacency.get(k)!.edges.push(index);
        }
    });
    const used = new Uint8Array(segments.length);
    const walk = (startKey: string, edge: number) => {
        const line: Vec2[] = [adjacency.get(startKey)!.point];
        let at = startKey;
        let current = edge;
        while (current >= 0 && !used[current]) {
            used[current] = 1;
            const [a, b] = segments[current];
            const other = key(a) === at ? b : a;
            at = key(other);
            line.push(adjacency.get(at)!.point);
            const node = adjacency.get(at)!;
            current = node.edges.length === 2 ? (node.edges.find((e) => !used[e]) ?? -1) : -1;
        }
        return line;
    };
    const lines: Vec2[][] = [];
    for (const [k, node] of adjacency) {
        if (node.edges.length === 2) continue;
        for (const edge of node.edges) if (!used[edge]) lines.push(walk(k, edge));
    }
    for (let edge = 0; edge < segments.length; edge++) {
        if (!used[edge]) lines.push(walk(key(segments[edge][0]), edge));
    }
    return lines;
};

const circleThrough = ([ax, az]: Vec2, [bx, bz]: Vec2, [cx, cz]: Vec2) => {
    const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = ax * ax + az * az;
    const b2 = bx * bx + bz * bz;
    const c2 = cx * cx + cz * cz;
    const x = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / d;
    const z = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    return { center: [x, z] as Vec2, radius: Math.hypot(ax - x, az - z) };
};

/** Quarter-circle door swings in the door linework, as hinge + two leaf tips. */
export const findDoorArcs = (segments: Segment[]) => {
    const arcs: { hinge: Vec2; tips: [Vec2, Vec2]; radius: number }[] = [];
    for (const line of chainSegments(segments)) {
        // Split polylines at sharp corners so an arc joined to a leaf line is still found.
        const pieces: Vec2[][] = [[line[0]]];
        for (let i = 1; i < line.length; i++) {
            const piece = pieces[pieces.length - 1];
            if (piece.length >= 2 && i < line.length) {
                const [px, pz] = piece[piece.length - 2];
                const [qx, qz] = piece[piece.length - 1];
                const [rx, rz] = line[i];
                const turn = Math.abs(
                    Math.atan2(
                        (qx - px) * (rz - qz) - (qz - pz) * (rx - qx),
                        (qx - px) * (rx - qx) + (qz - pz) * (rz - qz)
                    )
                );
                if (turn > 0.6) pieces.push([piece[piece.length - 1]]);
            }
            pieces[pieces.length - 1].push(line[i]);
        }
        for (const piece of pieces) {
            if (piece.length < 5) continue;
            const circle = circleThrough(piece[0], piece[Math.floor(piece.length / 2)], piece[piece.length - 1]);
            if (!circle || circle.radius < 0.5 || circle.radius > 1.4) continue;
            const { center, radius } = circle;
            if (piece.some(([x, z]) => Math.abs(Math.hypot(x - center[0], z - center[1]) - radius) > radius * 0.05))
                continue;
            const a0 = Math.atan2(piece[0][1] - center[1], piece[0][0] - center[0]);
            const a1 = Math.atan2(piece[piece.length - 1][1] - center[1], piece[piece.length - 1][0] - center[0]);
            let span = Math.abs(a1 - a0);
            if (span > Math.PI) span = 2 * Math.PI - span;
            if (span < 1.2 || span > 1.95) continue;
            arcs.push({ hinge: center, tips: [piece[0], piece[piece.length - 1]], radius });
        }
    }
    return arcs;
};

const deriveDoors = (geometry: Geometry, fine: Grid, solid: Uint8Array): DoorRecord[] => {
    const isSolid = (x: number, z: number) => {
        const k = fine.index(x, z);
        return k >= 0 && !!solid[k];
    };
    const doors: DoorRecord[] = [];
    for (const { hinge, tips } of findDoorArcs(geometry.scene.segments('Lines_Doors'))) {
        // The closed tip sits at the far jamb: continuing past it along the leaf runs into wall.
        const hits = tips.map(([x, z]) => {
            const dx = (x - hinge[0]) / Math.hypot(x - hinge[0], z - hinge[1]);
            const dz = (z - hinge[1]) / Math.hypot(x - hinge[0], z - hinge[1]);
            let count = 0;
            for (let t = 0.06; t <= 0.36; t += 0.03) if (isSolid(x + dx * t, z + dz * t)) count++;
            return count;
        });
        if (hits[0] > 0 === hits[1] > 0) continue;
        const closed = hits[0] > 0 ? tips[0] : tips[1];
        const open = hits[0] > 0 ? tips[1] : tips[0];
        const length = Math.hypot(closed[0] - hinge[0], closed[1] - hinge[1]);
        const dir: Vec2 = [(closed[0] - hinge[0]) / length, (closed[1] - hinge[1]) / length];
        const normal: Vec2 = [-dir[1], dir[0]];
        // Wall thickness across the jamb just beyond the closed tip.
        const probe: Vec2 = [closed[0] + dir[0] * 0.12, closed[1] + dir[1] * 0.12];
        let low = 0;
        let high = 0;
        if (isSolid(...probe)) {
            while (low > -0.5 && isSolid(probe[0] + normal[0] * (low - 0.01), probe[1] + normal[1] * (low - 0.01)))
                low -= 0.01;
            while (high < 0.5 && isSolid(probe[0] + normal[0] * (high + 0.01), probe[1] + normal[1] * (high + 0.01)))
                high += 0.01;
        }
        const thickness = high - low >= 0.06 ? high - low + 0.02 : 0.2;
        doors.push({
            hinge: roundPoint(hinge),
            closed: roundPoint(closed),
            open: roundPoint(open),
            offset: round(high - low >= 0.06 ? (low + high) / 2 : 0),
            thickness: round(thickness)
        });
    }
    return doors;
};

const DOORWAY_WIDTHS = [0.95, 0.8];

/**
 * Finds a doorway connecting the unreachable free floor containing `room` to reachable floor: a straight crossing of
 * a single thin source wall (or glazing) that also holds across the doorway width. Works for rooms and for corridors
 * that the source walls seal off. Prefers the thinnest wall.
 */
const findDoorway = (room: CampusRoom, audit: ReturnType<typeof auditFloor>, handled: Uint8Array[]): Doorway | null => {
    const { grid, reached, floor, solid, inflated } = audit;
    const size = grid.width * grid.height;
    const free = (k: number) => k >= 0 && !inflated[k] && !!floor[k];
    // Free region containing the room (unreachable by definition).
    let seed = -1;
    const outer = room.polygon!.outer;
    const xs = outer.map(([x]) => x);
    const zs = outer.map(([, z]) => z);
    for (let x = Math.min(...xs); x <= Math.max(...xs) && seed < 0; x += 0.1) {
        for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.1) {
            const k = grid.index(x, z);
            if (free(k) && !reached[k] && pointInRoom([x, z], room)) {
                seed = k;
                break;
            }
        }
    }
    if (seed < 0 || handled.some((region) => region[seed])) return null;
    const region = grid.flood((k) => free(k) && !reached[k], seed).reached;
    handled.push(region);

    const isWallCell = (k: number) => solid[k] === CELL.WALL || solid[k] === CELL.GLASS;
    type Crossing = { first: number; last: number; end: number };
    const cross = (x: number, z: number, dx: number, dz: number): Crossing | null => {
        let first = -1;
        let last = -1;
        let leftRegion = false;
        for (let t = 0; t <= 1.6; t += grid.resolution / 2) {
            const k = grid.index(x + dx * t, z + dz * t);
            if (k < 0) return null;
            if (reached[k] && floor[k]) return first >= 0 ? { first, last, end: t } : null;
            if (region[k]) {
                if (leftRegion) return null;
                continue;
            }
            leftRegion = true;
            if (free(k)) return null; // a third free area in between
            // Diagonal walls rasterise as staircases; test the 4-neighbourhood so a ray cannot slip between steps.
            if ([k, k - 1, k + 1, k - grid.width, k + grid.width].some(isWallCell)) {
                if (first < 0) first = t;
                last = t;
            } else if (solid[k]) return null; // stands, barriers, furniture
        }
        return null;
    };

    let best: (Doorway & { score: number }) | null = null;
    const evaluate = (x: number, z: number, angle: number) => {
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const centre = cross(x, z, dx, dz);
        if (!centre) return null;
        const thickness = centre.last - centre.first + grid.resolution;
        if (thickness > 0.7) return null;
        for (const width of DOORWAY_WIDTHS) {
            const half = width / 2 + 0.05;
            const sides = [-half, half].map((offset) => cross(x - dz * offset, z + dx * offset, dx, dz));
            if (sides.some((side) => !side || Math.abs(side.first - centre.first) > 0.1)) continue;
            return { thickness, width, mid: (centre.first + centre.last) / 2, dx, dz };
        }
        return null;
    };
    for (let k = 0; k < size; k += 2) {
        if (!region[k]) continue;
        const [x, z] = grid.centre(k);
        for (let step = 0; step < 16; step++) {
            let found = evaluate(x, z, (step / 16) * Math.PI * 2);
            if (!found || (best && found.thickness >= best.score + 0.1)) continue;
            // Refine the direction to the wall normal (thinnest crossing) so the cut box aligns with the wall.
            let angle = (step / 16) * Math.PI * 2;
            for (let delta = -12; delta <= 12; delta++) {
                const candidateAngle = ((step / 16) * 360 + delta) * (Math.PI / 180);
                const refined = evaluate(x, z, candidateAngle);
                if (refined && refined.thickness < found.thickness - 1e-9) {
                    found = refined;
                    angle = candidateAngle;
                }
            }
            // Prefer the wider door, then the thinner wall.
            const score = found.thickness + (found.width < 0.9 ? 0.2 : 0);
            if (best && score >= best.score) continue;
            best = {
                room: room.id,
                center: roundPoint([x + found.dx * found.mid, z + found.dz * found.mid]),
                yaw: round(angle + Math.PI / 2),
                width: found.width,
                depth: round(found.thickness + 0.3),
                height: DOOR_HEIGHT,
                score
            };
        }
    }
    if (!best) return null;
    const { score, ...doorway } = best;
    void score;
    return doorway;
};

/** Doorways for every room the source walls seal off, opened iteratively (a room may open onto another). */
const deriveDoorways = (geometry: Geometry) => {
    const doorways: Doorway[] = [];
    for (let pass = 0; pass < 6; pass++) {
        const audit = auditFloor(geometry, { cuts: doorways, furniture: false });
        let added = 0;
        // One doorway per sealed region per pass; the next pass re-audits with the new openings.
        const handled: Uint8Array[] = [];
        for (const id of audit.unreachableRooms) {
            const room = geometry.rooms.find((candidate) => candidate.id === id)!;
            const doorway = findDoorway(room, audit, handled);
            if (doorway) {
                doorways.push(doorway);
                added++;
            }
        }
        if (!added) break;
    }
    return doorways;
};

/** Door records (open leaf into the room, no extra lintel) for authored doorways. */
const doorwayDoors = (doorways: Doorway[], rooms: CampusRoom[]): DoorRecord[] =>
    doorways.map((doorway) => {
        const c = Math.cos(doorway.yaw);
        const s = Math.sin(doorway.yaw);
        const half = doorway.width / 2;
        const hinge: Vec2 = [doorway.center[0] - c * half, doorway.center[1] - s * half];
        const room = rooms.find((candidate) => candidate.id === doorway.room)!;
        let n: Vec2 = [-s, c];
        if (!pointInRoom([doorway.center[0] + n[0] * 0.6, doorway.center[1] + n[1] * 0.6], room)) n = [s, -c];
        const inset = doorway.depth / 2;
        const hingeFace: Vec2 = [hinge[0] + n[0] * inset, hinge[1] + n[1] * inset];
        return {
            hinge: roundPoint(hingeFace),
            closed: roundPoint([hingeFace[0] + c * doorway.width, hingeFace[1] + s * doorway.width]),
            open: roundPoint([
                hingeFace[0] + n[0] * (doorway.width - 0.05),
                hingeFace[1] + n[1] * (doorway.width - 0.05)
            ]),
            offset: 0,
            thickness: round(doorway.depth),
            authored: true
        };
    });

/** Minimum-area oriented rectangle of a point set, trying orientations in 3° steps. */
const orientedBox = (points: Vec2[]) => {
    let best = { area: Infinity, yaw: 0, center: [0, 0] as Vec2, size: [0, 0] as Vec2 };
    for (let degrees = 0; degrees < 90; degrees += 3) {
        const yaw = (degrees * Math.PI) / 180;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        let u0 = Infinity;
        let u1 = -Infinity;
        let v0 = Infinity;
        let v1 = -Infinity;
        for (const [x, z] of points) {
            const u = x * c + z * s;
            const v = -x * s + z * c;
            u0 = Math.min(u0, u);
            u1 = Math.max(u1, u);
            v0 = Math.min(v0, v);
            v1 = Math.max(v1, v);
        }
        const area = (u1 - u0) * (v1 - v0);
        if (area < best.area) {
            const u = (u0 + u1) / 2;
            const v = (v0 + v1) / 2;
            best = { area, yaw, center: [u * c - v * s, u * s + v * c], size: [u1 - u0, v1 - v0] };
        }
    }
    return best;
};

const distanceToSegment = ([px, pz]: Vec2, [ax, az]: Vec2, [bx, bz]: Vec2) => {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared)) : 0;
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

const deriveFurniture = (geometry: Geometry, fine: Grid, solid: Uint8Array, doors: DoorRecord[], arena: Uint8Array) => {
    const size = fine.width * fine.height;
    const lines = new Uint8Array(size);
    const furnitureSegments = geometry.scene.segments('Lines_Furniture');
    for (const [a, b] of furnitureSegments) fine.segment(lines, a, b, 1);
    const floor = new Uint8Array(size);
    for (const triangle of geometry.floor) fine.triangle(floor, triangle, 1);
    const rooms = geometry.rooms;
    const isRestroom = (point: Vec2) => findRoomAt(point, rooms)?.kind === 'restroom';
    const nearDoor = (point: Vec2, margin: number) =>
        doors.some((door) => distanceToSegment(point, door.hinge, door.closed) < margin);

    const furniture: FurnitureRecord[] = [];
    const label = new Uint8Array(size);
    const queue = new Int32Array(size);
    for (let start = 0; start < size; start++) {
        if (label[start] || lines[start] || solid[start] || !floor[start]) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        label[start] = 1;
        while (head < tail && tail < 2000) {
            const k = queue[head++];
            const i = k % fine.width;
            for (const n of [i > 0 ? k - 1 : -1, i < fine.width - 1 ? k + 1 : -1, k - fine.width, k + fine.width]) {
                if (n >= 0 && n < size && !label[n] && !lines[n] && !solid[n] && floor[n]) {
                    label[n] = 1;
                    queue[tail++] = n;
                }
            }
        }
        // Regions that keep growing are room floor, not an object outline: mark the rest and move on.
        if (tail >= 2000) {
            while (head < tail) {
                const k = queue[head++];
                const i = k % fine.width;
                for (const n of [i > 0 ? k - 1 : -1, i < fine.width - 1 ? k + 1 : -1, k - fine.width, k + fine.width]) {
                    if (n >= 0 && n < size && !label[n] && !lines[n] && !solid[n] && floor[n]) {
                        label[n] = 1;
                        queue[tail++] = n;
                    }
                }
            }
            continue;
        }
        const area = tail * fine.resolution * fine.resolution;
        if (area < 0.04 || area > 4.5) continue;
        const points: Vec2[] = [];
        for (let index = 0; index < tail; index++) points.push(fine.centre(queue[index]));
        const box = orientedBox(points);
        const width = box.size[0] + fine.resolution;
        const depth = box.size[1] + fine.resolution;
        if (area / (width * depth) < 0.55) continue;
        const short = Math.min(width, depth);
        const long = Math.max(width, depth);
        if (short < 0.15) continue;
        if (isRestroom(box.center) || arena[fine.index(...box.center)] || nearDoor(box.center, 0.6 + long / 2))
            continue;
        const height = area < 0.2 ? 0.45 : short < 0.75 && long >= 1.2 ? 0.9 : 0.75;
        furniture.push({
            type: height <= 0.5 ? 'seat' : height >= 0.9 ? 'counter' : 'table',
            source: 'linework',
            center: roundPoint(box.center),
            size: [round(width), round(depth)],
            yaw: round(box.yaw),
            height,
            collide: height >= 0.7
        });
    }
    // Restroom linework becomes cubicle partitions (visual only).
    const partitions: [Vec2, Vec2][] = furnitureSegments
        .filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.3)
        .filter(([a, b]) => isRestroom([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]))
        .map(([a, b]) => [roundPoint(a), roundPoint(b)]);
    return { furniture, partitions };
};

const deriveLights = (
    geometry: Geometry,
    grid: Grid,
    solid: Uint8Array,
    roomCells: Uint8Array,
    arena: Uint8Array,
    courtyard: Uint8Array,
    floor: Uint8Array
) => {
    const clear = grid.inflate(solid, 0.7);
    const lights: LightRecord[] = [];
    const usable = (x: number, z: number) => {
        const k = grid.index(x, z);
        return k >= 0 && floor[k] && !clear[k] && !arena[k] && !courtyard[k];
    };
    for (const room of geometry.rooms) {
        if (!room.polygon || room.kind === 'garden') continue;
        const xs = room.polygon.outer.map(([x]) => x);
        const zs = room.polygon.outer.map(([, z]) => z);
        const spacing = 3.2;
        const before = lights.length;
        for (let x = Math.min(...xs) + spacing / 2; x < Math.max(...xs); x += spacing) {
            for (let z = Math.min(...zs) + spacing / 2; z < Math.max(...zs); z += spacing) {
                if (pointInRoom([x, z], room) && usable(x, z)) lights.push([round(x), round(z), CEILING_HEIGHT, 0]);
            }
        }
        if (lights.length === before) {
            const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
            const cz = zs.reduce((a, b) => a + b, 0) / zs.length;
            if (pointInRoom([cx, cz], room) && usable(cx, cz)) lights.push([round(cx), round(cz), CEILING_HEIGHT, 0]);
        }
    }
    for (let x = grid.x0 + 2; x < grid.x0 + 140; x += 4.5) {
        for (let z = grid.z0 + 2; z < grid.z0 + 122; z += 4.5) {
            if (usable(x, z) && !roomCells[grid.index(x, z)]) lights.push([round(x), round(z), CEILING_HEIGHT, 1]);
        }
    }
    return lights;
};

const COLLIDING_TYPES = new Set<FurnitureType>(['desk', 'teacher-desk', 'table', 'lab-bench', 'shelf', 'counter']);
const HEIGHTS: Record<FurnitureType, number> = {
    seat: 0.45,
    table: 0.75,
    counter: 0.9,
    desk: 0.74,
    'teacher-desk': 0.76,
    chair: 0.85,
    stool: 0.65,
    bench: 0.45,
    'lab-bench': 0.9,
    shelf: 1.9
};

type LocalItem = { type: FurnitureType; u: number; v: number; w: number; d: number; turn?: number };

/** Per-kind layouts in the room's oriented frame: u along the long side (front of a classroom at −u), v across. */
const layoutFor = (kind: string, length: number, breadth: number): LocalItem[] => {
    const items: LocalItem[] = [];
    const grid = (
        pitchU: number,
        pitchV: number,
        marginU: number,
        marginV: number,
        place: (u: number, v: number) => void
    ) => {
        const countU = Math.floor((length - 2 * marginU) / pitchU) + 1;
        const countV = Math.floor((breadth - 2 * marginV) / pitchV) + 1;
        if (countU < 1 || countV < 1) return;
        const startU = -((countU - 1) * pitchU) / 2;
        const startV = -((countV - 1) * pitchV) / 2;
        for (let i = 0; i < countU; i++)
            for (let j = 0; j < countV; j++) place(startU + i * pitchU, startV + j * pitchV);
    };
    switch (kind) {
        case 'classroom': {
            // Teacher's desk at the front (−u), facing the class; paired student desks behind, facing the front.
            items.push({ type: 'teacher-desk', u: -length / 2 + 1.1, v: 0, w: 0.7, d: 1.4 });
            const rows = Math.floor((length - 3.2) / 1.25);
            const pairs = Math.floor((breadth - 1.2) / 2.2);
            for (let r = 0; r < rows; r++) {
                const u = -length / 2 + 2.6 + r * 1.25;
                for (let p = 0; p < pairs; p++) {
                    const center = -((pairs - 1) * 2.2) / 2 + p * 2.2;
                    for (const side of [-0.35, 0.35]) {
                        items.push({ type: 'desk', u, v: center + side, w: 0.5, d: 0.7 });
                        items.push({ type: 'chair', u: u + 0.5, v: center + side, w: 0.42, d: 0.42, turn: Math.PI });
                    }
                }
            }
            break;
        }
        case 'lab':
            grid(2.6, 2.1, 1.6, 1.3, (u, v) => {
                items.push({ type: 'lab-bench', u, v, w: 1.8, d: 0.75 });
                for (const du of [-0.45, 0.45]) items.push({ type: 'stool', u: u + du, v: v + 0.65, w: 0.34, d: 0.34 });
            });
            break;
        case 'library':
            grid(2.4, 1.6, 1.5, 1.2, (u, v) => items.push({ type: 'shelf', u, v, w: 1.8, d: 0.36 }));
            break;
        case 'office':
            grid(2.3, 2.1, 1.3, 1.2, (u, v) => {
                items.push({ type: 'desk', u, v, w: 1.4, d: 0.7 });
                items.push({ type: 'chair', u, v: v + 0.6, w: 0.45, d: 0.45, turn: -Math.PI / 2 });
            });
            break;
        case 'meeting': {
            const w = Math.min(length - 2.2, 4.8);
            const d = Math.min(breadth - 2.2, 1.4);
            if (w >= 1.2 && d >= 0.8) {
                items.push({ type: 'table', u: 0, v: 0, w, d });
                for (let u = -w / 2 + 0.4; u <= w / 2 - 0.3; u += 0.75) {
                    items.push({ type: 'chair', u, v: d / 2 + 0.4, w: 0.45, d: 0.45, turn: -Math.PI / 2 });
                    items.push({ type: 'chair', u, v: -d / 2 - 0.4, w: 0.45, d: 0.45, turn: Math.PI / 2 });
                }
            }
            break;
        }
        case 'dining':
            grid(2.2, 2.2, 1.4, 1.4, (u, v) => {
                items.push({ type: 'table', u, v, w: 1.2, d: 0.8 });
                for (const du of [-0.3, 0.3]) {
                    items.push({ type: 'chair', u: u + du, v: v + 0.65, w: 0.42, d: 0.42, turn: -Math.PI / 2 });
                    items.push({ type: 'chair', u: u + du, v: v - 0.65, w: 0.42, d: 0.42, turn: Math.PI / 2 });
                }
            });
            break;
        case 'creative':
            grid(2.8, 2.4, 1.6, 1.4, (u, v) => {
                items.push({ type: 'table', u, v, w: 1.6, d: 0.9 });
                for (const du of [-0.4, 0.4]) {
                    items.push({ type: 'stool', u: u + du, v: v + 0.75, w: 0.34, d: 0.34 });
                    items.push({ type: 'stool', u: u + du, v: v - 0.75, w: 0.34, d: 0.34 });
                }
            });
            break;
        case 'garden':
            grid(5, 100, 1.5, breadth / 2, (u) => items.push({ type: 'bench', u, v: 0, w: 1.6, d: 0.45 }));
            break;
        default:
    }
    return items;
};

/**
 * GAMEPLAY_AUTHORED furnishing for rooms the source linework leaves empty. Every item must lie inside its room, clear
 * of walls (0.35 m), doors (1.1 m from the opening) and other furniture; items failing a check are dropped.
 */
const deriveRoomFurnishing = (
    geometry: Geometry,
    fine: Grid,
    solid: Uint8Array,
    doors: DoorRecord[],
    existing: FurnitureRecord[],
    blocked: Uint8Array
) => {
    const wallClearance = fine.inflate(solid, 0.35);
    const occupied = new Uint8Array(fine.width * fine.height);
    const mark = (item: { center: Vec2; size: Vec2; yaw: number }, value: Uint8Array, pad: number) => {
        const c = Math.cos(item.yaw);
        const s = Math.sin(item.yaw);
        const hw = item.size[0] / 2 + pad;
        const hd = item.size[1] / 2 + pad;
        const cells: number[] = [];
        for (let a = -hw; a <= hw; a += fine.resolution / 2) {
            for (let b = -hd; b <= hd; b += fine.resolution / 2) {
                const k = fine.index(item.center[0] + a * c - b * s, item.center[1] + a * s + b * c);
                if (k >= 0) cells.push(k);
            }
        }
        if (value !== occupied) return cells;
        for (const k of cells) occupied[k] = 1;
        return cells;
    };
    for (const item of existing) mark(item, occupied, 0.1);
    const nearDoor = (point: Vec2) =>
        doors.some((door) => distanceToSegment(point, door.hinge, door.closed) < 1.1 + 0.4);
    const furnished: FurnitureRecord[] = [];
    for (const room of geometry.rooms) {
        if (!room.polygon) continue;
        const inside = existing.filter((item) => pointInRoom(item.center, room)).length;
        if (inside >= 3) continue;
        const box = orientedBox(room.polygon.outer);
        // u along the long side.
        const longIsFirst = box.size[0] >= box.size[1];
        const yaw = longIsFirst ? box.yaw : box.yaw + Math.PI / 2;
        const length = Math.max(...box.size);
        const breadth = Math.min(...box.size);
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        for (const local of layoutFor(room.kind, length, breadth)) {
            const center: Vec2 = [box.center[0] + local.u * c - local.v * s, box.center[1] + local.u * s + local.v * c];
            const item: FurnitureRecord = {
                type: local.type,
                source: 'layout',
                room: room.id,
                center: roundPoint(center),
                size: [round(local.w), round(local.d)],
                yaw: round(yaw + (local.turn ?? 0)),
                height: HEIGHTS[local.type],
                collide: COLLIDING_TYPES.has(local.type)
            };
            // Footprint checks: whole footprint in the room, clear of walls, blocked floor and other furniture.
            const cells = mark(item, new Uint8Array(0), 0);
            const ok = cells.every((k) => {
                const point = fine.centre(k);
                return pointInRoom(point, room) && !wallClearance[k] && !occupied[k] && !blocked[k];
            });
            if (!ok || nearDoor(item.center)) continue;
            mark(item, occupied, 0.01);
            furnished.push(item);
        }
    }
    return furnished;
};

const KIND_COLOURS: Record<string, [number, number, number]> = {
    classroom: [214, 226, 240],
    office: [226, 228, 232],
    meeting: [220, 234, 214],
    service: [210, 212, 216],
    hall: [240, 226, 212],
    lab: [208, 232, 228],
    creative: [234, 220, 238],
    dining: [242, 230, 200],
    library: [216, 220, 244],
    room: [222, 226, 230],
    restroom: [206, 222, 230],
    garden: [176, 214, 160],
    stair: [200, 200, 206],
    public: [236, 232, 222]
};

const deriveMinimap = (
    geometry: Geometry,
    wallCells: Uint8Array,
    glassCells: Uint8Array,
    roomKind: Uint8Array,
    kinds: string[],
    floor: Uint8Array,
    arena: Uint8Array,
    grid: Grid
): Image => {
    const width = Math.round(DERIVED_GRID.width / MINIMAP_RESOLUTION);
    const height = Math.round(DERIVED_GRID.depth / MINIMAP_RESOLUTION);
    const data = new Uint8Array(width * height * 4);
    const stand = new Uint8Array(grid.width * grid.height);
    for (const triangle of geometry.stands) grid.triangle(stand, triangle, 1);
    const court = new Uint8Array(grid.width * grid.height);
    for (const triangle of geometry.scene.triangles('Arena_Court')) grid.triangle(court, triangle, 1);
    const step = Math.round(MINIMAP_RESOLUTION / grid.resolution);
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            let colour: number[] | null = null;
            let wall = 0;
            let glass = 0;
            let any = 0;
            for (let dj = 0; dj < step; dj++) {
                for (let di = 0; di < step; di++) {
                    const k = (j * step + dj) * grid.width + i * step + di;
                    wall += wallCells[k];
                    glass += glassCells[k];
                    any += floor[k];
                }
            }
            const k = j * step * grid.width + i * step;
            if (wall) colour = [43, 48, 58, 255];
            else if (glass) colour = [96, 160, 214, 255];
            else if (stand[k]) colour = [214, 150, 92, 255];
            else if (court[k]) colour = [222, 190, 140, 255];
            else if (roomKind[k]) colour = [...KIND_COLOURS[kinds[roomKind[k] - 1]], 255];
            else if (arena[k]) colour = [232, 222, 206, 255];
            else if (any) colour = [244, 242, 238, 255];
            if (colour) data.set(colour, (j * width + i) * 4);
        }
    }
    return { width, height, channels: 4, data };
};

export const deriveWorld = () => {
    const geometry = loadCampusGeometry();
    const grid = new Grid(DERIVED_GRID.resolution);
    const fine = new Grid(0.05);
    const size = grid.width * grid.height;

    const wallCells = new Uint8Array(size);
    const glassCells = new Uint8Array(size);
    for (const triangle of geometry.walls) grid.triangle(wallCells, triangle, 1);
    for (const triangle of geometry.glazing) grid.triangle(glassCells, triangle, 1);
    const solid = new Uint8Array(size);
    for (let k = 0; k < size; k++) solid[k] = wallCells[k] || glassCells[k];
    const fineSolid = new Uint8Array(fine.width * fine.height);
    for (const triangle of [...geometry.walls, ...geometry.glazing]) fine.triangle(fineSolid, triangle, 1);

    const floor = new Uint8Array(size);
    for (const triangle of geometry.floor) grid.triangle(floor, triangle, 1);
    const regionRooms = geometry.rooms.filter((room) => room.hasRegion);
    const roomCells = new Uint8Array(size);
    rasteriseRooms(grid, roomCells, regionRooms);
    const kinds = [...new Set(regionRooms.map((room) => room.kind))].sort();
    const roomKind = new Uint8Array(size);
    for (const kind of kinds) {
        rasteriseRooms(
            grid,
            roomKind,
            regionRooms.filter((room) => room.kind === kind),
            kinds.indexOf(kind) + 1
        );
    }
    const courtyard = new Uint8Array(size);
    rasteriseRooms(
        grid,
        courtyard,
        regionRooms.filter((room) => room.kind === 'garden')
    );

    const arenaShape = deriveArena(geometry, grid, solid, roomCells);
    const arena = new Uint8Array(size);
    rasterisePolygon(grid, arena, arenaShape.outline);
    const fineArena = new Uint8Array(fine.width * fine.height);
    rasterisePolygon(fine, fineArena, arenaShape.outline);

    // Ceiling mask: opaque except over the open-air arena and courtyards.
    const mask = new Uint8Array(size);
    for (let k = 0; k < size; k++) mask[k] = arena[k] || courtyard[k] ? 0 : 255;
    const ceilingMask: Image = { width: grid.width, height: grid.height, channels: 1, data: mask };

    const doorways = deriveDoorways(geometry);
    const doors = [...deriveDoors(geometry, fine, fineSolid), ...doorwayDoors(doorways, geometry.rooms)];
    const { furniture: linework, partitions } = deriveFurniture(geometry, fine, fineSolid, doors, fineArena);
    // Cut doorways are open floor for layout purposes; the arena and stands stay unfurnished.
    const furniture = [...linework, ...deriveRoomFurnishing(geometry, fine, fineSolid, doors, linework, fineArena)];
    const lights = deriveLights(geometry, grid, solid, roomCells, arena, courtyard, floor);
    const minimap = deriveMinimap(geometry, wallCells, glassCells, roomKind, kinds, floor, arena, grid);

    const world: DerivedWorld = {
        schema: DERIVED_SCHEMA,
        status: 'GAMEPLAY_AUTHORED',
        note: 'Derived presentation data. Doors and furniture are interpreted from 2D linework; heights, lights and ceiling are authored; the arena is treated as open-air. Not surveyed.',
        wallHeight: WALL_HEIGHT,
        ceilingHeight: CEILING_HEIGHT,
        arena: { outline: arenaShape.outline, center: arenaShape.center },
        doorHeight: DOOR_HEIGHT,
        doors,
        doorways,
        furniture,
        partitions,
        lights
    };
    const sources = { glbSha256: sha256(readFileSync(GLB)), roomsSha256: sha256(readFileSync(ROOMS)) };
    return { world, ceilingMask, minimap, sources };
};
