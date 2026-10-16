// GAMEPLAY_AUTHORED interior for M104 "一小步空间 One Small Step Space", modelled from reference photos of the real
// room supplied by the project owner. Geometry and flat colours only (no textures). Positions, sizes and counts
// are estimates read from photos and fitted to the source room outline; they are NOT surveyed measurements.
//
// Layout read from the photos: the room is split by a folding partition (track along x = -46.35, panels stacked
// against the pier between the two north doors). The east half is a lounge/presentation corner (bookcases on the
// lavender-grey end wall, olive floor sofas, beanbags, a mobile 86" TV, leather armchair, bar stools); the west half
// is a workspace (height-adjustable desks, white slotted-back chairs, a lavender end wall with sticky-note grid and
// portrait posters). The long walls read as frosted whiteboard glass with grey mullions.
import type { Shape } from '../../render/shapes.ts';
import { box, cylinder, place, sphere, torus } from '../../render/shapes.ts';

export type MaterialSpec = {
    colour: [number, number, number];
    gloss?: number;
    metalness?: number;
    emissive?: [number, number, number];
    emissiveIntensity?: number;
    opacity?: number;
};

export type ScenePart = { material: string; shape: Shape };
/** Footprint collider: box with its base on the floor, `w` along the yaw direction, `d` across it. */
export type SceneCollider = { x: number; z: number; w: number; d: number; h: number; yaw: number };
export type AuthoredRoomScene = {
    room: string;
    materials: Record<string, MaterialSpec>;
    parts: ScenePart[];
    colliders: SceneCollider[];
    /** Light-pool fixtures `[x, z, height, kind]` (the pooled omni light sits 0.35 m below `height`). */
    lights: [number, number, number, number][];
    /** Source room floor patches to hide (this scene lays its own floor). */
    hideFloorOf: string[];
};

/** Inner wall faces of M104 in the presented model (probed from the source walls). */
export const M104_BOUNDS = { west: -52.04, east: -41.41, north: 41.16, south: 46.54 } as const;
/** Full-height openings in the north wall (source), each hinged on the central pier. */
export const M104_DOORS = [
    { from: -47.77, to: -46.89, hinge: -46.89 },
    { from: -45.76, to: -44.89, hinge: -45.76 }
] as const;
const PARTITION_X = -46.35;
const CEILING_Y = 3.58;

const MATERIALS: Record<string, MaterialSpec> = {
    floor: { colour: [0.74, 0.6, 0.45], gloss: 0.45 },
    floorSeam: { colour: [0.52, 0.4, 0.29], gloss: 0.3 },
    lavender: { colour: [0.73, 0.69, 0.83], gloss: 0.08 },
    lavenderGrey: { colour: [0.7, 0.69, 0.76], gloss: 0.08 },
    skirting: { colour: [0.86, 0.86, 0.85], gloss: 0.3 },
    frosted: { colour: [0.9, 0.92, 0.93], gloss: 0.7 },
    clearGlass: { colour: [0.42, 0.47, 0.5], gloss: 0.85 },
    mullion: { colour: [0.56, 0.58, 0.6], gloss: 0.55, metalness: 0.4 },
    marker: { colour: [0.13, 0.17, 0.3], gloss: 0.2 },
    markerRed: { colour: [0.62, 0.16, 0.14], gloss: 0.2 },
    ceiling: { colour: [0.93, 0.93, 0.92], gloss: 0.05 },
    tbar: { colour: [0.97, 0.97, 0.96], gloss: 0.4 },
    vent: { colour: [0.8, 0.81, 0.82], gloss: 0.3 },
    ventSlot: { colour: [0.3, 0.31, 0.33], gloss: 0.1 },
    chrome: { colour: [0.78, 0.79, 0.8], gloss: 0.8, metalness: 0.8 },
    aluminium: { colour: [0.72, 0.73, 0.75], gloss: 0.6, metalness: 0.6 },
    led: { colour: [1, 1, 1], emissive: [1, 0.97, 0.9], emissiveIntensity: 4 },
    cable: { colour: [0.15, 0.15, 0.16] },
    oak: { colour: [0.8, 0.66, 0.48], gloss: 0.45 },
    oakEdge: { colour: [0.66, 0.52, 0.36], gloss: 0.4 },
    whiteMetal: { colour: [0.93, 0.93, 0.92], gloss: 0.5, metalness: 0.2 },
    whitePlastic: { colour: [0.95, 0.95, 0.94], gloss: 0.35 },
    greyMetal: { colour: [0.5, 0.51, 0.53], gloss: 0.5, metalness: 0.5 },
    darkMetal: { colour: [0.13, 0.13, 0.14], gloss: 0.5, metalness: 0.3 },
    blackPlastic: { colour: [0.06, 0.06, 0.07], gloss: 0.45 },
    screen: { colour: [0.02, 0.025, 0.03], gloss: 0.92 },
    bookcase: { colour: [0.94, 0.94, 0.92], gloss: 0.25 },
    glass: { colour: [0.75, 0.82, 0.85], gloss: 0.9, opacity: 0.28 },
    olive: { colour: [0.42, 0.44, 0.24], gloss: 0.08 },
    oliveDark: { colour: [0.32, 0.34, 0.18], gloss: 0.08 },
    beanBlue: { colour: [0.22, 0.38, 0.62], gloss: 0.25 },
    beanGrey: { colour: [0.56, 0.57, 0.58], gloss: 0.15 },
    leather: { colour: [0.4, 0.23, 0.13], gloss: 0.55 },
    darkWood: { colour: [0.22, 0.14, 0.09], gloss: 0.4 },
    stoolGrey: { colour: [0.42, 0.43, 0.45], gloss: 0.3 },
    jacket: { colour: [0.07, 0.07, 0.08], gloss: 0.15 },
    potGrey: { colour: [0.26, 0.27, 0.28], gloss: 0.35 },
    soil: { colour: [0.18, 0.13, 0.09] },
    leaf: { colour: [0.2, 0.4, 0.17], gloss: 0.3 },
    leafDark: { colour: [0.13, 0.29, 0.12], gloss: 0.3 },
    stem: { colour: [0.33, 0.27, 0.16] },
    wigBlonde: { colour: [0.86, 0.72, 0.43], gloss: 0.3 },
    wigBlack: { colour: [0.05, 0.04, 0.04], gloss: 0.3 },
    red: { colour: [0.72, 0.08, 0.07], gloss: 0.45 },
    paper: { colour: [0.96, 0.96, 0.94], gloss: 0.1 },
    kraft: { colour: [0.66, 0.5, 0.32], gloss: 0.1 },
    noteOrange: { colour: [0.98, 0.55, 0.18], gloss: 0.1 },
    noteGreen: { colour: [0.55, 0.85, 0.35], gloss: 0.1 },
    noteBlue: { colour: [0.35, 0.68, 0.92], gloss: 0.1 },
    noteYellow: { colour: [0.98, 0.88, 0.3], gloss: 0.1 },
    posterDark: { colour: [0.1, 0.11, 0.14], gloss: 0.3 },
    posterInk: { colour: [0.85, 0.82, 0.7], gloss: 0.2 },
    posterRed: { colour: [0.78, 0.13, 0.13], gloss: 0.2 },
    portraitA: { colour: [0.62, 0.52, 0.46], gloss: 0.2 },
    portraitB: { colour: [0.35, 0.38, 0.44], gloss: 0.2 },
    portraitC: { colour: [0.72, 0.66, 0.58], gloss: 0.2 },
    backpack: { colour: [0.72, 0.78, 0.18], gloss: 0.2 },
    backpackDark: { colour: [0.2, 0.22, 0.2], gloss: 0.2 },
    partition: { colour: [0.62, 0.63, 0.64], gloss: 0.15 },
    doorLeaf: { colour: [0.84, 0.72, 0.56], gloss: 0.4 },
    clockFace: { colour: [0.97, 0.97, 0.96], gloss: 0.5 },
    bookRed: { colour: [0.62, 0.17, 0.15], gloss: 0.3 },
    bookBlue: { colour: [0.18, 0.3, 0.52], gloss: 0.3 },
    bookGreen: { colour: [0.22, 0.42, 0.3], gloss: 0.3 },
    bookCream: { colour: [0.88, 0.84, 0.74], gloss: 0.3 },
    bookBlack: { colour: [0.1, 0.1, 0.11], gloss: 0.3 },
    bookOrange: { colour: [0.88, 0.5, 0.16], gloss: 0.3 },
    bottleBlue: { colour: [0.3, 0.55, 0.8], gloss: 0.8 },
    bottleSteel: { colour: [0.7, 0.72, 0.74], gloss: 0.8, metalness: 0.7 },
    mugWhite: { colour: [0.95, 0.95, 0.93], gloss: 0.7 },
    figurine: { colour: [0.85, 0.35, 0.3], gloss: 0.5 },
    rgbRed: { colour: [1, 1, 1], emissive: [1, 0.1, 0.25], emissiveIntensity: 2 },
    rgbGreen: { colour: [1, 1, 1], emissive: [0.1, 1, 0.35], emissiveIntensity: 2 },
    rgbBlue: { colour: [1, 1, 1], emissive: [0.2, 0.35, 1], emissiveIntensity: 2 },
    rgbViolet: { colour: [1, 1, 1], emissive: [0.75, 0.2, 1], emissiveIntensity: 2 }
};

