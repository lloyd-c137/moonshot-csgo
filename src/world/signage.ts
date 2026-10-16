// GAMEPLAY_AUTHORED door signage, styled after the reference photos of the M104 signs: a kraft board blade sign with
// black stencil lettering (room code, Chinese name, English name) projecting from the wall above the door, and a red
// plaque with white lettering on the wall beside it. Positions come from the derived world (tools/signage.ts).
// Lettering is drawn into two canvas atlases at load time (no external image or font assets).
import type { AppBase } from 'playcanvas';
import {
    Color,
    CULLFACE_BACK,
    CULLFACE_NONE,
    Entity,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    MeshInstance,
    PIXELFORMAT_RGBA8,
    StandardMaterial,
    Texture
} from 'playcanvas';

import { MeshBuilder } from '../render/meshBuilder';

import type { DerivedWorld } from './dressing';
import type { CampusRoom } from './roomIndex';
import type { SignText } from './signText';
import { signText } from './signText';

type V3 = [number, number, number];

/** Blade sign: width out from the wall, height, thickness, bottom edge height, outer corner radius (metres). */
export const BLADE = { width: 0.42, height: 0.62, thickness: 0.012, bottom: 2.22, radius: 0.07, standoff: 0.035 };
/** Wall plaque: width, height, centre height. */
export const PLAQUE = { width: 0.3, height: 0.11, centre: 1.55, depth: 0.006 };

const BLADE_CELL = { width: 128, height: 189 };
const PLAQUE_CELL = { width: 256, height: 94 };
const KRAFT = '#c6a676';
const STENCIL_INK = '#1c1a17';
const PLAQUE_RED = '#b3302b';
const FONT_LATIN = '"DIN Condensed", "Oswald", "Bahnschrift", "Arial Narrow", "Roboto Condensed", sans-serif';
const FONT_CJK =
    '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif';

/** Stencil look: the letters are cut through, so thin kraft bridges cross the strokes of closed shapes. */
const stencilBridges = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
    ctx.fillStyle = KRAFT;
    const bridge = Math.max(1, height * 0.07);
    const step = height * 0.55;
    for (let bx = x + step * 0.5; bx < x + width; bx += step) ctx.fillRect(bx, y + height * 0.15, bridge, height * 0.7);
};

const fitFont = (
    ctx: CanvasRenderingContext2D,
    text: string,
    family: string,
    weight: number,
    size: number,
    maxWidth: number
) => {
    let px = size;
    ctx.font = `${weight} ${px}px ${family}`;
    while (px > 6 && ctx.measureText(text).width > maxWidth) {
        px -= 1;
        ctx.font = `${weight} ${px}px ${family}`;
    }
    return px;
};

const drawBlade = (ctx: CanvasRenderingContext2D, ox: number, oy: number, text: SignText) => {
    const { width: w, height: h } = BLADE_CELL;
    ctx.fillStyle = KRAFT;
    ctx.fillRect(ox, oy, w, h);
    const pad = w * 0.11;
    ctx.fillStyle = STENCIL_INK;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    const cx = ox + w / 2;
    // Room code, large condensed.
    const codeSize = fitFont(ctx, text.code, FONT_LATIN, 800, h * 0.21, w - 2 * pad);
    ctx.fillText(text.code, cx, oy + h * 0.07);
    const codeWidth = ctx.measureText(text.code).width;
    stencilBridges(ctx, cx - codeWidth / 2, oy + h * 0.07, codeWidth, codeSize);
    // Chinese name lines, then the English name, anchored to the lower half like the photographed signs.
    let y = oy + h * 0.47;
    ctx.fillStyle = STENCIL_INK;
    for (const line of text.chinese) {
        const size = fitFont(ctx, line, FONT_CJK, 800, h * 0.105, w - 2 * pad);
        ctx.fillText(line, cx, y);
        y += size * 1.12;
    }
    y += h * 0.012;
    for (const line of text.english) {
        const size = fitFont(ctx, line, FONT_LATIN, 700, h * 0.062, w - 2 * pad);
        ctx.fillText(line, cx, y);
        y += size * 1.08;
    }
};

