// Geometry for the photographed room archetypes (tools/roomArchetypes.ts): classroom pods and whiteboards, lab
// islands and fume hoods, maker benches, band room, library, dining, café, tea room, teacher office, table tennis and
// the big study hall. Boxes only, merged per material by the dressing. GAMEPLAY_AUTHORED, not surveyed.
import { MeshBuilder } from '../render/meshBuilder';

type Rgb = [number, number, number];

/** One builder per finish; dressing.ts turns each into a mesh with this colour and gloss. */
export const ARCHETYPE_FINISHES = {
    white: { colour: [0.93, 0.93, 0.91] as Rgb, gloss: 0.55 },
    dark: { colour: [0.12, 0.13, 0.15] as Rgb, gloss: 0.45 },
    wood: { colour: [0.72, 0.55, 0.38] as Rgb, gloss: 0.4 },
    metal: { colour: [0.3, 0.31, 0.33] as Rgb, gloss: 0.6 },
    blue: { colour: [0.16, 0.36, 0.72] as Rgb, gloss: 0.45 },
    steel: { colour: [0.55, 0.6, 0.66] as Rgb, gloss: 0.5 },
    green: { colour: [0.24, 0.5, 0.26] as Rgb, gloss: 0.2 },
    fabric: { colour: [0.36, 0.45, 0.5] as Rgb, gloss: 0.1 },
    mirror: { colour: [0.72, 0.8, 0.84] as Rgb, gloss: 0.95 },
    cork: { colour: [0.74, 0.6, 0.42] as Rgb, gloss: 0.1 },
    glass: { colour: [0.42, 0.55, 0.6] as Rgb, gloss: 0.9 },
    epoxy: { colour: [0.08, 0.09, 0.1] as Rgb, gloss: 0.7 }
} as const;

export type ArchetypeFinish = keyof typeof ARCHETYPE_FINISHES;

