import type { GraphicsDevice } from 'playcanvas';
import { ADDRESS_REPEAT, FILTER_LINEAR, FILTER_LINEAR_MIPMAP_LINEAR, PIXELFORMAT_RGBA8, Texture } from 'playcanvas';

// Small procedural tiling textures drawn on a canvas at startup (no external image assets or licences).
// Each texture covers `metres` × `metres` of world space; geometry UVs are in metres.

type Painter = (g: CanvasRenderingContext2D, size: number, random: () => number) => void;

const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
};

const hex = (r: number, g: number, b: number) =>
    `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

const speckle = (g: CanvasRenderingContext2D, size: number, random: () => number, count: number, alpha: number) => {
    for (let i = 0; i < count; i++) {
        const shade = random() > 0.5 ? 255 : 0;
        g.fillStyle = `rgba(${shade},${shade},${shade},${alpha * random()})`;
        g.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }
};

export const PAINTERS: Record<string, { metres: number; paint: Painter }> = {
    terrazzo: {
        metres: 1.2,
        paint: (g, size, random) => {
            g.fillStyle = hex(0.8, 0.79, 0.76);
            g.fillRect(0, 0, size, size);
            speckle(g, size, random, 2600, 0.35);
            g.strokeStyle = 'rgba(0,0,0,0.12)';
            g.lineWidth = 2;
            g.strokeRect(0, 0, size, size);
        }
    },
    wood: {
        metres: 1.6,
        paint: (g, size, random) => {
            const planks = 8;
            for (let i = 0; i < planks; i++) {
                const tone = 0.62 + random() * 0.1;
                g.fillStyle = hex(tone, tone * 0.78, tone * 0.56);
                g.fillRect(0, (i * size) / planks, size, size / planks);
                for (let k = 0; k < 40; k++) {
                    g.strokeStyle = `rgba(80,50,20,${0.05 + random() * 0.08})`;
                    g.beginPath();
                    const y = ((i + random()) * size) / planks;
                    g.moveTo(0, y);
                    g.lineTo(size, y + (random() - 0.5) * 4);
                    g.stroke();
                }
                g.fillStyle = 'rgba(40,25,10,0.35)';
                g.fillRect(0, (i * size) / planks, size, 1.5);
                g.fillRect(
                    ((i * 37) % planks) * (size / planks) + random() * 10,
                    (i * size) / planks,
                    2,
                    size / planks
                );
            }
        }
    },
    tile: {
        metres: 0.6,
        paint: (g, size, random) => {
            g.fillStyle = hex(0.88, 0.89, 0.9);
            g.fillRect(0, 0, size, size);
            speckle(g, size, random, 500, 0.12);
            g.strokeStyle = 'rgba(90,95,100,0.45)';
            g.lineWidth = 3;
            g.strokeRect(0, 0, size, size);
        }
    },
    carpet: {
        metres: 1,
        paint: (g, size, random) => {
            g.fillStyle = hex(0.46, 0.5, 0.56);
            g.fillRect(0, 0, size, size);
            speckle(g, size, random, 6000, 0.25);
        }
    },
    ceiling: {
        metres: 1.2,
        paint: (g, size, random) => {
            g.fillStyle = hex(0.93, 0.93, 0.92);
            g.fillRect(0, 0, size, size);
            speckle(g, size, random, 2500, 0.08);
            g.fillStyle = hex(0.8, 0.8, 0.8);
            g.fillRect(0, 0, size, 3);
            g.fillRect(0, 0, 3, size);
            g.fillRect(0, size / 2 - 1, size, 2);
            g.fillRect(size / 2 - 1, 0, 2, size);
        }
    },
    court: {
        metres: 2,
        paint: (g, size, random) => {
            const boards = 12;
            for (let i = 0; i < boards; i++) {
                const tone = 0.72 + random() * 0.06;
                g.fillStyle = hex(tone, tone * 0.72, tone * 0.45);
                g.fillRect((i * size) / boards, 0, size / boards, size);
            }
            speckle(g, size, random, 1500, 0.08);
        }
    },
    plaster: {
        metres: 2,
        paint: (g, size, random) => {
            g.fillStyle = hex(0.94, 0.93, 0.9);
            g.fillRect(0, 0, size, size);
            speckle(g, size, random, 3000, 0.05);
        }
    },
    laminate: {
        metres: 1,
        paint: (g, size, random) => {
            g.fillStyle = hex(0.86, 0.82, 0.74);
            g.fillRect(0, 0, size, size);
            speckle(g, size, random, 1200, 0.06);
        }
    }
};

export const createTexture = (device: GraphicsDevice, name: keyof typeof PAINTERS, seed = 7, size = 256) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d')!;
    PAINTERS[name].paint(context, size, seeded(seed));
    const texture = new Texture(device, {
        name: `procedural-${name}`,
        format: PIXELFORMAT_RGBA8,
        width: size,
        height: size,
        mipmaps: true,
        addressU: ADDRESS_REPEAT,
        addressV: ADDRESS_REPEAT,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: FILTER_LINEAR,
        anisotropy: 8
    });
    texture.setSource(canvas);
    return { texture, metres: PAINTERS[name].metres };
};