const BOOK_COLOURS = ['bookRed', 'bookBlue', 'bookGreen', 'bookCream', 'bookBlack', 'bookOrange', 'paper', 'kraft'];

/** Deterministic PRNG (mulberry32) so the scene is identical on every load and in tests. */
const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Local frame: `u` along +X rotated by yaw, `v` forward (+Z rotated by yaw), so a frame "faces" +v. */
type Frame = { x: number; z: number; yaw: number };
/** Yaw that turns local +v toward the world direction (dx, dz). */
const facing = (dx: number, dz: number) => Math.atan2(-dx, dz);
const frame = (x: number, z: number, yaw = 0): Frame => ({ x, z, yaw });

class SceneBuilder {
    parts: ScenePart[] = [];
    colliders: SceneCollider[] = [];

    world(f: Frame, u: number, v: number): [number, number] {
        const c = Math.cos(f.yaw);
        const s = Math.sin(f.yaw);
        return [f.x + u * c - v * s, f.z + u * s + v * c];
    }

    /** Places a shape centred at local (u, y, v) with optional extra rotations and scale. */
    put(
        material: string,
        shape: Shape,
        f: Frame,
        u: number,
        y: number,
        v: number,
        o: { yaw?: number; pitch?: number; roll?: number; sx?: number; sy?: number; sz?: number } = {}
    ) {
        if (!MATERIALS[material]) throw new Error(`M104 scene: unknown material ${material}`);
        const [x, z] = this.world(f, u, v);
        this.parts.push({ material, shape: place(shape, { ...o, x, y, z, yaw: f.yaw + (o.yaw ?? 0) }) });
    }

    /** Box with its base at y0: `w` along u, `h` up, `d` along v. */
    cube(material: string, f: Frame, u: number, y0: number, v: number, w: number, h: number, d: number, yaw = 0) {
        this.put(material, box(w, h, d), f, u, y0 + h / 2, v, { yaw });
    }

    /** Vertical cylinder with its base at y0. */
    post(material: string, f: Frame, u: number, y0: number, v: number, r: number, h: number, segments = 14) {
        this.put(material, cylinder(r, h, segments), f, u, y0 + h / 2, v);
    }

    solid(f: Frame, u: number, v: number, w: number, d: number, h: number, yaw = 0) {
        const [x, z] = this.world(f, u, v);
        this.colliders.push({ x, z, w, d, h, yaw: f.yaw + yaw });
    }
}

// ---------- furniture ----------

/** Height-adjustable desk: light-oak top on a white T-leg frame. */
const desk = (s: SceneBuilder, f: Frame, w = 1.4, d = 0.7, h = 0.75) => {
    s.cube('oak', f, 0, h - 0.025, 0, w, 0.025, d);
    s.cube('oakEdge', f, 0, h - 0.028, 0, w - 0.01, 0.003, d - 0.01);
    for (const side of [-1, 1]) {
        const u = side * (w / 2 - 0.12);
        s.cube('whiteMetal', f, u, 0, 0, 0.06, 0.03, d - 0.06); // foot
        s.cube('whiteMetal', f, u, 0.03, 0, 0.075, 0.38, 0.05); // lower column
        s.cube('whiteMetal', f, u, 0.41, 0, 0.06, h - 0.46, 0.042); // upper column
        s.cube('whiteMetal', f, u, h - 0.055, 0, 0.05, 0.03, d - 0.12); // top bracket
    }
    s.cube('whiteMetal', f, 0, h - 0.07, -0.05, w - 0.3, 0.04, 0.03); // crossbar
    s.cube('blackPlastic', f, w / 2 - 0.2, h - 0.06, d / 2 - 0.04, 0.09, 0.02, 0.05); // height controller
    s.solid(f, 0, 0, w, d, h);
};

