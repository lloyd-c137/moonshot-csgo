// Offline 2D navigation audit of the FF-01 collision layer. It rasterises blocking geometry at body height onto an
// X/Z grid, inflates it by the player capsule radius and flood-fills from the spawn. This is a conservative static
// approximation of the Ammo capsule, not a physics simulation; browser tests remain the runtime evidence.
import { existsSync, readFileSync } from 'node:fs';

import { BARRIER_TOP_Y, PLAYER, SAFE_SPAWN } from '../src/config/gameplay.ts';
import { JUMP_APEX, scaleWallVertex } from '../src/config/presentation.ts';
import type { BarrierWall, Triangle } from '../src/physics/boundaryBarriers.ts';
import { campusBarrierWalls, horizontalTrianglesAt } from '../src/physics/boundaryBarriers.ts';
import type { Doorway } from '../src/world/doorways.ts';
import { doorwayContains } from '../src/world/doorways.ts';
import { parseCampusRooms, pointInRoom } from '../src/world/roomIndex.ts';
import { authoredRoomScenes } from '../src/world/rooms/index.ts';

import { GlbScene } from './glb.ts';

const GLB = new URL('../public/assets/campus/MAC_Campus_FF01.glb', import.meta.url);
const ROOMS = new URL('../public/assets/campus/rooms.json', import.meta.url);
const DERIVED_WORLD = new URL('../public/assets/campus/derived/world.json', import.meta.url);

type FurnitureBox = { center: [number, number]; size: [number, number]; yaw: number; height: number; collide: boolean };

const readDerived = () =>
    existsSync(DERIVED_WORLD)
        ? (JSON.parse(readFileSync(DERIVED_WORLD, 'utf8')) as { furniture: FurnitureBox[]; doorways?: Doorway[] })
        : { furniture: [], doorways: [] };

/** Colliding furniture from the derived world data, as two triangles each (footprint only). */
const furnitureFootprints = (furniture: FurnitureBox[]): Triangle[] =>
    furniture
        .filter((item) => item.collide)
        .flatMap(({ center: [x, z], size: [w, d], yaw, height }) => {
            const c = Math.cos(yaw);
            const s = Math.sin(yaw);
            const p = [
                [-w / 2, -d / 2],
                [w / 2, -d / 2],
                [w / 2, d / 2],
                [-w / 2, d / 2]
            ].map(([u, v]): [number, number, number] => [x + u * c - v * s, height / 2, z + u * s + v * c]);
            return [
                [p[0], p[1], p[2]],
                [p[0], p[2], p[3]]
            ] as Triangle[];
        });

const SEAT_NODES = Array.from({ length: 8 }, (_, index) => `Arena_Seats_Row${String(index).padStart(2, '0')}`);

export const CELL = { WALL: 1, GLASS: 2, STAND: 3, BARRIER: 4, FURNITURE: 5 } as const;

export class Grid {
    readonly resolution: number;
    readonly x0 = -69;
    readonly z0 = -62;
    readonly width: number;
    readonly height: number;

    constructor(resolution = 0.05) {
        this.resolution = resolution;
        this.width = Math.ceil(140 / resolution);
        this.height = Math.ceil(122 / resolution);
    }

    index(x: number, z: number) {
        const i = Math.floor((x - this.x0) / this.resolution);
        const j = Math.floor((z - this.z0) / this.resolution);
        return i < 0 || j < 0 || i >= this.width || j >= this.height ? -1 : j * this.width + i;
    }

    centre(index: number): [number, number] {
        return [
            this.x0 + ((index % this.width) + 0.5) * this.resolution,
            this.z0 + (Math.floor(index / this.width) + 0.5) * this.resolution
        ];
    }

