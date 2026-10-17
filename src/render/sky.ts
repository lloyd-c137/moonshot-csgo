import type { AppBase, Entity } from 'playcanvas';
import {
    ADDRESS_CLAMP_TO_EDGE,
    ADDRESS_REPEAT,
    Color,
    CULLFACE_NONE,
    Entity as PcEntity,
    FILTER_LINEAR,
    MeshInstance,
    PIXELFORMAT_RGBA8,
    StandardMaterial,
    Texture
} from 'playcanvas';

import { MeshBuilder } from './meshBuilder';

/** Inside the player camera's 180 m far clip; the intro flyover scales the dome up while it runs. */
const RADIUS = 150;

/** Gradient sky with soft procedural clouds, painted once on a canvas (u = azimuth, v = elevation). */
const paintSky = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d')!;
    const gradient = g.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#3f78c4');
    gradient.addColorStop(0.42, '#86b4e6');
    gradient.addColorStop(0.5, '#d8e6f2');
    gradient.addColorStop(0.53, '#b9c3c8');
    gradient.addColorStop(1, '#8f9894');
    g.fillStyle = gradient;
    g.fillRect(0, 0, width, height);
    let seed = 1234567;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let i = 0; i < 70; i++) {
        const x = random() * width;
        const y = height * (0.12 + random() * 0.32);
        const r = 10 + random() * 30;
        for (let k = 0; k < 6; k++) {
            const dx = (random() - 0.5) * r * 3;
            const dy = (random() - 0.5) * r * 0.6;
            const blob = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            blob.addColorStop(0, 'rgba(255,255,255,0.32)');
            blob.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = blob;
            for (const wrap of [-width, 0, width]) g.fillRect(x + dx - r + wrap, y + dy - r, r * 2, r * 2);
        }
    }
    return canvas;
};

/**
 * Unlit sky dome that follows the camera. Visible above the open-air arena, courtyards and through entrances;
 * it adds no image-based lighting to interiors.
 */
export const createSkyDome = (app: AppBase, camera: Entity) => {
    const texture = new Texture(app.graphicsDevice, {
        name: 'sky-gradient',
        format: PIXELFORMAT_RGBA8,
        width: 1024,
        height: 512,
        mipmaps: false,
        addressU: ADDRESS_REPEAT,
        addressV: ADDRESS_CLAMP_TO_EDGE,
        minFilter: FILTER_LINEAR,
        magFilter: FILTER_LINEAR
    });
    texture.setSource(paintSky(1024, 512));

    const builder = new MeshBuilder();
    const rings = 24;
    const segments = 48;
    for (let j = 0; j <= rings; j++) {
        const elevation = Math.PI / 2 - (j / rings) * Math.PI;
        for (let i = 0; i <= segments; i++) {
            const azimuth = (i / segments) * Math.PI * 2;
            const x = Math.cos(elevation) * Math.cos(azimuth);
            const y = Math.sin(elevation);
            const z = Math.cos(elevation) * Math.sin(azimuth);
            // PlayCanvas samples V = 0 at the first image row (the zenith colour).
            builder.vertex([x * RADIUS, y * RADIUS, z * RADIUS], [-x, -y, -z], [i / segments, j / rings]);
        }
    }
    for (let j = 0; j < rings; j++) {
        for (let i = 0; i < segments; i++) {
            const a = j * (segments + 1) + i;
            const b = a + segments + 1;
            builder.triangle(a, b, a + 1);
            builder.triangle(a + 1, b, b + 1);
        }
    }
    const material = new StandardMaterial();
    material.name = 'sky';
    material.useLighting = false;
    material.useFog = false;
    material.useSkybox = false;
    material.diffuse = new Color(0, 0, 0);
    material.emissive = new Color(1, 1, 1);
    material.emissiveMap = texture;
    material.cull = CULLFACE_NONE;
    material.update();

    const dome = new PcEntity('sky-dome');
    dome.addComponent('render', {
        meshInstances: [new MeshInstance(builder.build(app.graphicsDevice), material)],
        castShadows: false,
        receiveShadows: false
    });
    app.root.addChild(dome);
    app.on('update', () => dome.setPosition(camera.getPosition()));
    return dome;
};