/** White plastic chair with a slotted back; faces +v (the sitter looks along +v). */
const chair = (s: SceneBuilder, f: Frame) => {
    s.cube('whitePlastic', f, 0, 0.44, 0, 0.44, 0.025, 0.42);
    for (let i = 0; i < 4; i++) {
        s.put('whitePlastic', box(0.42, 0.05, 0.018), f, 0, 0.56 + i * 0.085, -0.22 - i * 0.012, { roll: -0.12 });
    }
    for (const side of [-1, 1]) {
        s.put('whitePlastic', box(0.03, 0.42, 0.025), f, side * 0.205, 0.67, -0.225, { roll: -0.12 });
        for (const back of [-1, 1]) {
            s.put('whitePlastic', cylinder(0.013, 0.44, 8), f, side * 0.19, 0.22, back * 0.18, {
                roll: back * -0.05,
                pitch: side * 0.04
            });
        }
    }
};

/** Billy-style white bookcase (0.8 × 0.28 × 2.02 m) facing +v, filled with books and boxes. */
const bookcase = (s: SceneBuilder, f: Frame, rng: () => number, variant: 'open' | 'doors' | 'glass') => {
    const w = 0.8;
    const d = 0.28;
    const h = 2.02;
    const t = 0.018;
    for (const side of [-1, 1]) s.cube('bookcase', f, side * (w / 2 - t / 2), 0, 0, t, h, d);
    s.cube('bookcase', f, 0, h - t, 0, w - 2 * t, t, d);
    s.cube('bookcase', f, 0, 0, d / 2 - 0.03, w - 2 * t, 0.06, 0.018); // plinth
    s.cube('bookcase', f, 0, 0, -d / 2 + 0.003, w, h, 0.006); // back
    const shelves = [0.06, 0.4, 0.76, 1.12, 1.48, 1.84];
    for (const y of shelves) s.cube('bookcase', f, 0, y, 0.005, w - 2 * t, t, d - 0.02);
    const cabinet = variant === 'doors' ? 0.76 : 0;
    if (variant === 'doors') {
        for (const side of [-1, 1]) {
            s.cube('bookcase', f, side * 0.1975, 0.065, d / 2 + 0.009, 0.39, 0.69, 0.018);
            s.post('chrome', f, side * 0.04, 0.6, d / 2 + 0.03, 0.008, 0.03, 8);
        }
    }
    if (variant === 'glass') {
        for (const side of [-1, 1]) {
            const u = side * 0.1975;
            s.cube('bookcase', f, u, 0.76, d / 2 + 0.009, 0.39, 0.035, 0.02);
            s.cube('bookcase', f, u, 1.965, d / 2 + 0.009, 0.39, 0.035, 0.02);
            for (const edge of [-1, 1]) s.cube('bookcase', f, u + edge * 0.18, 0.76, d / 2 + 0.009, 0.03, 1.24, 0.02);
            s.cube('glass', f, u, 0.795, d / 2 + 0.009, 0.33, 1.17, 0.006);
            s.post('chrome', f, u - side * 0.15, 1.3, d / 2 + 0.03, 0.007, 0.08, 8);
        }
    }
    // Contents of each open bay.
    for (let i = 0; i < shelves.length; i++) {
        const base = shelves[i] + t;
        const top = (shelves[i + 1] ?? h - t) - 0.02;
        if (base < cabinet || top - base < 0.15) continue;
        let u = -w / 2 + t + 0.01;
        const end = w / 2 - t - 0.01;
        while (u < end - 0.03) {
            const roll = rng();
            if (roll < 0.12) {
                // storage box
                const bw = Math.min(0.24, end - u);
                if (bw < 0.12) break;
                const bh = Math.min(top - base - 0.02, 0.18 + rng() * 0.08);
                s.cube(rng() < 0.5 ? 'kraft' : 'paper', f, u + bw / 2, base, 0.0, bw, bh, 0.22);
                u += bw + 0.01;
            } else if (roll < 0.2) {
                u += 0.04 + rng() * 0.08; // gap
            } else if (roll < 0.27) {
                // lying stack
                const bw = Math.min(0.2, end - u);
                if (bw < 0.12) break;
                let y = base;
                for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
                    const bh = 0.025 + rng() * 0.02;
                    s.cube(
                        BOOK_COLOURS[Math.floor(rng() * BOOK_COLOURS.length)],
                        f,
                        u + bw / 2,
                        y,
                        0.02,
                        bw - rng() * 0.03,
                        bh,
                        0.15 + rng() * 0.05
                    );
                    y += bh;
                }
                u += bw + 0.01;
            } else {
                const bw = 0.018 + rng() * 0.035;
                const bh = Math.min(top - base - 0.01, 0.17 + rng() * 0.12);
                const bd = 0.14 + rng() * 0.08;
                const lean = rng() < 0.08 ? 0.12 : 0;
                s.put(
                    BOOK_COLOURS[Math.floor(rng() * BOOK_COLOURS.length)],
                    box(bw, bh, bd),
                    f,
                    u + bw / 2,
                    base + bh / 2,
                    d / 2 - 0.02 - bd / 2,
                    {
                        pitch: lean
                    }
                );
                u += bw + 0.002;
            }
        }
    }
    s.solid(f, 0, 0, w, d, h);
};

/** Olive floor sofa with rolled edges (1.3 × 1.0 m), facing +v. */
const floorSofa = (s: SceneBuilder, f: Frame) => {
    s.cube('oliveDark', f, 0, 0, 0, 1.3, 0.2, 1.0);
    s.put('olive', box(1.16, 0.13, 0.74), f, 0, 0.265, 0.1, { sx: 1, sy: 1, sz: 1 });
    s.put('olive', sphere(16, 8), f, 0, 0.33, 0.1, { sx: 0.58, sy: 0.035, sz: 0.37 }); // cushion crown
    s.put('olive', box(1.16, 0.36, 0.2), f, 0, 0.4, -0.38, { roll: -0.18 });
    s.put('olive', cylinder(0.09, 1.2, 16), f, 0, 0.59, -0.43, { pitch: Math.PI / 2 });
    s.put('olive', cylinder(0.075, 1.2, 16), f, 0, 0.2, 0.46, { pitch: Math.PI / 2 });
    for (const side of [-1, 1]) {
        s.put('olive', cylinder(0.1, 0.92, 16), f, side * 0.6, 0.3, 0, { roll: Math.PI / 2 });
    }
    s.solid(f, 0, 0, 1.3, 1.0, 0.45);
};

const beanbag = (s: SceneBuilder, f: Frame, material: string, size = 1) => {
    s.put(material, sphere(18, 10), f, 0, 0.27 * size, 0, { sx: 0.42 * size, sy: 0.27 * size, sz: 0.4 * size });
    s.put(material, sphere(14, 8), f, 0.02, 0.48 * size, -0.12 * size, {
        sx: 0.3 * size,
        sy: 0.16 * size,
        sz: 0.24 * size
    });
};

