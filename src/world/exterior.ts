// The campus seen from outside: lawn and paved apron, the south gate after the owner's 2026-08-06 model
// (campus-exterior.mjs, from the 2026-10-14 street photos), the tree-lined street, the east/west paths, rooftop units
// and the two tennis-ball sculptures. Placed in FF-01 metres with the same plan fit as the room names
// (src/config/roomNaming.ts). Visual only: no colliders; players never leave the building.
// GAMEPLAY_AUTHORED, illustrative proportions, not surveyed.
import type { AppBase, Entity as EntityType } from 'playcanvas';
import { Color, CULLFACE_NONE, Entity, MeshInstance, StandardMaterial, Texture } from 'playcanvas';

import { MeshBuilder } from '../render/meshBuilder';

import { EXTERIOR } from './exteriorLayout';
import type { CampusRoom } from './roomIndex';

type V3 = [number, number, number];

const material = (name: string, colour: V3, gloss = 0.25, emissive?: V3) => {
    const m = new StandardMaterial();
    m.name = name;
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = gloss;
    m.cull = CULLFACE_NONE;
    m.diffuse = new Color(...colour);
    if (emissive) {
        m.emissive = new Color(...emissive);
        m.emissiveIntensity = 1;
    }
    m.update();
    return m;
};

const hex = (value: string): V3 => [
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255
];

/** A box centred at `c` with full rotation (pitch rx, yaw ry, roll rz, applied Y·X·Z), flat-shaded. */
const orientedBox = (builder: MeshBuilder, c: V3, size: V3, rx = 0, ry = 0, rz = 0) => {
    const [hx, hy, hz] = size.map((s) => s / 2);
    const [cx, sx] = [Math.cos(rx), Math.sin(rx)],
        [cy, sy] = [Math.cos(ry), Math.sin(ry)],
        [cz, sz] = [Math.cos(rz), Math.sin(rz)];
    const rotate = ([x, y, z]: V3): V3 => {
        // Roll about Z, then pitch about X, then yaw about Y.
        const x1 = x * cz - y * sz,
            y1 = x * sz + y * cz;
        const y2 = y1 * cx - z * sx,
            z2 = y1 * sx + z * cx;
        return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];
    };
    const faces: [V3, V3, V3][] = [
        [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
        ],
        [
            [-1, 0, 0],
            [0, 0, 1],
            [0, 1, 0]
        ],
        [
            [0, 1, 0],
            [0, 0, 1],
            [1, 0, 0]
        ],
        [
            [0, -1, 0],
            [1, 0, 0],
            [0, 0, 1]
        ],
        [
            [0, 0, 1],
            [1, 0, 0],
            [0, 1, 0]
        ],
        [
            [0, 0, -1],
            [0, 1, 0],
            [1, 0, 0]
        ]
    ];
    const half: V3 = [hx, hy, hz];
    for (const [n, u, v] of faces) {
        const centre: V3 = [n[0] * hx, n[1] * hy, n[2] * hz];
        const du: V3 = [u[0] * half[0], u[1] * half[1], u[2] * half[2]];
        const dv: V3 = [v[0] * half[0], v[1] * half[1], v[2] * half[2]];
        const normal = rotate(n);
        const corner = (a: number, b: number): V3 => {
            const p = rotate([
                centre[0] + a * du[0] + b * dv[0],
                centre[1] + a * du[1] + b * dv[1],
                centre[2] + a * du[2] + b * dv[2]
            ]);
            return [c[0] + p[0], c[1] + p[1], c[2] + p[2]];
        };
        const i0 = builder.vertex(corner(-1, -1), normal, [0, 0]);
        builder.vertex(corner(1, -1), normal, [1, 0]);
        builder.vertex(corner(1, 1), normal, [1, 1]);
        builder.vertex(corner(-1, 1), normal, [0, 1]);
        builder.triangle(i0, i0 + 1, i0 + 2);
        builder.triangle(i0, i0 + 2, i0 + 3);
    }
};