    segment(cells: Uint8Array, [ax, az]: [number, number], [bx, bz]: [number, number], value: number) {
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (this.resolution / 2)));
        for (let step = 0; step <= steps; step++) {
            const k = this.index(ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps);
            if (k >= 0) cells[k] = value;
        }
    }

    triangle(cells: Uint8Array, triangle: Triangle, value: number) {
        const points = triangle.map(([x, , z]) => [x, z] as [number, number]);
        for (let edge = 0; edge < 3; edge++) this.segment(cells, points[edge], points[(edge + 1) % 3], value);
        const [[ax, az], [bx, bz], [cx, cz]] = points;
        const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(det) < 1e-9) return;
        const xs = points.map(([x]) => x);
        const zs = points.map(([, z]) => z);
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += this.resolution) {
            for (let z = Math.min(...zs); z <= Math.max(...zs); z += this.resolution) {
                const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
                const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
                if (l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6) {
                    const k = this.index(x, z);
                    if (k >= 0) cells[k] = value;
                }
            }
        }
    }

    /** Marks every cell within `radius` of a blocked cell. */
    inflate(blocked: Uint8Array, radius: number) {
        const out = new Uint8Array(blocked.length);
        const reach = Math.ceil(radius / this.resolution);
        const disk: number[] = [];
        for (let dj = -reach; dj <= reach; dj++) {
            for (let di = -reach; di <= reach; di++) {
                if (Math.hypot(di, dj) * this.resolution <= radius) disk.push(dj * this.width + di);
            }
        }
        const { width } = this;
        for (let k = 0; k < blocked.length; k++) {
            if (!blocked[k]) continue;
            out[k] = 1;
            if (blocked[k - 1] && blocked[k + 1] && blocked[k - width] && blocked[k + width]) continue;
            const i = k % width;
            for (const offset of disk) {
                const n = k + offset;
                const ni = n % width;
                if (n >= 0 && n < out.length && Math.abs(ni - i) <= reach) out[n] = 1;
            }
        }
        return out;
    }

    flood(free: (k: number) => boolean, start: number) {
        const reached = new Uint8Array(this.width * this.height);
        if (start < 0 || !free(start)) return { reached, count: 0 };
        const queue = new Int32Array(reached.length);
        let head = 0;
        let tail = 0;
        queue[tail++] = start;
        reached[start] = 1;
        while (head < tail) {
            const k = queue[head++];
            const i = k % this.width;
            const neighbours = [i > 0 ? k - 1 : -1, i < this.width - 1 ? k + 1 : -1, k - this.width, k + this.width];
            for (const n of neighbours) {
                if (n >= 0 && n < reached.length && !reached[n] && free(n)) {
                    reached[n] = 1;
                    queue[tail++] = n;
                }
            }
        }
        return { reached, count: tail };
    }
}

export type AuditOptions = {
    radius?: number;
    barriers?: boolean;
    resolution?: number;
    /** Doorways cut through walls/glazing; defaults to the derived world's doorways. */
    cuts?: Doorway[];
    /** Include colliding derived furniture (default true). */
    furniture?: boolean;
};

export const loadCampusGeometry = () => {
    const scene = new GlbScene(GLB);
    const rooms = parseCampusRooms(JSON.parse(readFileSync(ROOMS, 'utf8')));
    const floor = scene.triangles('Floor_Slab');
    // Same presentation adapter as the runtime: walls, wall tops and glazing are scaled vertically.
    const scaled = (name: string) => scene.triangles(name).map((triangle) => triangle.map(scaleWallVertex) as Triangle);
    const walls = scaled('Walls');
    const wallTops = scaled('Walls_Top');
    const glazing = scaled('Glazing');
    const barrierWalls = campusBarrierWalls({ floor, wallTops, glazing }, BARRIER_TOP_Y);
    const derived = readDerived();
    return {
        scene,
        rooms: rooms.rooms,
        floor: [...horizontalTrianglesAt(floor, 0), ...horizontalTrianglesAt(scene.triangles('Arena_Court'), 0)],
        walls,
        glazing,
        stands: [scene.triangles('Arena_StandBase'), ...SEAT_NODES.map((name) => scene.triangles(name))].flat(),
        topSeats: scene.triangles('Arena_Seats_Row07'),
        furniture: furnitureFootprints([
            ...derived.furniture,
            // Authored room interiors collide through their own footprint boxes.
            ...authoredRoomScenes().flatMap((scene) =>
                scene.colliders.map(
                    ({ x, z, w, d, h, yaw }) =>
                        ({ center: [x, z], size: [w, d], yaw, height: h, collide: true }) as FurnitureBox
                )
            )
        ]),
        doorways: derived.doorways ?? [],
        wallTops,
        barrierWalls
    };
};

type Geometry = ReturnType<typeof loadCampusGeometry>;

const overlaps = (triangle: Triangle, low: number, high: number) => {
    const ys = triangle.map((vertex) => vertex[1]);
    return Math.max(...ys) > low && Math.min(...ys) < high;
};

/**
 * Floor-level audit: which source rooms the capsule can reach from the spawn, and whether any reachable floor ends
 * at an open slab edge (a place to fall out of the level).
 */