/** Brown leather armchair facing +v. */
const armchair = (s: SceneBuilder, f: Frame) => {
    for (const [u, v] of [
        [-0.33, -0.32],
        [0.33, -0.32],
        [-0.33, 0.32],
        [0.33, 0.32]
    ])
        s.put('darkWood', cylinder(0.022, 0.12, 8, true, 0.016), f, u, 0.06, v, {});
    s.cube('leather', f, 0, 0.12, 0, 0.82, 0.22, 0.8);
    s.put('leather', box(0.56, 0.12, 0.6), f, 0, 0.4, 0.06, {});
    s.put('leather', box(0.8, 0.5, 0.18), f, 0, 0.62, -0.32, { roll: -0.12 });
    for (const side of [-1, 1]) {
        s.cube('leather', f, side * 0.33, 0.34, 0.02, 0.16, 0.26, 0.76);
        s.put('leather', cylinder(0.08, 0.76, 14), f, side * 0.33, 0.6, 0.02, { roll: Math.PI / 2 });
    }
    s.solid(f, 0, 0, 0.82, 0.8, 0.7);
};

/** 86" TV on a silver mobile stand, screen facing +v, with two wigs draped over the top corners. */
const mobileTv = (s: SceneBuilder, f: Frame) => {
    const sw = 1.92;
    const sh = 1.1;
    const y0 = 0.88;
    s.cube('blackPlastic', f, 0, y0, 0, sw, sh, 0.06);
    s.cube('screen', f, 0, y0 + 0.015, 0.031, sw - 0.03, sh - 0.03, 0.003);
    for (const side of [-1, 1]) {
        s.cube('chrome', f, side * 0.4, 0.09, -0.08, 0.07, 1.75, 0.045);
        s.cube('chrome', f, side * 0.4, 0.05, -0.05, 0.08, 0.05, 0.72); // foot
        for (const end of [-1, 1]) {
            s.put('blackPlastic', cylinder(0.035, 0.03, 12), f, side * 0.4, 0.035, -0.05 + end * 0.33, {
                roll: Math.PI / 2
            });
            s.cube('chrome', f, side * 0.4, 0.05, -0.05 + end * 0.33, 0.03, 0.02, 0.03);
        }
    }
    s.cube('chrome', f, 0, 1.1, -0.07, 0.95, 0.06, 0.03); // mounting rails
    s.cube('chrome', f, 0, 1.65, -0.07, 0.95, 0.06, 0.03);
    s.cube('chrome', f, 0, 0.3, -0.08, 0.85, 0.05, 0.05); // lower brace
    s.cube('blackPlastic', f, 0, 0.78, 0.0, 1.0, 0.07, 0.09); // soundbar
    s.cube('chrome', f, 0, 0.72, 0.0, 0.5, 0.02, 0.2); // shelf
    // Wigs: a mass on the corner and strands hanging over the front.
    for (const [side, material] of [
        [-1, 'wigBlonde'],
        [1, 'wigBlack']
    ] as const) {
        const u = side * (sw / 2 - 0.08);
        s.put(material, sphere(14, 8), f, u, y0 + sh + 0.02, 0, { sx: 0.13, sy: 0.07, sz: 0.09 });
        for (let k = 0; k < 5; k++) {
            const du = (k - 2) * 0.035;
            const length = 0.18 + (k % 3) * 0.07;
            s.put(material, box(0.03, length, 0.012), f, u + du, y0 + sh - length / 2 + 0.02, 0.04, {
                pitch: du * 0.8
            });
        }
    }
    s.solid(f, 0, -0.05, 1.0, 0.75, 1.9);
};

const barStool = (s: SceneBuilder, f: Frame) => {
    s.post('stoolGrey', f, 0, 0.72, 0, 0.18, 0.05, 20);
    s.post('greyMetal', f, 0, 0.03, 0, 0.028, 0.69);
    s.put('greyMetal', torus(0.17, 0.011, 24, 6), f, 0, 0.3, 0);
    for (let k = 0; k < 4; k++) s.put('greyMetal', box(0.34, 0.01, 0.012), f, 0, 0.3, 0, { yaw: (k * Math.PI) / 4 });
    s.post('greyMetal', f, 0, 0, 0, 0.21, 0.03, 20);
};

const coatTree = (s: SceneBuilder, f: Frame) => {
    s.post('whiteMetal', f, 0, 0, 0, 0.2, 0.025, 20);
    s.post('whiteMetal', f, 0, 0.025, 0, 0.018, 1.72);
    for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.4;
        s.put('whiteMetal', cylinder(0.008, 0.16, 8), f, Math.cos(a) * 0.06, 1.66, Math.sin(a) * 0.06, {
            yaw: -a,
            pitch: -1.0
        });
    }
    s.put('jacket', sphere(14, 8), f, 0.12, 1.55, 0, { sx: 0.17, sy: 0.08, sz: 0.12 }); // shoulders
    s.put('jacket', box(0.42, 0.72, 0.16), f, 0.12, 1.18, 0, { pitch: 0.04 });
    for (const side of [-1, 1])
        s.put('jacket', box(0.08, 0.6, 0.1), f, 0.12 + side * 0.23, 1.2, 0.02, { pitch: side * 0.05 });
};

/** Potted plant with broad leaves; `height` is the foliage top. */
const plant = (s: SceneBuilder, f: Frame, rng: () => number, height = 1.5, pot = 0.22) => {
    s.put('potGrey', cylinder(pot * 0.82, pot * 1.9, 20, true, pot), f, 0, pot * 0.95, 0);
    s.post('soil', f, 0, pot * 1.9 - 0.04, 0, pot * 0.95, 0.03, 20);
    const stems = 3;
    for (let k = 0; k < stems; k++) {
        const a = (k / stems) * Math.PI * 2 + rng();
        const lean = 0.08 + rng() * 0.12;
        const stemHeight = height - pot * 1.9 - 0.1 - rng() * 0.3;
        const su = Math.cos(a) * 0.04;
        const sv = Math.sin(a) * 0.04;
        s.put(
            'stem',
            cylinder(0.014, stemHeight, 6),
            f,
            su + Math.cos(a) * lean * stemHeight * 0.5,
            pot * 1.9 + stemHeight / 2,
            sv + Math.sin(a) * lean * stemHeight * 0.5,
            {
                yaw: -a,
                pitch: -lean
            }
        );
    }
    const leaves = Math.round(height * 16);
    for (let k = 0; k < leaves; k++) {
        const t = k / leaves;
        const a = k * 2.4 + rng() * 0.5;
        const r = 0.12 + (1 - Math.abs(t - 0.55)) * 0.22 + rng() * 0.06;
        const y = pot * 1.9 + 0.15 + t * (height - pot * 1.9 - 0.2);
        const length = 0.16 + rng() * 0.1;
        s.put(rng() < 0.5 ? 'leaf' : 'leafDark', sphere(10, 6), f, Math.cos(a) * r, y, Math.sin(a) * r, {
            yaw: -a,
            pitch: -0.35 - rng() * 0.4,
            sx: length,
            sy: 0.012,
            sz: length * 0.42
        });
    }
    s.solid(f, 0, 0, pot * 2, pot * 2, 0.9);
};

