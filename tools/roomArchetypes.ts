// GAMEPLAY_AUTHORED room archetypes after the official Moonshot space photographs and the owner's 2026-08-06 model
// (owner upload 2026-10-17: app/official-interiors.mjs assignments). Photos fix each space type's furniture language,
// not room-by-room positions; layouts are fitted to each FF-01 room outline by tools/deriveWorld.ts, which also
// enforces wall, door, walkway and reachability clearance. Pure data, no engine imports.

export type ArchetypeType =
    | 'pod-desk'
    | 'whiteboard'
    | 'locker'
    | 'lab-island'
    | 'fume-hood'
    | 'sink-counter'
    | 'workbench'
    | 'tool-wall'
    | 'pinboard'
    | 'drum-kit'
    | 'amp'
    | 'keyboard'
    | 'sofa'
    | 'acoustic-panel'
    | 'mirror-wall'
    | 'barre'
    | 'reading-table'
    | 'round-table'
    | 'tea-table'
    | 'cushion'
    | 'workstation'
    | 'pingpong'
    | 'study-table'
    | 'half-round'
    | 'plant';

export type Archetype =
    | 'classroom'
    | 'lab-chem'
    | 'lab-bio'
    | 'lab-physics'
    | 'lab-earth'
    | 'maker'
    | 'design'
    | 'band'
    | 'dance'
    | 'library'
    | 'dining'
    | 'cafe'
    | 'tea'
    | 'office'
    | 'table-tennis'
    | 'study-hall';

export const ARCHETYPE_HEIGHTS: Record<ArchetypeType, number> = {
    'pod-desk': 0.74,
    whiteboard: 2.1,
    locker: 1.8,
    'lab-island': 0.9,
    'fume-hood': 2.2,
    'sink-counter': 0.9,
    workbench: 0.92,
    'tool-wall': 2,
    pinboard: 2,
    'drum-kit': 1.1,
    amp: 0.75,
    keyboard: 0.95,
    sofa: 0.8,
    'acoustic-panel': 2.4,
    'mirror-wall': 2.3,
    barre: 1,
    'reading-table': 0.75,
    'round-table': 0.75,
    'tea-table': 0.38,
    cushion: 0.18,
    workstation: 0.74,
    pingpong: 0.76,
    'study-table': 0.74,
    'half-round': 0.74,
    plant: 1.3
};

/** Solid items players bump into (and discs bounce off); low or soft items stay walk-through. */
export const ARCHETYPE_COLLIDING = new Set<ArchetypeType>([
    'pod-desk',
    'locker',
    'lab-island',
    'fume-hood',
    'sink-counter',
    'workbench',
    'drum-kit',
    'sofa',
    'reading-table',
    'round-table',
    'workstation',
    'pingpong',
    'study-table',
    'half-round'
]);

/** Owner-model room ids with a photographed archetype (upload: app/official-interiors.mjs and 2026-10-14 notes). */
const BY_ID: Record<string, Archetype> = {
    A227: 'lab-chem',
    A226: 'lab-bio',
    M124: 'lab-physics',
    M127: 'lab-physics',
    M126: 'lab-earth',
    M103: 'maker',
    A111: 'maker',
    S403: 'maker',
    M101: 'design',
    M102: 'design',
    M128: 'band',
    A113: 'band',
    S101: 'band',
    A217: 'dance',
    M100: 'office',
    S206: 'office',
    S209: 'office',
    S210: 'office',
    S308: 'office',
    S309: 'office',
    A205: 'office',
    A206: 'office',
    'A-I': 'table-tennis',
    'S-WC3': 'study-hall',
    S100: 'study-hall',
    S406: 'study-hall',
    'M-COFFEE': 'cafe',
    'A-TEA': 'tea'
};

/** Archetype for a room of the owner's model (id, name and game kind), or null for rooms left to the generic layout. */
export const archetypeFor = (id: string, name: string, kind: string): Archetype | null => {
    if (BY_ID[id]) return BY_ID[id];
    if (name.includes('自习') || name.includes('阅览') || name.includes('图书')) return 'library';
    if (name.includes('餐厅')) return 'dining';
    if (kind === 'classroom') return 'classroom';
    return null;
};

/** A placed item in the room frame: u along the long side (front at −u), v across; `wall` items stand on a wall. */
export type ArchetypeItem = {
    /** New archetype types, or the generic stool/chair/shelf the dressing already draws. */
    type: ArchetypeType | 'stool' | 'chair' | 'shelf';
    u: number;
    v: number;
    w: number;
    d: number;
    turn?: number;
    wall?: boolean;
};