/** Flat-shaded icosahedron (tree crowns, the tennis balls), radius r, vertical stretch sy. */
const blob = (builder: MeshBuilder, c: V3, r: number, sy = 1) => {
    const t = (1 + Math.sqrt(5)) / 2;
    const v: V3[] = [
        [-1, t, 0],
        [1, t, 0],
        [-1, -t, 0],
        [1, -t, 0],
        [0, -1, t],
        [0, 1, t],
        [0, -1, -t],
        [0, 1, -t],
        [t, 0, -1],
        [t, 0, 1],
        [-t, 0, -1],
        [-t, 0, 1]
    ].map(([x, y, z]) => {
        const l = Math.hypot(x, y, z);
        return [c[0] + (x / l) * r, c[1] + (y / l) * r * sy, c[2] + (z / l) * r] as V3;
    });
    const f = [
        [0, 11, 5],
        [0, 5, 1],
        [0, 1, 7],
        [0, 7, 10],
        [0, 10, 11],
        [1, 5, 9],
        [5, 11, 4],
        [11, 10, 2],
        [10, 7, 6],
        [7, 1, 8],
        [3, 9, 4],
        [3, 4, 2],
        [3, 2, 6],
        [3, 6, 8],
        [3, 8, 9],
        [4, 9, 5],
        [2, 4, 11],
        [6, 2, 10],
        [8, 6, 7],
        [9, 8, 1]
    ];
    for (const [a, b, d] of f) {
        const [p, q, s] = [v[a], v[b], v[d]];
        const ux = q[0] - p[0],
            uy = q[1] - p[1],
            uz = q[2] - p[2];
        const wx = s[0] - p[0],
            wy = s[1] - p[1],
            wz = s[2] - p[2];
        let nx = uy * wz - uz * wy,
            ny = uz * wx - ux * wz,
            nz = ux * wy - uy * wx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const i0 = builder.vertex(p, [nx, ny, nz], [0, 0]);
        builder.vertex(q, [nx, ny, nz], [1, 0]);
        builder.vertex(s, [nx, ny, nz], [0, 1]);
        builder.triangle(i0, i0 + 1, i0 + 2);
    }
};

/** Horizontal rectangle at height y (ground surfaces). */
const flat = (builder: MeshBuilder, x0: number, z0: number, x1: number, z1: number, y: number) => {
    const n: V3 = [0, 1, 0];
    const i0 = builder.vertex([x0, y, z0], n, [x0, z0]);
    builder.vertex([x1, y, z0], n, [x1, z0]);
    builder.vertex([x1, y, z1], n, [x1, z1]);
    builder.vertex([x0, y, z1], n, [x0, z1]);
    builder.triangle(i0, i0 + 2, i0 + 1);
    builder.triangle(i0, i0 + 3, i0 + 2);
};

/** The school wordmark and the supplied mark on one sign texture (owner upload; school-owned branding). */
const signTexture = (app: AppBase) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#243938';
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = '#f5f4eb';
    g.font = '700 84px "PingFang SC", "Microsoft YaHei", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('探月学校', 250, 88);
    g.font = '600 58px Arial, sans-serif';
    g.fillText('MOONSHOT ACADEMY', 250, 182);
    const texture = new Texture(app.graphicsDevice, { name: 'gate-sign', width: 1024, height: 256, mipmaps: true });
    texture.setSource(canvas);
    const logo = new Image();
    logo.onload = () => {
        // Round white plate behind the mark (the file has no alpha).
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(128, 128, 104, 0, Math.PI * 2);
        g.fill();
        g.save();
        g.beginPath();
        g.arc(128, 128, 100, 0, Math.PI * 2);
        g.clip();
        g.drawImage(logo, 28, 28, 200, 200);
        g.restore();
        texture.setSource(canvas);
    };
    logo.src = EXTERIOR.logoUrl;
    return texture;
};

