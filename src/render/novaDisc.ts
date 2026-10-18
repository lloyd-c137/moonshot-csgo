// The 金飞盘's model: the NOVA DISC "24K pure gold" edition (owner-supplied design, 2026-10-19). A lathe of the
// designer's rim profile — domed top, rolled rim, flat underside — scaled to the game's disc radius, wrapped in
// the edition's canvas-drawn label (pinstripes and the NOVA ZERO wordmark), built once per app and shared.
import type { AppBase, GraphicsDevice } from 'playcanvas';
import {
    ADDRESS_CLAMP_TO_EDGE,
    ADDRESS_REPEAT,
    calculateNormals,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    Mesh,
    PIXELFORMAT_RGBA8,
    Texture
} from 'playcanvas';

import { DISC } from '../gameplay/frisbee.ts';

/** Rim profile (radius, height) from the source design, outer radius 1.52: top centre → rim → underside centre. */
export const NOVA_PROFILE: readonly (readonly [number, number])[] = [
    [0, 0.16],
    [0.5, 0.18],
    [1, 0.2],
    [1.3, 0.2],
    [1.45, 0.17],
    [1.52, 0.09],
    [1.49, -0.01],
    [1.4, -0.07],
    [1.1, -0.1],
    [0.6, -0.1],
    [0, -0.1]
];
const PROFILE_RADIUS = 1.52;
const PROFILE_BOTTOM = -0.1;
export const NOVA_SEGMENTS = 64;

/** The 24K pure gold finish: base, pinstripe and wordmark colours. */
export const NOVA_GOLD = { base: '#ffcf3f', accent: '#a87414', text: '#8a5a08' } as const;

/**
 * Lathe geometry (as three.js LatheGeometry: u around, v along the profile), scaled so the rim matches `radius`
 * and the underside sits at y = 0 like the ordinary disc.
 */
export const novaDiscGeometry = (radius: number = DISC.radius, segments = NOVA_SEGMENTS) => {
    const scale = radius / PROFILE_RADIUS;
    const count = NOVA_PROFILE.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const phi = (i / segments) * Math.PI * 2;
        const sin = Math.sin(phi);
        const cos = Math.cos(phi);
        NOVA_PROFILE.forEach(([r, y], j) => {
            positions.push(r * scale * sin, (y - PROFILE_BOTTOM) * scale, r * scale * cos);
            uvs.push(i / segments, j / (count - 1));
        });
    }
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < count - 1; j++) {
            const a = i * count + j;
            const b = a + count;
            const c = b + 1;
            const d = a + 1;
            // Counter-clockwise seen from outside (PlayCanvas front faces), so the computed normals point out.
            indices.push(a, d, b, c, b, d);
        }
    }
    return { positions, uvs, indices, normals: calculateNormals(positions, indices) };
};

/** The label: the source's 2048×512 canvas at half size (same layout), drawn in the 24K finish. */
const drawLabel = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const g = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    g.fillStyle = NOVA_GOLD.base;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = NOVA_GOLD.accent;
    g.lineWidth = 3;
    for (const v of [0.1, 0.17, 0.4, 0.47]) {
        g.beginPath();
        g.moveTo(0, v * h);
        g.lineTo(w, v * h);
        g.stroke();
    }
    g.fillStyle = NOVA_GOLD.accent;
    g.fillRect(0, 0.25 * h - 2, w, 1.5);
    g.fillStyle = NOVA_GOLD.text;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'italic 900 39px Arial, "Helvetica Neue", sans-serif';
    for (let i = 0; i < 4; i++) g.fillText('NOVA ZERO', w / 8 + (i * w) / 4, 0.32 * h);
    return canvas;
};

const createLabel = (device: GraphicsDevice) => {
    const texture = new Texture(device, {
        name: 'nova-disc-label',
        width: 1024,
        height: 256,
        format: PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_REPEAT,
        addressV: ADDRESS_CLAMP_TO_EDGE,
        anisotropy: 8
    });
    texture.setSource(drawLabel());
    return texture;
};

const built = new WeakMap<AppBase, { mesh: Mesh; label: Texture }>();

/** The shared golden-disc mesh and label texture (created on first use). */
export const novaDisc = (app: AppBase) => {
    let entry = built.get(app);
    if (!entry) {
        const shape = novaDiscGeometry();
        const mesh = new Mesh(app.graphicsDevice);
        mesh.setPositions(shape.positions);
        mesh.setNormals(shape.normals);
        mesh.setUvs(0, shape.uvs);
        mesh.setIndices(shape.indices);
        mesh.update();
        // Shared by every golden disc: never destroyed with an entity.
        mesh.incRefCount();
        entry = { mesh, label: createLabel(app.graphicsDevice) };
        built.set(app, entry);
    }
    return entry;
};