export const createArchetypeDrawer = () => {
    const builders = Object.fromEntries(
        Object.keys(ARCHETYPE_FINISHES).map((key) => [key, new MeshBuilder()])
    ) as Record<ArchetypeFinish, MeshBuilder>;
    const b = builders;

    /** Draws one item; false when the type is not an archetype type. */
    const draw = (type: string, x: number, z: number, width: number, depth: number, height: number, yaw: number) => {
        const c = Math.cos(yaw),
            s = Math.sin(yaw);
        // Local (u along width, v along depth) to world.
        const at = (u: number, v: number): [number, number] => [x + u * c - v * s, z + u * s + v * c];
        const box = (
            finish: ArchetypeFinish,
            u: number,
            v: number,
            y: number,
            w: number,
            d: number,
            h: number,
            faces = 6
        ) => {
            const [px, pz] = at(u, v);
            b[finish].box(px, y, pz, w, d, h, yaw, faces);
        };
        const legs = (finish: ArchetypeFinish, w: number, d: number, h: number, size = 0.045) => {
            for (const [u, v] of [
                [-1, -1],
                [1, -1],
                [1, 1],
                [-1, 1]
            ])
                box(finish, (u * (w - 0.1)) / 2, (v * (d - 0.1)) / 2, 0, size, size, h);
        };
        const tableTop = (finish: ArchetypeFinish, h: number, thick = 0.04) => {
            box(finish, 0, 0, h - thick, width, depth, thick);
            legs('metal', width, depth, h - thick);
        };
        // Wall items: the thin axis is whichever of width/depth is smaller; the panel spans the other.
        const thinAlongWidth = width < depth;
        const panel = (finish: ArchetypeFinish, y: number, h: number, inset = 0) =>
            box(finish, thinAlongWidth ? inset : 0, thinAlongWidth ? 0 : inset, y, width, depth, h);
        const run = Math.max(width, depth);
        switch (type) {
            case 'pod-desk':
            case 'study-table':
                tableTop('white', height);
                if (type === 'study-table') box('blue', 0, 0, height, width - 0.1, 0.03, 0.4);
                return true;
            case 'half-round':
                box('dark', 0, 0, height - 0.04, width, depth, 0.04);
                box('dark', 0, 0, 0, 0.12, depth * 0.6, height - 0.04);
                return true;
            case 'reading-table':
                tableTop('wood', height, 0.05);
                return true;
            case 'round-table':
                box('white', 0, 0, height - 0.04, width * 0.92, depth * 0.92, 0.04);
                box('white', 0, 0, height - 0.04, width * 0.7, depth, 0.04);
                box('white', 0, 0, height - 0.04, width, depth * 0.7, 0.04);
                box('metal', 0, 0, 0, 0.08, 0.08, height - 0.04);
                box('metal', 0, 0, 0, width * 0.5, 0.06, 0.03);
                box('metal', 0, 0, 0, 0.06, depth * 0.5, 0.03);
                return true;
            case 'tea-table':
                box('wood', 0, 0, height - 0.06, width, depth, 0.06);
                legs('wood', width, depth, height - 0.06, 0.07);
                return true;
            case 'cushion':
                box('fabric', 0, 0, 0, width, depth, height);
                return true;
            case 'workstation':
                tableTop('white', height);
                // Monitor on the far edge (local −v is the user's side once turned) and a blue privacy screen.
                box('dark', 0, depth / 2 - 0.12, height, 0.55, 0.04, 0.34);
                box('dark', 0, depth / 2 - 0.12, height, 0.06, 0.06, 0.12);
                box('blue', 0, depth / 2 - 0.01, height, width, 0.03, 0.45);
                return true;
            case 'whiteboard':
                panel('steel', 0.82, 1.3);
                panel('white', 0.86, 1.22, thinAlongWidth ? (width / 2) * 0.4 : 0);
                return true;
            case 'pinboard':
                panel('cork', 0.8, 1.2);
                return true;
            case 'tool-wall':
                panel('cork', 0.85, 1.15);
                // Tools as dark marks on the pegboard.
                for (let i = -2; i <= 2; i++) {
                    const offset = (i * run) / 6;
                    box(
                        'dark',
                        thinAlongWidth ? 0 : offset,
                        thinAlongWidth ? offset : 0,
                        1.3 + (i % 2) * 0.25,
                        0.1,
                        0.1,
                        0.32
                    );
                }
                return true;
            case 'acoustic-panel':
                panel('dark', 0.3, height - 0.3);
                return true;
            case 'mirror-wall':
                panel('mirror', 0.1, height - 0.1);
                return true;
            case 'barre':
                for (const t of [-0.42, 0.42])
                    box('metal', thinAlongWidth ? 0 : t * run, thinAlongWidth ? t * run : 0, 0, 0.05, 0.05, height);
                box('wood', 0, 0, height - 0.05, thinAlongWidth ? 0.05 : run, thinAlongWidth ? run : 0.05, 0.05);
                return true;
            case 'locker':
                box('steel', 0, 0, 0, width, depth, height);
                // Door seams every 0.45 m along the run.
                for (let t = -run / 2 + 0.45; t < run / 2 - 0.1; t += 0.45)
                    box(
                        'dark',
                        thinAlongWidth ? 0 : t,
                        thinAlongWidth ? t : 0,
                        0.05,
                        thinAlongWidth ? width + 0.01 : 0.015,
                        thinAlongWidth ? 0.015 : depth + 0.01,
                        height - 0.1
                    );
                return true;
            case 'lab-island':
                box('white', 0, 0, 0, width - 0.06, depth - 0.06, height - 0.04);
                box('epoxy', 0, 0, height - 0.04, width, depth, 0.04);
                box('metal', 0, 0, height, 0.04, 0.04, 0.32);
                return true;
            case 'sink-counter':
                box('white', 0, 0, 0, width, depth, height - 0.04);
                box('steel', 0, 0, height - 0.04, width + 0.03, depth + 0.03, 0.04);
                box('metal', 0, 0, height, 0.04, 0.04, 0.28);
                return true;
            case 'fume-hood':
                box('white', 0, 0, 0, width, depth, 0.9);
                box('epoxy', 0, 0, 0.9, width, depth, 0.03);
                box('glass', 0, 0, 0.93, width - 0.1, depth - 0.1, 0.85);
                box('white', 0, 0, 1.78, width, depth, height - 1.78);
                return true;
            case 'workbench':
                box('wood', 0, 0, height - 0.06, width, depth, 0.06);
                legs('metal', width, depth, height - 0.06, 0.06);
                box('wood', 0, 0, 0.18, width - 0.12, depth - 0.12, 0.03);
                return true;
            case 'drum-kit':
                box('dark', -0.15, 0, 0, 0.42, 0.56, 0.56);
                box('steel', 0.25, -0.35, 0.45, 0.32, 0.32, 0.25);
                box('steel', 0.25, 0.3, 0.45, 0.3, 0.3, 0.2);
                box('dark', 0.35, 0.55, 0, 0.36, 0.36, 0.5);
                for (const [u, v] of [
                    [0.45, -0.65],
                    [0.5, 0.75],
                    [-0.35, -0.6]
                ]) {
                    box('metal', u, v, 0, 0.03, 0.03, height);
                    box('cork', u, v, height, 0.42, 0.42, 0.01);
                }
                box('fabric', -0.6, 0, 0, 0.36, 0.36, 0.5);
                return true;
            case 'amp':
                box('dark', 0, 0, 0, width, depth, height);
                box('metal', 0, depth / 2, 0.1, width - 0.1, 0.01, height - 0.25);
                return true;
            case 'keyboard':
                for (const t of [-0.4, 0.4]) box('metal', t * width, 0, 0, 0.04, depth * 0.8, height - 0.1);
                box('dark', 0, 0, height - 0.1, width, depth * 0.75, 0.1);
                box('white', 0, -depth * 0.12, height, width - 0.08, depth * 0.3, 0.01);
                return true;
            case 'sofa': {
                // Back along the long side that faces the wall.
                box('fabric', 0, 0, 0, width, depth, 0.42);
                const backAlongWidth = width >= depth;
                box(
                    'fabric',
                    backAlongWidth ? 0 : -width / 2 + 0.1,
                    backAlongWidth ? -depth / 2 + 0.1 : 0,
                    0.42,
                    backAlongWidth ? width : 0.2,
                    backAlongWidth ? 0.2 : depth,
                    height - 0.42
                );
                return true;
            }
            case 'pingpong':
                box('blue', 0, 0, height - 0.03, width, depth, 0.03);
                // White edge and centre line, net across the middle.
                box('white', 0, 0, height, width, 0.02, 0.003);
                for (const v of [-1, 1]) box('white', 0, (v * (depth - 0.02)) / 2, height, width, 0.02, 0.003);
                for (const u of [-1, 1]) box('white', (u * (width - 0.02)) / 2, 0, height, 0.02, depth, 0.003);
                box('dark', 0, 0, height, 0.02, depth + 0.3, 0.1525);
                for (const u of [-0.32, 0.32]) box('dark', u * width, 0, 0, 0.08, depth * 0.8, height - 0.03);
                return true;
            case 'plant':
                box('white', 0, 0, 0, width * 0.7, depth * 0.7, 0.4);
                box('green', 0, 0, 0.4, width, depth, height - 0.4, 6);
                box('green', 0, 0, 0.75, width * 1.15, depth * 0.6, height - 0.95);
                return true;
            default:
                return false;
        }
    };
    return { draw, builders };
};