const drawPlaque = (ctx: CanvasRenderingContext2D, ox: number, oy: number, text: SignText) => {
    const { width: w, height: h } = PLAQUE_CELL;
    ctx.fillStyle = PLAQUE_RED;
    ctx.fillRect(ox, oy, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const pad = w * 0.04;
    const codeSize = fitFont(ctx, text.code, FONT_LATIN, 700, h * 0.3, w * 0.42);
    ctx.fillText(text.code, ox + pad, oy + h * 0.1);
    ctx.textAlign = 'right';
    let y = oy + h * 0.1;
    for (const line of text.chinese.slice(0, 2)) {
        const size = fitFont(ctx, line, FONT_CJK, 600, h * 0.2, w * 0.5);
        ctx.fillText(line, ox + w - pad, y);
        y += size * 1.1;
    }
    const english = text.english.join(' ');
    if (english) {
        ctx.textAlign = 'right';
        fitFont(ctx, english, FONT_LATIN, 600, h * 0.15, w - 2 * pad);
        ctx.fillText(
            english.replace(/\B\w+/g, (rest) => rest.toLowerCase()),
            ox + w - pad,
            oy + h * 0.74
        );
    }
    void codeSize;
};

const atlas = (app: AppBase, name: string, cell: { width: number; height: number }, count: number) => {
    const columns = Math.floor(2048 / cell.width);
    const rows = Math.max(1, Math.ceil(count / columns));
    const canvas = document.createElement('canvas');
    canvas.width = columns * cell.width;
    canvas.height = rows * cell.height;
    const ctx = canvas.getContext('2d')!;
    const texture = (draw: () => void) => {
        draw();
        const result = new Texture(app.graphicsDevice, {
            name,
            format: PIXELFORMAT_RGBA8,
            width: canvas.width,
            height: canvas.height,
            mipmaps: true,
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: FILTER_LINEAR,
            anisotropy: 8
        });
        result.setSource(canvas);
        return result;
    };
    /** UV of a point (fx, fy in 0..1, fy from the top) inside cell `index`. */
    const uv = (index: number, fx: number, fy: number): [number, number] => [
        ((index % columns) + fx) / columns,
        (Math.floor(index / columns) + fy) / rows
    ];
    const origin = (index: number): [number, number] => [
        (index % columns) * cell.width,
        Math.floor(index / columns) * cell.height
    ];
    return { ctx, texture, uv, origin };
};

const material = (
    name: string,
    colour: [number, number, number],
    gloss: number,
    map?: Texture,
    cull: number = CULLFACE_BACK
) => {
    const m = new StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = gloss;
    m.diffuse = new Color(...colour);
    if (map) m.diffuseMap = map;
    m.cull = cull;
    m.update();
    return m;
};

/** Outline of the blade in its local (u out from the wall, y up) plane: square at the wall, rounded outer corners. */
const bladeOutline = () => {
    const { width: w, height: h, radius: r } = BLADE;
    const points: [number, number][] = [
        [0, 0],
        [w - r, 0]
    ];
    for (let k = 1; k < 6; k++) {
        const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2);
        points.push([w - r + Math.cos(a) * r, r + Math.sin(a) * r]);
    }
    points.push([w, r], [w, h - r]);
    for (let k = 1; k < 6; k++) {
        const a = (k / 6) * (Math.PI / 2);
        points.push([w - r + Math.cos(a) * r, h - r + Math.sin(a) * r]);
    }
    points.push([w - r, h], [0, h]);
    return points;
};

