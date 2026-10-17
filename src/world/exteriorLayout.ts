// Pure layout of the campus exterior (no engine imports): where the owner's 2026-08-06 model puts the south gate,
// the street, the paths and the sculptures, carried into FF-01 metres with the room-naming plan fit.
import { SOUTH_GATE } from '../config/gameplay.ts';
import { ROOM_NAMING } from '../config/roomNaming.ts';

/** The 2026-08-06 model's world → plan pixels (app/campus-data.ts `world`), inverted. */
const MODEL_SCALE = 0.075;
const MODEL_ORIGIN = [863, 718] as const;

/** A point of the 2026-08-06 model (its world x, z) in FF-01 metres. */
export const exteriorFromModel = (x: number, z: number): [number, number] => {
    const px = x / MODEL_SCALE + MODEL_ORIGIN[0],
        py = z / MODEL_SCALE + MODEL_ORIGIN[1];
    const [[a, b], [c, d], [e, f]] = ROOM_NAMING.fit.matrix;
    return [px * a + py * c + e, px * b + py * d + f];
};

const round = (value: number) => Math.round(value * 10) / 10;
const southGate = exteriorFromModel(-8, 47);
const sculpture = (x: number) => exteriorFromModel(x, 37).map(round) as [number, number];

export const EXTERIOR = {
    /** Top of the presented walls (presentation.ts WALL_HEIGHT); façade bands and roof volumes sit on it. */
    wallTop: 3.6,
    groundHalf: 320,
    /** Paved apron round the FF-01 slab [x0, z0, x1, z1]. */
    apron: [-76, -62, 76, 58.2] as const,
    /** East and west entrance paths [x0, z0, x1, z1] (model: ±72, −3.8, 39 × 5 m). */
    paths: [
        [66.5, -9.2, 115, -4.2],
        [-115, -9.2, -66.5, -4.2]
    ] as const,
    gate: {
        /**
         * The model's south gate (fitted to x ≈ −9.9) centred on the real FF-01 entrance opening, the one the
         * turnstiles stand in; the façade's front plane sits on the slab edge (z 57.5), where the plaza starts.
         */
        x: (SOUTH_GATE.x0 + SOUTH_GATE.x1) / 2,
        modelX: round(southGate[0]),
        front: 57.55,
        halfWidth: 19.5,
        opening: SOUTH_GATE.x1 - SOUTH_GATE.x0,
        canopyHeight: 3.3,
        canopyDepth: 4.2
    },
    street: {
        halfLength: 150,
        forecourt: 5,
        road0: 8,
        road1: 20
    },
    /** Parked cars: [x, lane] (lane 0 north curb, 1 south curb). */
    cars: [
        [-31, 0],
        [-22, 0],
        [6, 0],
        [12, 1],
        [27, 0],
        [-48, 1],
        [44, 1]
    ] as const,
    /** Rooms larger than this (m²) get a rooftop unit. */
    unitMinArea: 80,
    sculptures: [sculpture(-63), sculpture(63)] as const,
    logoUrl: '/assets/branding/moonshot-mark.png'
} as const;