const monitor = (s: SceneBuilder, f: Frame, y: number, width = 0.72, height = 0.42) => {
    s.cube('blackPlastic', f, 0, y, 0, 0.24, 0.012, 0.18);
    s.cube('blackPlastic', f, 0, y, -0.06, 0.05, 0.28, 0.025);
    s.cube('blackPlastic', f, 0, y + 0.12, -0.03, width, height, 0.03);
    s.cube('screen', f, 0, y + 0.135, -0.014, width - 0.02, height - 0.03, 0.002);
};

const laptop = (s: SceneBuilder, f: Frame, y: number) => {
    s.cube('aluminium', f, 0, y, 0, 0.32, 0.014, 0.22);
    s.cube('darkMetal', f, 0, y + 0.014, 0.03, 0.27, 0.001, 0.1);
    s.put('aluminium', box(0.32, 0.21, 0.006), f, 0, y + 0.1, -0.13, { roll: 0.25 });
    s.put('screen', box(0.29, 0.18, 0.002), f, 0, y + 0.1, -0.126, { roll: 0.25 });
};

const rgbKeyboard = (s: SceneBuilder, f: Frame, y: number) => {
    s.cube('blackPlastic', f, 0, y, 0, 0.44, 0.028, 0.14);
    const colours = ['rgbRed', 'rgbViolet', 'rgbBlue', 'rgbGreen'];
    for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) {
            s.cube(colours[(k + row) % 4], f, -0.15 + k * 0.1, y + 0.028, -0.045 + row * 0.03, 0.09, 0.003, 0.022);
        }
    }
};

const mug = (s: SceneBuilder, f: Frame, u: number, y: number, v: number, material = 'mugWhite') => {
    s.put(material, cylinder(0.04, 0.095, 14), f, u, y + 0.0475, v);
    s.put(material, torus(0.028, 0.007, 12, 6), f, u + 0.045, y + 0.05, v, { roll: Math.PI / 2 });
};

const bottle = (s: SceneBuilder, f: Frame, u: number, y: number, v: number, material: string) => {
    s.put(material, cylinder(0.035, 0.2, 14), f, u, y + 0.1, v);
    s.put('blackPlastic', cylinder(0.022, 0.03, 10), f, u, y + 0.215, v);
};

const papers = (s: SceneBuilder, f: Frame, rng: () => number, u: number, y: number, v: number, sheets = 3) => {
    for (let k = 0; k < sheets; k++)
        s.put('paper', box(0.21, 0.002, 0.297), f, u + rng() * 0.04, y + 0.001 + k * 0.002, v + rng() * 0.04, {
            yaw: rng() * 0.6 - 0.3
        });
};

const bookStack = (s: SceneBuilder, f: Frame, rng: () => number, u: number, y: number, v: number, count = 3) => {
    let top = y;
    for (let k = 0; k < count; k++) {
        const h = 0.02 + rng() * 0.025;
        s.put(
            BOOK_COLOURS[Math.floor(rng() * 6)],
            box(0.17 + rng() * 0.06, h, 0.23 + rng() * 0.04),
            f,
            u,
            top + h / 2,
            v,
            { yaw: rng() * 0.4 - 0.2 }
        );
        top += h;
    }
};

const backpack = (s: SceneBuilder, f: Frame) => {
    s.put('backpack', box(0.3, 0.4, 0.16), f, 0, 0.22, 0, { roll: -0.1 });
    s.put('backpack', sphere(12, 8), f, 0, 0.42, -0.02, { sx: 0.15, sy: 0.06, sz: 0.08 });
    s.put('backpackDark', box(0.24, 0.18, 0.05), f, 0, 0.16, 0.1, { roll: -0.1 });
    for (const side of [-1, 1])
        s.put('backpackDark', box(0.035, 0.36, 0.02), f, side * 0.09, 0.24, -0.095, { roll: -0.1 });
};

const trashBin = (s: SceneBuilder, f: Frame) => {
    s.put('potGrey', cylinder(0.14, 0.4, 18, false, 0.16), f, 0, 0.2, 0);
    s.post('potGrey', f, 0, 0, 0, 0.14, 0.01, 18);
    s.put('blackPlastic', torus(0.16, 0.012, 20, 6), f, 0, 0.4, 0);
    s.solid(f, 0, 0, 0.32, 0.32, 0.4);
};

// ---------- room shell overlays ----------

/** Thin wall-mounted panel: `u` along the wall, centred at height `y`, standing `off` metres off the face. */
const wallPanel = (
    s: SceneBuilder,
    f: Frame,
    material: string,
    u: number,
    y: number,
    w: number,
    h: number,
    off = 0.004,
    depth = 0.004
) => s.cube(material, f, u, y - h / 2, off + depth / 2, w, h, depth);

/**
 * Long wall dressed as frosted whiteboard glass: frosted panels to 2.4 m, a darker clear band above, grey mullions,
 * an aluminium base, marker scribbles and sticky notes. `f` sits on the wall face looking into the room;
 * `spans` are [from, to] in the frame's u.
 */
