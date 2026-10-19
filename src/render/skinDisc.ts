// Disc skins in the world: one shared mesh (the domed NOVA profile with a top-down planar UV, so the unwrapped skin
// art lies flat on the face), one material per skin edition (texture loaded on first use), and for the local
// player's 计数器 edition a live texture with the elimination count drawn on the counter plate.
import type { AppBase } from 'playcanvas';
import {
    ADDRESS_CLAMP_TO_EDGE,
    Color,
    CULLFACE_BACK,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    Mesh,
    MeshInstance,
    PIXELFORMAT_RGBA8,
    StandardMaterial,
    Texture
} from 'playcanvas';

import { skinById, skinTextureUrl } from '../config/skins.ts';
import type { Skin } from '../config/skins.ts';
import { DISC } from '../gameplay/frisbee.ts';

import { novaDiscGeometry } from './novaDisc.ts';

/** Planar UVs from above (x → u, z → v) over the disc's radius: the skin art is a top-down picture of the face. */
export const skinDiscGeometry = (radius: number = DISC.radius) => {
    const shape = novaDiscGeometry(radius);
    const uvs: number[] = [];
    for (let i = 0; i < shape.positions.length; i += 3) {
        uvs.push(0.5 + shape.positions[i] / (2 * radius), 0.5 + shape.positions[i + 2] / (2 * radius));
    }
    return { ...shape, uvs };
};

/** Glow that keeps a skin readable in a scene without reflections; light-emitting skins glow more. */
const GLOW: Record<string, number> = { neon: 0.75, magma: 0.7, glacier: 0.35, gilded: 0.4, classic: 0.3, pearl: 0.35 };

const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`skin texture ${url}`));
        image.src = url;
    });

/** The counter plate: a dark rounded slab with glowing digits along the skin's plate. */
export const drawCounter = (g: CanvasRenderingContext2D, size: number, skin: Skin, kills: number) => {
    const { x, y, length, thickness, angle, glow } = skin.counter;
    const w = length * size;
    const h = thickness * size;
    g.save();
    g.translate(x * size, y * size);
    g.rotate((angle * Math.PI) / 180);
    g.fillStyle = 'rgba(8, 12, 18, 0.92)';
    const r = h * 0.35;
    g.beginPath();
    g.moveTo(-w / 2 + r, -h / 2);
    g.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
    g.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
    g.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
    g.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
    g.closePath();
    g.fill();
    const colour = `rgb(${glow.map((c) => Math.round(c * 255)).join(',')})`;
    g.strokeStyle = colour;
    g.lineWidth = Math.max(1, h * 0.06);
    g.stroke();
    g.fillStyle = colour;
    g.shadowColor = colour;
    g.shadowBlur = h * 0.35;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(h * 0.72)}px "Barlow Condensed", "Arial Narrow", monospace`;
    g.fillText(String(Math.min(9999, kills)).padStart(kills > 999 ? 4 : 3, '0'), 0, h * 0.04);
    g.restore();
};

export const createSkinLibrary = (app: AppBase) => {
    const device = app.graphicsDevice;
    const shape = skinDiscGeometry();
    const mesh = new Mesh(device);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setUvs(0, shape.uvs);
    mesh.setIndices(shape.indices);
    mesh.update();
    mesh.incRefCount();

    const textureOf = (name: string) =>
        new Texture(device, {
            name,
            width: 4,
            height: 4,
            format: PIXELFORMAT_RGBA8,
            mipmaps: true,
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE,
            anisotropy: 4
        });
    const baseMaterial = (skin: Skin) => {
        const material = new StandardMaterial();
        material.name = `skin-${skin.id}`;
        // Until the picture arrives the disc shows the skin's main colour.
        material.diffuse = new Color(...skin.colours[0]);
        material.specular = new Color(0.6, 0.6, 0.6);
        material.gloss = 0.7;
        material.emissive = new Color(1, 1, 1);
        material.emissiveIntensity = 0;
        material.cull = CULLFACE_BACK;
        material.update();
        return material;
    };
    const useTexture = (material: StandardMaterial, skin: Skin, texture: Texture) => {
        material.diffuse = new Color(1, 1, 1);
        material.diffuseMap = texture;
        material.emissiveMap = texture;
        material.emissiveIntensity = GLOW[skin.id] ?? 0.22;
        material.update();
    };
    const materialFor = (skin: Skin, url: string) => {
        const material = baseMaterial(skin);
        const texture = textureOf(url);
        loadImage(url).then(
            (image) => {
                texture.setSource(image);
                useTexture(material, skin, texture);
            },
            () => undefined // keeps the plain colour
        );
        return material;
    };

    const materials = new Map<string, StandardMaterial>();
    /** Shared material of a skin edition. */
    const material = (skin: Skin, counter: boolean) => {
        const key = `${skin.id}:${counter}`;
        let entry = materials.get(key);
        if (!entry) {
            entry = materialFor(skin, skinTextureUrl(skin.id, counter));
            materials.set(key, entry);
        }
        return entry;
    };

    // The local player's 计数器 disc: the edition's picture with the live count drawn on the plate.
    let live: { key: string; canvas: HTMLCanvasElement; base: HTMLImageElement | null; texture: Texture; material: StandardMaterial; kills: number } | null =
        null;
    const paintLive = () => {
        if (!live?.base) return;
        const skin = skinById(live.key.split(':')[0])!;
        const g = live.canvas.getContext('2d')!;
        g.drawImage(live.base, 0, 0, live.canvas.width, live.canvas.height);
        drawCounter(g, live.canvas.width, skin, live.kills);
        live.texture.setSource(live.canvas);
        useTexture(live.material, skin, live.texture);
    };
    const liveMaterial = (skin: Skin, kills: number) => {
        const key = `${skin.id}:live`;
        if (live?.key !== key) {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 512;
            const texture = textureOf(`skin-live-${skin.id}`);
            const entry = { key, canvas, base: null as HTMLImageElement | null, texture, material: baseMaterial(skin), kills };
            live = entry;
            void loadImage(skinTextureUrl(skin.id, true)).then(
                (image) => {
                    if (live !== entry) return;
                    entry.base = image;
                    paintLive();
                },
                () => undefined
            );
        } else if (live.kills !== kills) {
            live.kills = kills;
            paintLive();
        }
        return live!.material;
    };

    return {
        mesh,
        /** Mesh instances for a thrown or held disc in `skinId` (null: unknown skin). */
        instances(skinId: string | null | undefined, counter = false): MeshInstance[] | null {
            const skin = skinById(skinId);
            return skin ? [new MeshInstance(mesh, material(skin, counter))] : null;
        },
        /** The local player's disc: with a 计数器, the plate shows `kills`. */
        localInstances(skinId: string | null | undefined, counter: boolean, kills: number): MeshInstance[] | null {
            const skin = skinById(skinId);
            if (!skin) return null;
            return [new MeshInstance(mesh, counter ? liveMaterial(skin, kills) : material(skin, false))];
        },
        /** Updates the local counter plate in place. */
        setLocalKills(kills: number) {
            if (!live || live.kills === kills) return;
            live.kills = kills;
            paintLive();
        }
    };
};

export type SkinLibrary = ReturnType<typeof createSkinLibrary>;