const gridIn = (
    length: number,
    breadth: number,
    pitchU: number,
    pitchV: number,
    marginU: number,
    marginV: number,
    place: (u: number, v: number, i: number, j: number) => void
) => {
    const countU = Math.floor((length - 2 * marginU) / pitchU) + 1;
    const countV = Math.floor((breadth - 2 * marginV) / pitchV) + 1;
    if (countU < 1 || countV < 1 || length - 2 * marginU < 0 || breadth - 2 * marginV < 0) return;
    const startU = -((countU - 1) * pitchU) / 2;
    const startV = -((countV - 1) * pitchV) / 2;
    for (let i = 0; i < countU; i++)
        for (let j = 0; j < countV; j++) place(startU + i * pitchU, startV + j * pitchV, i, j);
};

/** Items along one wall (`side` −1: v = −breadth/2 wall, +1: v = +breadth/2 wall), spaced along u. */
const alongWall = (
    items: ArchetypeItem[],
    length: number,
    breadth: number,
    side: -1 | 1,
    type: ArchetypeType,
    w: number,
    d: number,
    pitch: number,
    span = 0.8
) => {
    const usable = length * span;
    const count = Math.max(1, Math.floor(usable / pitch));
    for (let i = 0; i < count; i++) {
        const u = -usable / 2 + pitch * (i + 0.5);
        items.push({ type, u, v: side * (breadth / 2 - d / 2 - 0.06), w, d, wall: true });
    }
};

/** Chairs around a table centred at (u, v), facing it (chairs face local +X before their turn). */
const chairsAround = (items: ArchetypeItem[], u: number, v: number, du: number, dv: number) => {
    items.push({ type: 'chair', u, v: v + dv, w: 0.44, d: 0.44, turn: -Math.PI / 2 });
    items.push({ type: 'chair', u, v: v - dv, w: 0.44, d: 0.44, turn: Math.PI / 2 });
    if (du > 0) {
        items.push({ type: 'chair', u: u + du, v, w: 0.44, d: 0.44, turn: Math.PI });
        items.push({ type: 'chair', u: u - du, v, w: 0.44, d: 0.44 });
    }
};