export const buildExterior = (app: AppBase, parent: EntityType, rooms: readonly CampusRoom[]) => {
    const root = new Entity('Exterior');
    parent.addChild(root);
    const b = {
        grass: new MeshBuilder(),
        apron: new MeshBuilder(),
        asphalt: new MeshBuilder(),
        paving: new MeshBuilder(),
        marking: new MeshBuilder(),
        wall: new MeshBuilder(),
        glass: new MeshBuilder(),
        frame: new MeshBuilder(),
        base: new MeshBuilder(),
        roofCap: new MeshBuilder(),
        blue: new MeshBuilder(),
        cyan: new MeshBuilder(),
        magenta: new MeshBuilder(),
        orange: new MeshBuilder(),
        canopy: new MeshBuilder(),
        steel: new MeshBuilder(),
        trunk: new MeshBuilder(),
        crown: new MeshBuilder(),
        lampGlow: new MeshBuilder(),
        carDark: new MeshBuilder(),
        carGrey: new MeshBuilder(),
        carSilver: new MeshBuilder(),
        carTeal: new MeshBuilder(),
        cabin: new MeshBuilder(),
        tyre: new MeshBuilder(),
        unit: new MeshBuilder(),
        ball: new MeshBuilder(),
        ring: new MeshBuilder()
    };
    const { gate, street } = EXTERIOR;
    const X = gate.x,
        ZF = gate.front;
    const top = EXTERIOR.wallTop;

    // Ground: lawn, paved apron round the building, the east and west paths.
    flat(b.grass, -EXTERIOR.groundHalf, -EXTERIOR.groundHalf, EXTERIOR.groundHalf, EXTERIOR.groundHalf, -0.06);
    const [ax0, az0, ax1, az1] = EXTERIOR.apron;
    flat(b.apron, ax0, az0, ax1, az1, -0.035);
    for (const path of EXTERIOR.paths) flat(b.paving, path[0], path[1], path[2], path[3], -0.03);

    // The street south of the gate: forecourt, sidewalks, asphalt with a dashed centre line and parking bays.
    flat(b.paving, X - 22, ZF, X + 22, ZF + street.forecourt, -0.02);
    flat(b.paving, -street.halfLength, ZF + street.forecourt, street.halfLength, ZF + street.road0, -0.025);
    flat(b.asphalt, -street.halfLength, ZF + street.road0, street.halfLength, ZF + street.road1, -0.03);
    flat(b.paving, -street.halfLength, ZF + street.road1, street.halfLength, ZF + street.road1 + 3, -0.025);
    const mid = ZF + (street.road0 + street.road1) / 2;
    for (let x = -street.halfLength + 2; x < street.halfLength - 2; x += 6)
        flat(b.marking, x, mid - 0.07, x + 3, mid + 0.07, -0.02);
    for (let x = -street.halfLength + 4; x < street.halfLength - 4; x += 6)
        flat(b.marking, x, ZF + street.road0 + 2.3, x + 0.1, ZF + street.road0 + 2.5, -0.02);

    // South gate façade on the building's south wall: green base band, teal glazing in dark mullions, a light
    // cladding band over it, the dark entrance frame, a glass canopy on thin posts.
    const halfOpening = gate.opening / 2;
    for (const side of [-1, 1]) {
        const x0 = X + side * halfOpening,
            x1 = X + side * gate.halfWidth;
        const cx = (x0 + x1) / 2,
            w = Math.abs(x1 - x0);
        orientedBox(b.base, [cx, 0.3, ZF + 0.1], [w, 0.6, 0.22]);
        orientedBox(b.wall, [cx, top - 0.35, ZF + 0.08], [w, 0.9, 0.18]);
    }
    orientedBox(b.wall, [X, top - 0.35, ZF + 0.08], [gate.opening, 0.9, 0.18]);
    for (let x = X - gate.halfWidth + 1.3; x <= X + gate.halfWidth - 1.3; x += 2.6) {
        if (Math.abs(x - X) < halfOpening + 0.6) continue;
        orientedBox(b.glass, [x, 1.65, ZF + 0.09], [2.35, 2.1, 0.06]);
        orientedBox(b.frame, [x + 1.3, 1.65, ZF + 0.12], [0.06, 2.2, 0.08]);
    }
    for (const side of [-1, 1])
        orientedBox(b.frame, [X + side * (halfOpening + 0.2), 1.45, ZF + 0.16], [0.35, 2.9, 0.16]);
    orientedBox(b.frame, [X, 2.9, ZF + 0.16], [gate.opening + 0.75, 0.18, 0.16]);
    orientedBox(b.canopy, [X, gate.canopyHeight, ZF + gate.canopyDepth / 2], [20, 0.12, gate.canopyDepth], -0.06);
    for (const x of [-8, -4, 4, 8]) {
        orientedBox(
            b.steel,
            [X + x, gate.canopyHeight / 2, ZF + gate.canopyDepth - 0.5],
            [0.1, gate.canopyHeight, 0.1]
        );
        orientedBox(
            b.steel,
            [X + x, gate.canopyHeight - 0.05, ZF + gate.canopyDepth / 2],
            [0.08, 0.1, gate.canopyDepth]
        );
    }

    // Three outward-sloping roof volumes over the gate, with the blue base band and the cyan/magenta/orange stripes.
    for (const [x, tilt] of [
        [-12, -0.11],
        [0, 0],
        [12, 0.11]
    ] as const) {
        const cx = X + x;
        orientedBox(b.roofCap, [cx, top + 1.15, ZF - 3.2], [10.8, 1, 7.6], -0.2, 0, tilt);
        orientedBox(b.blue, [cx, top + 0.62, ZF + 0.42], [10.5, 0.28, 0.42], 0, 0, tilt);
        orientedBox(b.cyan, [cx - 2.7, top + 0.86, ZF + 0.3], [2.7, 0.3, 0.46], 0, 0, tilt);
        orientedBox(b.magenta, [cx + 0.15, top + 0.86, ZF + 0.3], [2.3, 0.3, 0.46], 0, 0, tilt);
        orientedBox(b.orange, [cx + 2.7, top + 0.86, ZF + 0.3], [2.6, 0.3, 0.46], 0, 0, tilt);
    }

    // Forecourt fence either side of the entrance and a bicycle rack.
    // The fence closes the waiting plaza on the street side (no way out but through the turnstiles).
    for (let x = X - 18; x <= X + 18; x += 3) {
        orientedBox(b.frame, [x, 0.55, ZF + street.forecourt - 0.3], [2.72, 1.05, 0.08]);
    }
    for (let x = X + 8; x < X + 19; x += 1.25) {
        for (const dz of [-0.42, 0.42]) orientedBox(b.tyre, [x, 0.36, ZF + 2.3 + dz], [0.06, 0.66, 0.66]);
        orientedBox(b.carTeal, [x, 0.62, ZF + 2.3], [0.04, 0.05, 0.84], 0, 0, 0);
        orientedBox(b.carTeal, [x, 0.8, ZF + 2.18], [0.04, 0.38, 0.05]);
    }

    // Street trees and lamps along both sidewalks, parked cars along the north curb.
    for (let x = -street.halfLength + 6; x < street.halfLength - 4; x += 8) {
        for (const [z, s] of [
            [ZF + street.forecourt + 1.3, 1.1],
            [ZF + street.road1 + 1.5, 1]
        ] as const) {
            if (Math.abs(x - X) < 5 && z < ZF + 8) continue;
            orientedBox(b.trunk, [x, 1.05 * s, z], [0.3 * s, 2.1 * s, 0.3 * s]);
            blob(b.crown, [x, 3 * s, z], 1.55 * s, 1.25);
            blob(b.crown, [x + 0.7 * s, 2.7 * s, z + 0.2], 1.05 * s, 1.2);
            blob(b.crown, [x - 0.6 * s, 2.65 * s, z - 0.15], 1.1 * s, 1.2);
        }
        if ((x + street.halfLength) % 16 < 8) {
            for (const z of [ZF + street.road0 - 0.4, ZF + street.road1 + 0.4]) {
                orientedBox(b.steel, [x + 4, 2.2, z], [0.1, 4.4, 0.1]);
                orientedBox(b.steel, [x + 4, 4.38, z], [0.7, 0.1, 0.25]);
                orientedBox(b.lampGlow, [x + 4, 4.31, z], [0.55, 0.04, 0.2]);
            }
        }
    }
    const carBodies = [b.carDark, b.carGrey, b.carSilver, b.carTeal];
    EXTERIOR.cars.forEach(([x, lane], i) => {
        const z = ZF + street.road0 + 1.2 + lane * 3.4;
        const yaw = lane ? Math.PI : 0;
        orientedBox(carBodies[i % carBodies.length], [x, 0.55, z], [4.2, 0.62, 1.78], 0, yaw);
        orientedBox(b.cabin, [x - 0.15, 1.12, z], [2.1, 0.58, 1.54], 0, yaw);
        for (const dx of [-1.35, 1.35])
            for (const dz of [-0.82, 0.82]) orientedBox(b.tyre, [x + dx, 0.32, z + dz], [0.64, 0.64, 0.22]);
    });

    // Rooftop units on the larger rooms (the roof itself is drawn with the ceiling, in dressing.ts).
    const seen = new Set<string>();
    for (const room of rooms) {
        if (!room.polygon || seen.has(room.id) || ['garden', 'stair', 'restroom'].includes(room.kind)) continue;
        seen.add(room.id);
        const ring = room.polygon.outer;
        let area = 0,
            cx = 0,
            cz = 0;
        for (let i = 0; i < ring.length; i++) {
            const [x0, z0] = ring[i],
                [x1, z1] = ring[(i + 1) % ring.length];
            const cross = x0 * z1 - x1 * z0;
            area += cross;
            cx += (x0 + x1) * cross;
            cz += (z0 + z1) * cross;
        }
        if (Math.abs(area / 2) < EXTERIOR.unitMinArea) continue;
        cx /= 3 * area;
        cz /= 3 * area;
        orientedBox(b.unit, [cx, top + 0.62, cz], [2.2, 1.1, 1.4]);
        orientedBox(b.steel, [cx + 0.5, top + 1.2, cz], [0.9, 0.06, 0.9]);
    }

    // The two giant tennis balls with their rings (model landscape features).
    for (const [x, z] of EXTERIOR.sculptures) {
        blob(b.ball, [x, 1.9, z], 1.9);
        for (let i = 0; i < 28; i++) {
            const a = (i / 28) * Math.PI * 2;
            const r = 2.05;
            orientedBox(
                b.ring,
                [x + Math.cos(a) * r, 1.9 + Math.sin(a) * r * Math.cos(0.65), z + Math.sin(a) * r * Math.sin(0.65)],
                [0.5, 0.09, 0.09],
                0.65,
                0,
                a
            );
        }
    }

    const sign = new MeshBuilder();
    {
        const n: V3 = [0, 0, 1];
        const [w, h] = [6.4, 1.6];
        const y = gate.canopyHeight + 0.95,
            z = ZF + 0.22;
        const i0 = sign.vertex([X - w / 2, y - h / 2, z], n, [0, 1]);
        sign.vertex([X + w / 2, y - h / 2, z], n, [1, 1]);
        sign.vertex([X + w / 2, y + h / 2, z], n, [1, 0]);
        sign.vertex([X - w / 2, y + h / 2, z], n, [0, 0]);
        sign.triangle(i0, i0 + 1, i0 + 2);
        sign.triangle(i0, i0 + 2, i0 + 3);
    }
    const signMaterial = material('gate-sign', [0, 0, 0], 0.3, [1, 1, 1]);
    signMaterial.emissiveMap = signTexture(app);
    signMaterial.update();

    const finishes: [keyof typeof b, StandardMaterial][] = [
        ['grass', material('ext-grass', hex('#5b8a5f'), 0.05)],
        ['apron', material('ext-apron', hex('#c5cbc8'), 0.12)],
        ['asphalt', material('ext-asphalt', hex('#4d5352'), 0.15)],
        ['paving', material('ext-paving', hex('#c9c7bc'), 0.12)],
        ['marking', material('ext-marking', hex('#f2efe2'), 0.2)],
        ['wall', material('ext-wall', hex('#b9bab4'), 0.2)],
        ['glass', material('ext-glass', hex('#4b8e8d'), 0.85)],
        ['frame', material('ext-frame', hex('#263b3d'), 0.4)],
        ['base', material('ext-base', hex('#617a75'), 0.2)],
        ['roofCap', material('ext-roof-cap', hex('#d0d0ca'), 0.2)],
        ['blue', material('ext-band-blue', hex('#3154bc'), 0.4)],
        ['cyan', material('ext-band-cyan', hex('#18c5da'), 0.4)],
        ['magenta', material('ext-band-magenta', hex('#ef318f'), 0.4)],
        ['orange', material('ext-band-orange', hex('#ef9b28'), 0.4)],
        ['canopy', material('ext-canopy', hex('#a9d1d0'), 0.9)],
        ['steel', material('ext-steel', hex('#596c68'), 0.5)],
        ['trunk', material('ext-trunk', hex('#766b59'), 0.1)],
        ['crown', material('ext-crown', hex('#527b50'), 0.08)],
        ['lampGlow', material('ext-lamp', [0, 0, 0], 0.2, hex('#f7edc9'))],
        ['carDark', material('ext-car-dark', hex('#202a2e'), 0.7)],
        ['carGrey', material('ext-car-grey', hex('#5c6665'), 0.7)],
        ['carSilver', material('ext-car-silver', hex('#a9aaa4'), 0.75)],
        ['carTeal', material('ext-car-teal', hex('#268f93'), 0.6)],
        ['cabin', material('ext-cabin', hex('#26383d'), 0.85)],
        ['tyre', material('ext-tyre', hex('#24292b'), 0.2)],
        ['unit', material('ext-unit', hex('#9aa3a3'), 0.35)],
        ['ball', material('ext-ball', hex('#d0d970'), 0.15)],
        ['ring', material('ext-ring', hex('#faf4d5'), 0.4)]
    ];
    const add = (name: string, builder: MeshBuilder, m: StandardMaterial) => {
        if (builder.empty) return;
        const entity = new Entity(`Exterior_${name}`);
        entity.addComponent('render', {
            meshInstances: [new MeshInstance(builder.build(app.graphicsDevice), m)],
            castShadows: false
        });
        root.addChild(entity);
    };
    for (const [key, m] of finishes) add(key, b[key], m);
    add('sign', sign, signMaterial);
    return root;
};