export const auditFloor = (
    geometry: Geometry,
    { radius = PLAYER.radius, barriers = true, resolution = 0.05, cuts, furniture = true }: AuditOptions = {}
) => {
    const grid = new Grid(resolution);
    const size = grid.width * grid.height;
    const floor = new Uint8Array(size);
    const solid = new Uint8Array(size);
    for (const triangle of geometry.floor) grid.triangle(floor, triangle, 1);
    // Body height band of a standing capsule: ankle (0.25 m) to head (1.85 m).
    for (const triangle of geometry.walls)
        if (overlaps(triangle, 0.25, 1.85)) grid.triangle(solid, triangle, CELL.WALL);
    for (const triangle of geometry.glazing)
        if (overlaps(triangle, 0.25, 1.85)) grid.triangle(solid, triangle, CELL.GLASS);
    for (const triangle of geometry.stands)
        if (overlaps(triangle, 0.25, 1.85)) grid.triangle(solid, triangle, CELL.STAND);
    if (furniture) for (const triangle of geometry.furniture) grid.triangle(solid, triangle, CELL.FURNITURE);
    // Authored doorways open the walls/glazing over their footprint (the cut spans the whole body band).
    for (const cut of cuts ?? geometry.doorways) {
        const reach = Math.max(cut.width, cut.depth);
        for (let x = cut.center[0] - reach; x <= cut.center[0] + reach; x += resolution / 2) {
            for (let z = cut.center[1] - reach; z <= cut.center[1] + reach; z += resolution / 2) {
                const k = grid.index(x, z);
                if (k >= 0 && (solid[k] === CELL.WALL || solid[k] === CELL.GLASS) && doorwayContains(cut, x, z))
                    solid[k] = 0;
            }
        }
    }
    if (barriers) {
        for (const wall of geometry.barrierWalls as BarrierWall[]) {
            if (wall.bottom < 1.85) grid.segment(solid, wall.edge[0], wall.edge[1], CELL.BARRIER);
        }
    }
    const blocked = new Uint8Array(size);
    for (let k = 0; k < size; k++) blocked[k] = solid[k] ? 1 : 0;
    const inflated = grid.inflate(blocked, radius);
    const spawn = grid.index(SAFE_SPAWN.x, SAFE_SPAWN.z);
    // The capsule centre may stand anywhere not within `radius` of a solid; leaving the slab is a fall.
    const { reached, count } = grid.flood((k) => !inflated[k], spawn);
    let fallCells = 0;
    for (let k = 0; k < size; k++) if (reached[k] && !floor[k]) fallCells++;

    const rooms = geometry.rooms
        .filter((room) => room.hasRegion)
        .map((room) => {
            let samples = 0;
            let reachable = 0;
            const outer = room.polygon!.outer;
            const xs = outer.map(([x]) => x);
            const zs = outer.map(([, z]) => z);
            for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.2) {
                for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.2) {
                    if (!pointInRoom([x, z], room)) continue;
                    samples++;
                    const k = grid.index(x, z);
                    if (k >= 0 && reached[k] && floor[k]) reachable++;
                }
            }
            return { id: room.id, kind: room.kind, samples, reachable: samples ? reachable / samples : 0 };
        });
    return {
        grid,
        floor,
        solid,
        inflated,
        reached,
        spawnFree: count > 0,
        reachableArea: count * resolution * resolution,
        fallArea: fallCells * resolution * resolution,
        rooms,
        reachableRooms: rooms.filter((room) => room.reachable > 0.05).map((room) => room.id),
        unreachableRooms: rooms.filter((room) => room.reachable <= 0.05).map((room) => room.id)
    };
};

/**
 * Elevated audit for the stands: at the height of a capsule standing on the top seat row (above the 2.8 m walls),
 * flood-fill from that row ignoring support. Stepping off into the air only drops the player back to the floor; the
 * escape route is standing on a wall or glazing top, so the result is the reachable area over those top surfaces.
 */
export const auditTopSeats = (geometry: Geometry, { radius = PLAYER.radius, barriers = true }: AuditOptions = {}) => {
    const grid = new Grid(0.05);
    const size = grid.width * grid.height;
    const solid = new Uint8Array(size);
    const tops = new Uint8Array(size);
    for (const triangle of geometry.wallTops) grid.triangle(tops, triangle, 1);
    const glazingTop = Math.max(...geometry.glazing.flat().map((vertex) => vertex[1]));
    for (const triangle of horizontalTrianglesAt(geometry.glazing, glazingTop, 0.01)) grid.triangle(tops, triangle, 1);
    const topY = Math.max(...geometry.topSeats.flat().map((vertex) => vertex[1]));
    // Feet at the jump apex from the top seat row, head a capsule height above.
    const low = topY + JUMP_APEX;
    const high = low + PLAYER.height;
    for (const triangle of geometry.walls) if (overlaps(triangle, low, high)) grid.triangle(solid, triangle, CELL.WALL);
    for (const triangle of geometry.glazing)
        if (overlaps(triangle, low, high)) grid.triangle(solid, triangle, CELL.GLASS);
    if (barriers) {
        for (const wall of geometry.barrierWalls) {
            if (wall.bottom < high && wall.top > low) grid.segment(solid, wall.edge[0], wall.edge[1], CELL.BARRIER);
        }
    }
    const inflated = grid.inflate(solid, radius);
    const seat = geometry.topSeats.flatMap((triangle) => triangle).find((vertex) => vertex[1] >= topY - 1e-3)!;
    const { reached, count } = grid.flood((k) => !inflated[k], grid.index(seat[0], seat[2]));
    let overTops = 0;
    for (let k = 0; k < size; k++) if (reached[k] && tops[k]) overTops++;
    return {
        seatHeight: topY,
        start: [seat[0], seat[2]] as [number, number],
        area: count * 0.05 * 0.05,
        wallTopArea: overTops * 0.05 * 0.05
    };
};