const glassWall = (s: SceneBuilder, f: Frame, spans: [number, number][], rng: () => number) => {
    for (const [from, to] of spans) {
        const width = to - from;
        const mid = (from + to) / 2;
        s.cube('frosted', f, mid, 0.1, 0.006, width, 2.3, 0.006);
        s.cube('clearGlass', f, mid, 2.45, 0.006, width, CEILING_Y - 2.45, 0.006);
        s.cube('aluminium', f, mid, 0, 0.012, width, 0.1, 0.018);
        s.cube('mullion', f, mid, 2.4, 0.015, width, 0.05, 0.024);
        s.cube('mullion', f, mid, CEILING_Y - 0.05, 0.015, width, 0.05, 0.024);
        const bays = Math.max(1, Math.round(width / 1.25));
        for (let k = 0; k <= bays; k++)
            s.cube('mullion', f, from + (k * width) / bays, 0.1, 0.015, 0.05, CEILING_Y - 0.1, 0.024);
        // Marker scribbles and sticky notes on some bays.
        for (let k = 0; k < bays; k++) {
            const bayMid = from + ((k + 0.5) * width) / bays;
            const roll = rng();
            if (roll < 0.55) {
                for (let line = 0; line < 3 + Math.floor(rng() * 5); line++) {
                    const length = 0.15 + rng() * 0.6;
                    s.put(
                        rng() < 0.85 ? 'marker' : 'markerRed',
                        box(length, 0.008, 0.002),
                        f,
                        bayMid - 0.3 + rng() * 0.5,
                        1.2 + rng() * 0.9,
                        0.011,
                        {
                            pitch: rng() * 0.3 - 0.15
                        }
                    );
                }
            }
            if (roll > 0.35) {
                const notes = ['noteYellow', 'noteOrange', 'noteGreen', 'noteBlue'];
                for (let n = 0; n < 2 + Math.floor(rng() * 6); n++) {
                    wallPanel(
                        s,
                        f,
                        notes[Math.floor(rng() * notes.length)],
                        bayMid - 0.35 + rng() * 0.7,
                        1.15 + rng() * 0.8,
                        0.076,
                        0.076,
                        0.01,
                        0.002
                    );
                }
            }
        }
    }
};

/** Painted end wall with skirting; `width` along u centred on the frame. */
const paintedWall = (s: SceneBuilder, f: Frame, width: number, material: string) => {
    s.cube(material, f, 0, 0, 0.003, width, CEILING_Y, 0.004);
    s.cube('skirting', f, 0, 0, 0.012, width, 0.08, 0.014);
};

// ---------- scene ----------