export const buildSigns = (app: AppBase, parent: Entity, world: DerivedWorld, rooms: CampusRoom[]) => {
    const byId = new Map(rooms.map((room) => [room.id, room]));
    const signs = world.signs.filter((sign) => byId.has(sign.room));
    const blades = atlas(app, 'sign-blades', BLADE_CELL, signs.length);
    const plaques = atlas(app, 'sign-plaques', PLAQUE_CELL, signs.length);
    const texts = signs.map((sign) => signText(byId.get(sign.room)!));
    const bladeTexture = blades.texture(() =>
        texts.forEach((text, index) => drawBlade(blades.ctx, ...blades.origin(index), text))
    );
    const plaqueTexture = plaques.texture(() =>
        texts.forEach((text, index) => drawPlaque(plaques.ctx, ...plaques.origin(index), text))
    );

    const faces = new MeshBuilder();
    const plaqueFaces = new MeshBuilder();
    const edges = new MeshBuilder();
    const brackets = new MeshBuilder();
    const outline = bladeOutline();
    signs.forEach((sign, index) => {
        // Blade: local u along the outward normal, n across the blade.
        {
            const { x, z, yaw } = sign.blade;
            const o: [number, number] = [Math.cos(yaw), Math.sin(yaw)];
            const n: [number, number] = [-o[1], o[0]];
            const half = BLADE.thickness / 2;
            const point = (u: number, y: number, side: number): V3 => [
                x + o[0] * (u + BLADE.standoff) + n[0] * side * half,
                BLADE.bottom + y,
                z + o[1] * (u + BLADE.standoff) + n[1] * side * half
            ];
            for (const side of [1, -1]) {
                const normal: V3 = [n[0] * side, 0, n[1] * side];
                const ids = outline.map(([u, y]) => {
                    // Seen from +n the outward direction is to the viewer's right; mirror the -n face so it reads.
                    const fx = side > 0 ? u / BLADE.width : 1 - u / BLADE.width;
                    return faces.vertex(point(u, y, side), normal, blades.uv(index, fx, 1 - y / BLADE.height));
                });
                const centre = faces.vertex(
                    point(BLADE.width / 2, BLADE.height / 2, side),
                    normal,
                    blades.uv(index, 0.5, 0.5)
                );
                for (let i = 0; i < ids.length; i++) {
                    const a = ids[i];
                    const b = ids[(i + 1) % ids.length];
                    // Counter-clockwise as seen from the face normal.
                    if (side > 0) faces.triangle(centre, a, b);
                    else faces.triangle(centre, b, a);
                }
            }
            // MDF edge band around the outline.
            for (let i = 0; i < outline.length; i++) {
                const [u0, y0] = outline[i];
                const [u1, y1] = outline[(i + 1) % outline.length];
                const du = u1 - u0;
                const dy = y1 - y0;
                const length = Math.hypot(du, dy) || 1;
                // Outward edge normal in the blade plane (outline runs counter-clockwise in u/y).
                const eu = dy / length;
                const ey = -du / length;
                const normal: V3 = [o[0] * eu, ey, o[1] * eu];
                edges.quad([point(u0, y0, -1), point(u1, y1, -1), point(u1, y1, 1), point(u0, y0, 1)], normal, [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1]
                ]);
            }
            // Pale timber bracket fixing the blade to the wall.
            brackets.box(
                x + o[0] * (BLADE.standoff / 2 + 0.005),
                BLADE.bottom + BLADE.height * 0.18,
                z + o[1] * (BLADE.standoff / 2 + 0.005),
                BLADE.standoff + 0.03,
                0.045,
                BLADE.height * 0.62,
                yaw
            );
        }
        // Plaque flat on the wall, facing out.
        {
            const { x, z, yaw } = sign.plaque;
            const o: [number, number] = [Math.cos(yaw), Math.sin(yaw)];
            // Viewer facing the wall (looking along -o) has +r to the right.
            const r: [number, number] = [o[1], -o[0]];
            const front = PLAQUE.depth + 0.002;
            const corner = (fx: number, fy: number): V3 => [
                x + o[0] * front + r[0] * (fx - 0.5) * PLAQUE.width,
                PLAQUE.centre + (0.5 - fy) * PLAQUE.height,
                z + o[1] * front + r[1] * (fx - 0.5) * PLAQUE.width
            ];
            const normal: V3 = [o[0], 0, o[1]];
            const ids = (
                [
                    [0, 1],
                    [1, 1],
                    [1, 0],
                    [0, 0]
                ] as const
            ).map(([fx, fy]) => plaqueFaces.vertex(corner(fx, fy), normal, plaques.uv(index, fx, fy)));
            plaqueFaces.triangle(ids[0], ids[1], ids[2]);
            plaqueFaces.triangle(ids[0], ids[2], ids[3]);
            // Thin backing so the plaque has an edge against the wall.
            edges.box(
                x + o[0] * (PLAQUE.depth / 2),
                PLAQUE.centre - PLAQUE.height / 2,
                z + o[1] * (PLAQUE.depth / 2),
                PLAQUE.width,
                PLAQUE.depth,
                PLAQUE.height,
                Math.atan2(r[1], r[0])
            );
        }
    });

    const root = new Entity('GameplayAuthored_DoorSigns');
    parent.addChild(root);
    const add = (name: string, builder: MeshBuilder, m: StandardMaterial) => {
        if (builder.empty) return;
        const entity = new Entity(name);
        entity.addComponent('render', {
            meshInstances: [new MeshInstance(builder.build(app.graphicsDevice), m)],
            castShadows: false
        });
        root.addChild(entity);
    };
    add('Sign_Blades', faces, material('sign-kraft', [1, 1, 1], 0.15, bladeTexture));
    add('Sign_Plaques', plaqueFaces, material('sign-plaque', [1, 1, 1], 0.45, plaqueTexture));
    add('Sign_Edges', edges, material('sign-edge', [0.24, 0.17, 0.11], 0.2, undefined, CULLFACE_NONE));
    add('Sign_Brackets', brackets, material('sign-bracket', [0.86, 0.78, 0.62], 0.3));
    return { signs: signs.length };
};
