// Derives the GAMEPLAY_AUTHORED patrol route of 纪老师 (the discipline teacher NPC): a closed loop around the
// octagonal ring corridor, routed by A* over reachable corridor floor (outside room polygons, ≥ 0.8 m from walls,
// glazing and furniture) and simplified to straight legs that keep that clearance. Writes src/config/patrol.ts.
// Run: node tools/patrolCli.ts
import { writeFileSync } from 'node:fs';

import { SAFE_SPAWN } from '../src/config/gameplay.ts';
import { findRoomAt } from '../src/world/roomIndex.ts';

import { auditFloor, loadCampusGeometry } from './navAudit.ts';

const RESOLUTION = 0.1;
const CLEARANCE = 0.8;
/** Loop targets: around the ring corridor (centre and radius read off the floor plan), clockwise from the south. */
const CENTRE: [number, number] = [0, -1.5];
const RADIUS = 33;
/** `guard`: the night guard's loop instead — the outer corridors right round the floor, starting at the south gate. */
const GUARD = process.argv[2] === 'guard';
const GUARD_TARGETS: [number, number][] = [
    [-8.7, 46.3],
    [-65.12, 35.58],
    [-65.12, -1.67],
    [-56.02, -38.27],
    [-65.47, -56.27],
    [-25.92, -56.22],
    [17.13, -56.27],
    [55.98, -59.77],
    [56.33, -36.62],
    [64.72, 2.83],
    [42.33, 22.58],
    [55.98, 44.63],
    [22.73, 47.93]
];
const RING_TARGETS = Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 4 + Math.PI / 8;
    return [CENTRE[0] + Math.cos(a) * RADIUS, CENTRE[1] + Math.sin(a) * RADIUS] as [number, number];
});
const TARGETS = GUARD ? GUARD_TARGETS : RING_TARGETS;

const geometry = loadCampusGeometry();
const audit = auditFloor(geometry, { resolution: RESOLUTION });
const { grid } = audit;
const clear = grid.inflate(audit.solid.map((v) => (v ? 1 : 0)) as Uint8Array, CLEARANCE);
const rooms = geometry.rooms.filter((room) => room.hasRegion);
const open = new Uint8Array(grid.width * grid.height);
for (let k = 0; k < open.length; k++) {
    if (audit.reached[k] && audit.floor[k] && !clear[k] && !findRoomAt(grid.centre(k), rooms)) open[k] = 1;
}
// Only the corridor network connected (at this clearance) to the south entrance counts: narrow doorways cut pockets off.
const nearestOpen = ([x, z]: [number, number], ok: (k: number) => boolean) => {
    for (let r = 0; r < 12; r += RESOLUTION / 2) {
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
            const k = grid.index(x + Math.cos(a) * r, z + Math.sin(a) * r);
            if (k >= 0 && ok(k)) return k;
        }
    }
    throw new Error(`no corridor floor near ${x}, ${z}`);
};
const { reached: network } = grid.flood(
    (k) => open[k] === 1,
    nearestOpen([SAFE_SPAWN.x, SAFE_SPAWN.z], (k) => open[k] === 1)
);
const free = (k: number) => k >= 0 && network[k] === 1;
const snap = (point: [number, number]) => nearestOpen(point, free);

/** A* over 8-connected free cells with a binary heap. */
const astar = (start: number, goal: number) => {
    const w = grid.width;
    const [gx, gz] = grid.centre(goal);
    const g = new Float64Array(open.length).fill(Infinity);
    const from = new Int32Array(open.length).fill(-1);
    const heap: [number, number][] = [];
    const push = (item: [number, number]) => {
        heap.push(item);
        let c = heap.length - 1;
        while (c > 0) {
            const p = (c - 1) >> 1;
            if (heap[p][0] <= heap[c][0]) break;
            [heap[p], heap[c]] = [heap[c], heap[p]];
            c = p;
        }
    };
    const pop = () => {
        const top = heap[0];
        const last = heap.pop()!;
        if (heap.length) {
            heap[0] = last;
            let c = 0;
            for (;;) {
                const l = c * 2 + 1;
                const r = l + 1;
                let m = c;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === c) break;
                [heap[m], heap[c]] = [heap[c], heap[m]];
                c = m;
            }
        }
        return top;
    };
    g[start] = 0;
    push([0, start]);
    while (heap.length) {
        const [, k] = pop();
        if (k === goal) break;
        for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1]
        ]) {
            const n = k + dj * w + di;
            if (!free(n)) continue;
            const cost = g[k] + Math.hypot(di, dj) * RESOLUTION;
            if (cost < g[n]) {
                g[n] = cost;
                from[n] = k;
                const [x, z] = grid.centre(n);
                push([cost + Math.hypot(x - gx, z - gz), n]);
            }
        }
    }
    const path = [goal];
    while (path[path.length - 1] !== start) {
        const previous = from[path[path.length - 1]];
        if (previous < 0) throw new Error('no route');
        path.push(previous);
    }
    return path.reverse().map((k) => grid.centre(k));
};

/** Straight line between two points stays on free cells. */
const lineFree = (a: [number, number], b: [number, number]) => {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (RESOLUTION / 2));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        if (!free(grid.index(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))) return false;
    }
    return true;
};

const snapped = TARGETS.map(snap);
const route: [number, number][] = [];
for (let i = 0; i < snapped.length; i++) {
    const leg = astar(snapped[i], snapped[(i + 1) % snapped.length]);
    route.push(...(route.length ? leg.slice(1) : leg));
}
route.pop(); // closed loop: the last point is the first
// String-pull: from each kept point, the farthest point within 30 m of path that is in straight view (a bounded
// look-ahead, or the loop's own start would be "visible" from its end).
const simple: [number, number][] = [route[0]];
let i = 0;
while (i < route.length - 1) {
    let j = Math.min(route.length - 1, i + 300);
    while (j > i + 1 && !lineFree(route[i], route[j])) j--;
    simple.push(route[j]);
    i = j;
}
if (Math.hypot(simple[0][0] - simple[simple.length - 1][0], simple[0][1] - simple[simple.length - 1][1]) < 0.5)
    simple.pop();
const round = (v: number) => Math.round(v * 100) / 100;
const points = simple.map(([x, z]) => [round(x), round(z)]);
let length = 0;
for (let k = 0; k < points.length; k++) {
    const [a, b] = [points[k], points[(k + 1) % points.length]];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
}
writeFileSync(
    new URL(GUARD ? '../src/config/guardRoute.ts' : '../src/config/patrol.ts', import.meta.url),
    GUARD
        ? `// GENERATED by tools/patrolCli.ts guard — GAMEPLAY_AUTHORED closed loop for the night guard (capsule centre X/Z)
// through the outer corridors, starting at the south gate, ≥${CLEARANCE} m from walls, glazing and furniture. Shared with
// the server. Loop length ≈ ${Math.round(length)} m.
export const GUARD_ROUTE: readonly [number, number][] = ${JSON.stringify(points)};
`
        : `// GENERATED by tools/patrolCli.ts — GAMEPLAY_AUTHORED closed patrol loop for 纪老师 (capsule centre X/Z) around the
// ring corridor, ≥${CLEARANCE} m from walls, glazing and furniture. Shared with the server. Loop length ≈ ${Math.round(length)} m.
export const PATROL_ROUTE: readonly [number, number][] = ${JSON.stringify(points)};
`
);
console.log(points.length, 'points, loop', Math.round(length), 'm');