export const m104Scene = (): AuthoredRoomScene => {
    const s = new SceneBuilder();
    const rng = random(104);
    const { west: W, east: E, north: N, south: S } = M104_BOUNDS;
    const midX = (W + E) / 2;
    const midZ = (N + S) / 2;

    // Floor: light-oak planks running east–west with seams and staggered butt joints.
    const floorY = 0.024;
    s.cube('floor', frame(midX, midZ), 0, floorY - 0.006, 0, E - W, 0.006, S - N);
    for (let z = N + 0.19; z < S - 0.02; z += 0.19) {
        s.cube('floorSeam', frame(midX, z), 0, floorY, 0, E - W, 0.0008, 0.005);
    }
    for (let z = N; z < S - 0.05; z += 0.19) {
        const row = Math.min(0.19, S - z);
        let x = W + rng() * 1.4;
        while (x < E - 0.1) {
            s.cube('floorSeam', frame(x, z + row / 2), 0, floorY, 0, 0.005, 0.0008, row);
            x += 1.2 + rng() * 0.6;
        }
    }

    // Ceiling: plain plane below the global ceiling, T-bar grid, vents, sprinklers, track for the partition.
    s.cube('ceiling', frame(midX, midZ), 0, CEILING_Y, 0, E - W, 0.012, S - N);
    for (let x = W + 0.6; x < E; x += 0.6) s.cube('tbar', frame(x, midZ), 0, CEILING_Y - 0.008, 0, 0.024, 0.008, S - N);
    for (let z = N + 0.6; z < S; z += 0.6) s.cube('tbar', frame(midX, z), 0, CEILING_Y - 0.008, 0, E - W, 0.008, 0.024);
    for (const [x, z] of [
        [W + 1.5, N + 1.5],
        [W + 3.9, S - 1.5],
        [E - 1.2, N + 1.5],
        [E - 3.0, S - 1.5]
    ]) {
        const f = frame(x, z);
        s.cube('vent', f, 0, CEILING_Y - 0.03, 0, 0.58, 0.03, 0.58);
        for (let k = -2; k <= 2; k++) s.cube('ventSlot', f, k * 0.09, CEILING_Y - 0.032, 0, 0.03, 0.003, 0.44);
    }
    for (const [x, z] of [
        [W + 2.4, midZ - 1.2],
        [W + 2.4, midZ + 1.2],
        [midX - 1.2, midZ],
        [E - 2.4, midZ - 1.2],
        [E - 2.4, midZ + 1.2]
    ]) {
        s.post('chrome', frame(x, z), 0, CEILING_Y - 0.06, 0, 0.008, 0.06, 8);
        s.post('chrome', frame(x, z), 0, CEILING_Y - 0.065, 0, 0.03, 0.006, 12);
    }
    s.cube('aluminium', frame(PARTITION_X, midZ), 0, CEILING_Y - 0.05, 0, 0.1, 0.05, S - N);

    // Linear LED pendant bars (two rows per half) on thin cables.
    const bars: [number, number][] = [];
    for (const x of [W + 1.4, W + 4.0, E - 3.6, E - 1.4]) for (const z of [N + 1.35, S - 1.35]) bars.push([x, z]);
    for (const [x, z] of bars) {
        const f = frame(x, z);
        s.cube('aluminium', f, 0, 2.95, 0, 1.5, 0.06, 0.07);
        s.cube('led', f, 0, 2.945, 0, 1.47, 0.006, 0.05);
        for (const end of [-1, 1]) s.post('cable', f, end * 0.6, 3.01, 0, 0.0035, CEILING_Y - 3.01, 6);
    }
    const lights: [number, number, number, number][] = [W + 1.4, W + 4.0, E - 3.6, E - 1.4].map((x) => [
        x,
        midZ,
        3.3,
        0
    ]);

    // Long walls: frosted whiteboard glass, leaving the two north door openings and the pier clear.
    const northWall = frame(midX, N, 0); // faces +z (south, into the room); u = +x
    const [westDoor, eastDoor] = M104_DOORS;
    glassWall(
        s,
        northWall,
        [
            [W + 0.02 - midX, westDoor.from - midX],
            [eastDoor.to - midX, E - 0.02 - midX]
        ],
        rng
    );
    // Pier between the doors: painted, with skirting.
    s.cube(
        'skirting',
        northWall,
        (westDoor.to + eastDoor.from) / 2 - midX,
        0,
        0.004,
        eastDoor.from - westDoor.to,
        CEILING_Y,
        0.006
    );
    const southWall = frame(midX, S, Math.PI); // faces -z (north); u = -x
    const column = { from: -49.81, to: -48.89, face: 46.04 };
    glassWall(
        s,
        southWall,
        [
            [midX - (E - 0.02), midX - column.to],
            [midX - column.from, midX - (W + 0.02)]
        ],
        rng
    );
    // Structural column in the south wall: painted with skirting.
    const columnFace = frame((column.from + column.to) / 2, column.face, Math.PI);
    paintedWall(s, columnFace, column.to - column.from, 'skirting');
    for (const [x, yaw] of [
        [column.from, Math.PI / 2],
        [column.to, -Math.PI / 2]
    ] as const) {
        paintedWall(s, frame(x, (column.face + S) / 2, yaw), S - column.face, 'skirting');
    }

    // Door openings: frames, lintels (doors are 2.15 m; the source wall gap is full height) and open leaves.
    for (const door of M104_DOORS) {
        const width = door.to - door.from;
        const f = frame((door.from + door.to) / 2, N - 0.2, 0);
        s.cube('skirting', f, 0, 2.15, 0, width, CEILING_Y - 2.15, 0.42);
        s.cube('aluminium', f, 0, 2.1, 0.205, width, 0.05, 0.03);
        for (const side of [-1, 1]) s.cube('aluminium', f, side * (width / 2 - 0.025), 0, 0.205, 0.05, 2.15, 0.03);
        // Leaf opened 90° into the room against the pier side, hinge on the pier.
        const side = door.hinge === door.to ? 1 : -1;
        const leaf = frame(door.hinge + side * 0.025, N + width / 2, Math.PI / 2);
        s.cube('doorLeaf', leaf, 0, 0.01, 0, width - 0.04, 2.12, 0.04);
        s.cube('glass', leaf, -0.05, 1.0, 0.0, 0.18, 0.9, 0.046);
        s.post('chrome', leaf, width / 2 - 0.12, 1.0, side * 0.04, 0.012, 0.3, 8);
        s.solid(leaf, 0, 0, width - 0.04, 0.05, 2.1);
    }

    // Folding partition: panels stacked against the pier, zig-zag folded.
    const stack = frame(PARTITION_X, N, 0);
    const panels = 14;
    for (let k = 0; k < panels; k++) {
        const v = 0.08 + k * 0.11;
        s.put('partition', box(0.3, CEILING_Y - 0.12, 0.025), stack, 0, 0.04 + (CEILING_Y - 0.12) / 2, v, {
            yaw: k % 2 ? 0.35 : -0.35
        });
    }
    s.cube('aluminium', stack, 0, CEILING_Y - 0.09, 0.8, 0.12, 0.04, 1.6);
    s.solid(stack, 0, 0.82, 0.34, 1.64, CEILING_Y - 0.1);

    // ===== East half: lounge / presentation =====
    const eastWall = frame(E, midZ, facing(-1, 0)); // faces west; u runs south
    paintedWall(s, eastWall, S - N, 'lavenderGrey');
    // Clock above the bookcases.
    s.put('clockFace', cylinder(0.16, 0.03, 32), eastWall, 0, 2.6, 0.03, { roll: Math.PI / 2 });
    s.put('blackPlastic', torus(0.16, 0.012, 32, 6), eastWall, 0, 2.6, 0.04, { roll: Math.PI / 2 });
    s.put('blackPlastic', box(0.008, 0.1, 0.004), eastWall, 0.0, 2.64, 0.048, { pitch: 0.5 });
    s.put('blackPlastic', box(0.006, 0.13, 0.004), eastWall, 0.0, 2.6, 0.05, { pitch: -1.9 });
    // Dark posters.
    for (const [u, y, w, h] of [
        [-1.75, 2.45, 0.5, 0.7],
        [1.75, 2.45, 0.5, 0.7],
        [2.3, 1.6, 0.42, 0.6]
    ]) {
        wallPanel(s, eastWall, 'posterDark', u, y, w, h, 0.004, 0.006);
        wallPanel(s, eastWall, 'posterInk', u, y + h * 0.28, w * 0.7, 0.04, 0.011, 0.001);
        wallPanel(s, eastWall, 'posterInk', u, y - h * 0.3, w * 0.5, 0.02, 0.011, 0.001);
    }
    // Four bookcases against the end wall (one with cabinet doors, one with glass doors).
    const variants = ['doors', 'open', 'glass', 'doors'] as const;
    variants.forEach((variant, k) => {
        const z = 42.25 + k * 0.8;
        bookcase(s, frame(E - 0.15, z, facing(-1, 0)), rng, variant);
    });
    // Olive floor sofas in front of the bookcases, facing west.
    for (const z of [43.0, 44.4]) floorSofa(s, frame(E - 0.86, z, facing(-1, 0)));
    beanbag(s, frame(-42.9, 41.8, facing(-1, 0.5)), 'beanGrey', 0.95);
    beanbag(s, frame(-42.9, 45.95, facing(-1, -0.6)), 'beanBlue');
    armchair(s, frame(-44.05, 43.75, facing(1, 0)));
    mobileTv(s, frame(-44.95, 45.3, facing(-1, -0.15)));
    barStool(s, frame(-43.75, 45.15));
    barStool(s, frame(-43.45, 44.55));
    coatTree(s, frame(-41.75, 46.2, facing(-1, -1)));
    plant(s, frame(-41.98, 41.62), rng, 1.7, 0.24);
    plant(s, frame(-46.0, 46.2), rng, 1.3, 0.2);
    trashBin(s, frame(-45.6, 46.3));
    // Small standing desk by the north wall with a white chair.
    desk(s, frame(-43.6, N + 0.32, 0), 0.9, 0.6, 1.02);
    laptop(s, frame(-43.6, N + 0.32, 0), 1.02);
    chair(s, frame(-43.6, N + 0.95, Math.PI));
    // South wall: decorative glass door, "Habits of Mind" posters, fire-extinguisher box with a broom.
    const southEast = frame(-42.45, S, Math.PI);
    s.cube('aluminium', southEast, 0, 0, 0.02, 0.95, 2.15, 0.03);
    s.cube('glass', southEast, 0, 0.05, 0.036, 0.85, 2.05, 0.008);
    s.post('chrome', southEast, -0.36, 0.9, 0.06, 0.012, 0.35, 8);
    for (const [u, y] of [
        [0.95, 1.75],
        [0.95, 1.2],
        [1.38, 1.75],
        [1.38, 1.2]
    ]) {
        wallPanel(s, southEast, 'paper', u, y, 0.4, 0.5, 0.015, 0.003);
        wallPanel(s, southEast, 'posterRed', u, y + 0.17, 0.36, 0.1, 0.019, 0.001);
        wallPanel(s, southEast, 'posterRed', u - 0.08, y - 0.06, 0.18, 0.18, 0.019, 0.001);
    }
    const fireBox = frame(-44.35, S, Math.PI);
    s.cube('red', fireBox, 0, 0.9, 0.1, 0.42, 0.7, 0.18);
    s.cube('paper', fireBox, 0, 1.22, 0.192, 0.3, 0.12, 0.004);
    s.cube('glass', fireBox, 0, 0.98, 0.192, 0.3, 0.2, 0.004);
    s.put('stem', cylinder(0.012, 1.25, 8), fireBox, 0.38, 0.66, 0.1, { roll: 0.12 });
    s.put('blackPlastic', box(0.25, 0.08, 0.06), fireBox, 0.38, 0.06, 0.18, { roll: 0.12 });

    // ===== West half: workspace =====
    const westWall = frame(W, midZ, facing(1, 0));
    paintedWall(s, westWall, S - N, 'lavender');
    // Title strip (lettering abstracted as dark marks) above a 3 × 4 sticky-note grid.
    wallPanel(s, westWall, 'paper', -0.4, 2.55, 1.6, 0.22, 0.008, 0.003);
    for (let k = 0; k < 9; k++) wallPanel(s, westWall, 'posterDark', -1.05 + k * 0.16, 2.55, 0.11, 0.12, 0.012, 0.001);
    const noteColours = ['noteOrange', 'noteGreen', 'noteBlue'];
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
            const u = -1.1 + col * 0.22;
            const y = 2.15 - row * 0.22;
            wallPanel(s, westWall, noteColours[(row + col) % 3], u, y, 0.18, 0.18, 0.008, 0.002);
            for (let k = 0; k < 3; k++) {
                if (rng() < 0.35) continue;
                wallPanel(
                    s,
                    westWall,
                    noteColours[(row + col + 1 + k) % 3],
                    u - 0.05 + k * 0.05,
                    y - 0.03 + rng() * 0.06,
                    0.045,
                    0.045,
                    0.011,
                    0.001
                );
            }
        }
    }
    // Grid of portrait posters.
    const portraits = ['portraitA', 'portraitB', 'portraitC'];
    for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
            const u = 0.55 + col * 0.42;
            const y = 2.3 - row * 0.55;
            wallPanel(s, westWall, 'paper', u, y, 0.34, 0.46, 0.008, 0.003);
            wallPanel(s, westWall, portraits[(row * 4 + col) % 3], u, y + 0.03, 0.28, 0.34, 0.011, 0.001);
            s.put('posterDark', sphere(10, 6), westWall, u, y + 0.08, 0.014, { sx: 0.06, sy: 0.075, sz: 0.003 });
        }
    }
    wallPanel(s, westWall, 'whitePlastic', -1.8, 1.45, 0.09, 0.12, 0.008, 0.025); // thermostat

    // L-shaped pair in the north-west corner: big monitor, laptop and RGB keyboard.
    const deskA = frame(W + 0.37, 42.35, facing(1, 0));
    desk(s, deskA);
    monitor(s, frame(W + 0.2, 42.35, facing(1, 0)), 0.75, 0.8, 0.46);
    rgbKeyboard(s, frame(W + 0.52, 42.35, facing(1, 0)), 0.75);
    mug(s, deskA, -0.5, 0.75, 0.1);
    papers(s, deskA, rng, 0.45, 0.75, 0.05);
    chair(s, frame(W + 1.05, 42.35, facing(-1, 0)));
    const deskB = frame(-50.55, N + 0.37, Math.PI);
    desk(s, deskB);
    laptop(s, frame(-50.4, N + 0.42, 0), 0.75);
    bottle(s, deskB, -0.5, 0.75, 0.15, 'bottleSteel');
    chair(s, frame(-50.55, N + 1.0, Math.PI));
    backpack(s, frame(W + 0.35, 43.35, facing(1, 0.2)));

    // Side desk by the north wall with an "SF" cardboard box.
    const side = frame(-49.4, N + 0.27, Math.PI);
    desk(s, side, 0.9, 0.5, 0.74);
    s.cube('kraft', side, 0.1, 0.74, 0, 0.42, 0.3, 0.32);
    s.cube('posterDark', side, 0.1, 0.92, -0.161, 0.12, 0.08, 0.002);

    // Back-to-back pair.
    for (const [z, yaw] of [
        [43.55, Math.PI],
        [44.25, 0]
    ] as const) {
        const f = frame(-50.6, z, yaw);
        desk(s, f);
        monitor(s, frame(-50.6 + 0.15, z - Math.cos(yaw) * 0.2, yaw), 0.75, 0.6, 0.36);
        bookStack(s, f, rng, -0.45, 0.75, 0.05, 3);
        mug(s, f, 0.5, 0.75, 0.2);
        chair(s, frame(-50.6, z + (yaw === 0 ? 0.62 : -0.62), yaw === 0 ? Math.PI : 0));
    }

    // Cluttered four-desk block.
    for (const x of [-48.55, -47.25]) {
        for (const [z, yaw] of [
            [44.95, Math.PI],
            [45.65, 0]
        ] as const) {
            const f = frame(x, z, yaw);
            desk(s, f, 1.3);
            bookStack(s, f, rng, -0.4 + rng() * 0.2, 0.75, 0.05, 2 + Math.floor(rng() * 4));
            papers(s, f, rng, 0.15, 0.75, 0.1, 2 + Math.floor(rng() * 3));
            bottle(s, f, 0.45, 0.75, -0.15, rng() < 0.5 ? 'bottleBlue' : 'bottleSteel');
            if (rng() < 0.7) mug(s, f, 0.3, 0.75, -0.2, rng() < 0.5 ? 'mugWhite' : 'figurine');
            s.put('figurine', sphere(10, 6), f, -0.1, 0.8, -0.2, { sx: 0.03, sy: 0.05, sz: 0.03 });
            s.post('posterDark', f, -0.1, 0.75, -0.2, 0.025, 0.02, 10);
            if (yaw === 0) laptop(s, frame(x, z + 0.05, Math.PI), 0.75);
        }
        chair(s, frame(x, 44.3, 0));
    }
    backpack(s, frame(-49.5, 45.55, facing(1, 0)));
    plant(s, frame(W + 0.35, S - 0.35), rng, 1.6, 0.22);
    plant(s, frame(-46.85, S - 0.3), rng, 1.1, 0.18);
    // Small succulent on desk A.
    s.put('potGrey', cylinder(0.05, 0.09, 12, true, 0.06), deskA, 0.55, 0.795, -0.2);
    for (let k = 0; k < 7; k++) {
        const a = k * 0.9;
        s.put(
            k % 2 ? 'leaf' : 'leafDark',
            sphere(8, 5),
            deskA,
            0.55 + Math.cos(a) * 0.03,
            0.86,
            -0.2 + Math.sin(a) * 0.03,
            {
                yaw: -a,
                pitch: -0.6,
                sx: 0.05,
                sy: 0.012,
                sz: 0.025
            }
        );
    }

    return {
        room: 'M104',
        materials: MATERIALS,
        parts: s.parts,
        colliders: s.colliders,
        lights,
        hideFloorOf: ['M104']
    };
};
