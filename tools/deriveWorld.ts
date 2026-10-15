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
import type { Vec2 } from '../src/world/geometry2d.ts';
import { signedArea, simplifyRing } from '../src/world/geometry2d.ts';
import type { CampusRoom } from '../src/world/roomIndex.ts';
import { findRoomAt, pointInRoom } from '../src/world/roomIndex.ts';

import { Grid, loadCampusGeometry } from './navAudit.ts';
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
};
export type FurnitureRecord = { center: Vec2; size: Vec2; yaw: number; height: number; collide: boolean };
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

    const doors = deriveDoors(geometry, fine, fineSolid);
    const { furniture, partitions } = deriveFurniture(geometry, fine, fineSolid, doors, fineArena);
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
        furniture,
        partitions,
        lights
    };
    const sources = { glbSha256: sha256(readFileSync(GLB)), roomsSha256: sha256(readFileSync(ROOMS)) };
    return { world, ceilingMask, minimap, sources };
};