export const archetypeLayout = (archetype: Archetype, length: number, breadth: number): ArchetypeItem[] => {
    const items: ArchetypeItem[] = [];
    const front = -length / 2;
    const frontWall = (type: ArchetypeType, w: number, d = 0.06) =>
        items.push({ type, u: front + d / 2 + 0.06, v: 0, w: d, d: w, wall: true });
    const backWall = (type: ArchetypeType, w: number, d = 0.06) =>
        items.push({ type, u: -front - d / 2 - 0.06, v: 0, w: d, d: w, wall: true });
    switch (archetype) {
        case 'classroom':
            // Photographed classroom: whiteboard wall, pods of four facing desks, lockers at the back.
            frontWall('whiteboard', Math.min(breadth - 1.2, 4.2));
            gridIn(length - 2.4, breadth, 2.7, 2.6, 1.3, 1.4, (u, v) => {
                items.push({ type: 'pod-desk', u: u + 1.2, v, w: 1.2, d: 1.2 });
                chairsAround(items, u + 1.2, v, 0.85, 0.85);
            });
            backWall('locker', Math.min(breadth - 1.4, 3.6), 0.45);
            break;
        case 'lab-chem':
        case 'lab-bio':
        case 'lab-earth':
            // Lab islands with stools; fume hoods (chemistry) or sink counters along a long wall.
            frontWall('whiteboard', Math.min(breadth - 1.2, 3.6));
            gridIn(length - 1.6, breadth - 1, 3, 2.6, 1.6, 1.3, (u, v) => {
                items.push({ type: 'lab-island', u: u + 0.6, v, w: 2.2, d: 1.1 });
                for (const du of [-0.7, 0, 0.7])
                    for (const side of [-1, 1])
                        items.push({ type: 'stool', u: u + 0.6 + du, v: v + side * 0.85, w: 0.34, d: 0.34 });
            });
            alongWall(
                items,
                length,
                breadth,
                1,
                archetype === 'lab-chem' ? 'fume-hood' : 'sink-counter',
                archetype === 'lab-chem' ? 1.5 : 2.4,
                0.75,
                archetype === 'lab-chem' ? 2.2 : 2.8
            );
            // Chemistry: hoods on the opposite wall as well (one wall is usually windows or doors).
            if (archetype === 'lab-chem') alongWall(items, length, breadth, -1, 'fume-hood', 1.5, 0.75, 2.2, 0.6);
            break;
        case 'lab-physics':
            frontWall('whiteboard', Math.min(breadth - 1.2, 4));
            gridIn(length - 1.6, breadth, 2.9, 2.3, 1.6, 1.3, (u, v) => {
                items.push({ type: 'workbench', u: u + 0.6, v, w: 2, d: 0.9 });
                for (const du of [-0.5, 0.5])
                    items.push({ type: 'stool', u: u + 0.6 + du, v: v + 0.75, w: 0.34, d: 0.34 });
            });
            alongWall(items, length, breadth, -1, 'locker', 2, 0.45, 2.6);
            break;
        case 'maker':
            // Workbenches, a pegboard tool wall and storage.
            backWall('tool-wall', Math.min(breadth - 1, 4.5), 0.12);
            gridIn(length - 1.4, breadth, 2.9, 2.5, 1.5, 1.3, (u, v) => {
                items.push({ type: 'workbench', u: u - 0.4, v, w: 1.8, d: 0.9 });
                for (const du of [-0.45, 0.45])
                    for (const side of [-1, 1])
                        items.push({ type: 'stool', u: u - 0.4 + du, v: v + side * 0.75, w: 0.34, d: 0.34 });
            });
            alongWall(items, length, breadth, -1, 'locker', 1.8, 0.5, 2.4);
            break;
        case 'design':
            backWall('pinboard', Math.min(breadth - 1, 5), 0.06);
            frontWall('pinboard', Math.min(breadth - 1, 4), 0.06);
            gridIn(length - 1, breadth, 3.4, 2.6, 1.8, 1.4, (u, v) => {
                items.push({ type: 'reading-table', u, v, w: 2.4, d: 1.1 });
                for (const du of [-0.7, 0, 0.7])
                    for (const side of [-1, 1])
                        items.push({ type: 'stool', u: u + du, v: v + side * 0.85, w: 0.36, d: 0.36 });
            });
            break;
        case 'band': {
            // Modern band and recording room: drum kit, two amps, keyboard, a sofa and acoustic panels.
            items.push({ type: 'drum-kit', u: length / 2 - 1.6, v: 0, w: 1.6, d: 1.5 });
            items.push({ type: 'amp', u: length / 2 - 2.9, v: breadth / 2 - 1, w: 0.6, d: 0.4 });
            items.push({ type: 'amp', u: length / 2 - 2.9, v: -breadth / 2 + 1, w: 0.6, d: 0.4 });
            items.push({ type: 'keyboard', u: 0, v: breadth / 2 - 0.9, w: 1.3, d: 0.4 });
            items.push({
                type: 'sofa',
                u: -length / 2 + 0.75,
                v: 0,
                w: 0.9,
                d: Math.min(2.4, breadth - 1.4),
                wall: true
            });
            alongWall(items, length, breadth, -1, 'acoustic-panel', 1, 0.08, 1.6, 0.9);
            alongWall(items, length, breadth, 1, 'acoustic-panel', 1, 0.08, 1.6, 0.9);
            break;
        }
        case 'dance':
            alongWall(items, length, breadth, -1, 'mirror-wall', 2.4, 0.06, 2.45, 0.92);
            alongWall(items, length, breadth, 1, 'barre', 2.4, 0.1, 2.6, 0.85);
            break;
        case 'library':
            // Shelves along the long walls; reading tables with chairs down the middle; armchairs near the front.
            alongWall(items, length, breadth, -1, 'shelf', 1.8, 0.36, 1.9, 0.85);
            alongWall(items, length, breadth, 1, 'shelf', 1.8, 0.36, 1.9, 0.85);
            gridIn(length - 2, Math.max(0, breadth - 2.6), 3.2, 2.6, 1.5, 0.6, (u, v) => {
                items.push({ type: 'reading-table', u, v, w: 2, d: 0.9 });
                for (const du of [-0.55, 0.55]) {
                    items.push({ type: 'chair', u: u + du, v: v + 0.75, w: 0.44, d: 0.44, turn: -Math.PI / 2 });
                    items.push({ type: 'chair', u: u + du, v: v - 0.75, w: 0.44, d: 0.44, turn: Math.PI / 2 });
                }
            });
            break;
        case 'dining':
            backWall('locker', Math.min(breadth - 1.2, 5), 0.6);
            gridIn(length - 1.2, breadth, 2.4, 2.4, 1.4, 1.4, (u, v) => {
                items.push({ type: 'round-table', u: u - 0.4, v, w: 1.1, d: 1.1 });
                chairsAround(items, u - 0.4, v, 0.85, 0.85);
            });
            break;
        case 'cafe':
            alongWall(items, length, breadth, 1, 'sink-counter', Math.min(length * 0.6, 4.2), 0.7, 99, 0.6);
            gridIn(length - 1, Math.max(0, breadth - 1.6), 2, 2, 1.1, 0.4, (u, v) => {
                items.push({ type: 'round-table', u, v: v - 0.6, w: 0.75, d: 0.75 });
                items.push({ type: 'chair', u: u + 0.6, v: v - 0.6, w: 0.42, d: 0.42, turn: Math.PI });
                items.push({ type: 'chair', u: u - 0.6, v: v - 0.6, w: 0.42, d: 0.42 });
            });
            break;
        case 'tea':
            gridIn(length, breadth, 2.2, 2.2, 1.2, 1.2, (u, v) => {
                items.push({ type: 'tea-table', u, v, w: 1, d: 0.6 });
                for (const side of [-1, 1]) items.push({ type: 'cushion', u, v: v + side * 0.6, w: 0.5, d: 0.5 });
            });
            items.push({ type: 'plant', u: length / 2 - 0.4, v: breadth / 2 - 0.4, w: 0.5, d: 0.5, wall: true });
            break;
        case 'office':
            // Teacher office: dense back-to-back workstations with monitors, storage along a wall, plants.
            alongWall(items, length, breadth, -1, 'locker', 1.6, 0.45, 2, 0.75);
            gridIn(length - 1, Math.max(0, breadth - 1.4), 1.5, 2.6, 1, 0.9, (u, v, i) => {
                // A cross aisle after every three desks.
                if (i % 4 === 3) return;
                for (const side of [-1, 1]) {
                    items.push({
                        type: 'workstation',
                        u,
                        v: v + side * 0.36,
                        w: 1.3,
                        d: 0.7,
                        turn: side > 0 ? Math.PI : 0
                    });
                    items.push({
                        type: 'chair',
                        u,
                        v: v + side * 1.05,
                        w: 0.46,
                        d: 0.46,
                        turn: side > 0 ? -Math.PI / 2 : Math.PI / 2
                    });
                }
            });
            items.push({ type: 'plant', u: length / 2 - 0.35, v: breadth / 2 - 0.35, w: 0.45, d: 0.45, wall: true });
            break;
        case 'table-tennis': {
            // Open activity area: two table-tennis tables along the long side, benches on the wall.
            const gap = Math.min(length / 2, 5.2);
            for (const u of length > 9 ? [-gap / 2 - 0.4, gap / 2 + 0.4] : [0])
                items.push({ type: 'pingpong', u, v: 0, w: 2.74, d: 1.525 });
            alongWall(items, length, breadth, -1, 'sofa', 1.8, 0.5, 2.6, 0.7);
            items.push({ type: 'plant', u: -length / 2 + 0.35, v: breadth / 2 - 0.35, w: 0.45, d: 0.45, wall: true });
            break;
        }
        case 'study-hall':
            // Big study hall: white face-to-face tables with blue desk screens, black half-round tables at the ends.
            gridIn(length - 1.4, breadth, 2.2, 2.4, 1.6, 1.3, (u, v, i) => {
                items.push({ type: 'study-table', u, v, w: 1.6, d: 1.2 });
                for (const du of [-0.4, 0.4])
                    for (const side of [-1, 1])
                        items.push({
                            type: 'chair',
                            u: u + du,
                            v: v + side * 0.85,
                            w: 0.42,
                            d: 0.42,
                            turn: side > 0 ? -Math.PI / 2 : Math.PI / 2
                        });
                if (i === 0) items.push({ type: 'half-round', u: u - 1.6, v, w: 0.7, d: 1.2 });
            });
            // A small study room still gets one face-to-face table.
            if (!items.length) {
                items.push({ type: 'study-table', u: 0, v: 0, w: 1.6, d: 1.2 });
                for (const du of [-0.4, 0.4])
                    for (const side of [-1, 1])
                        items.push({
                            type: 'chair',
                            u: du,
                            v: side * 0.85,
                            w: 0.42,
                            d: 0.42,
                            turn: side > 0 ? -Math.PI / 2 : Math.PI / 2
                        });
            }
            break;
        default:
    }
    return items;
};
