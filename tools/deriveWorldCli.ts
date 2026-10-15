// Usage: npm run derive:world — regenerates public/assets/campus/derived/ from the source GLB and rooms.json.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

import { DERIVED_SCHEMA, deriveWorld } from './deriveWorld.ts';
import { encodePng } from './png.ts';

const directory = new URL('../public/assets/campus/derived/', import.meta.url);
mkdirSync(directory, { recursive: true });
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

const started = Date.now();
const { world, ceilingMask, minimap, sources } = deriveWorld();
const files: Record<string, Uint8Array> = {
    'world.json': Buffer.from(`${JSON.stringify(world)}\n`),
    'ceiling-mask.png': encodePng(ceilingMask),
    'minimap.png': encodePng(minimap)
};
for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, directory), data);
const manifest = {
    schema: DERIVED_SCHEMA,
    status: 'GAMEPLAY_AUTHORED',
    generator: 'tools/deriveWorld.ts',
    sources,
    outputs: Object.fromEntries(
        Object.entries(files).map(([name, data]) => [name, { bytes: data.length, sha256: sha256(data) }])
    )
};
writeFileSync(new URL('manifest.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
    JSON.stringify(
        {
            seconds: (Date.now() - started) / 1000,
            arenaOutlinePoints: world.arena.outline.length,
            doors: world.doors.length,
            furniture: world.furniture.length,
            collidingFurniture: world.furniture.filter((item) => item.collide).length,
            partitions: world.partitions.length,
            lights: world.lights.length,
            bytes: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, data.length]))
        },
        null,
        2
    )
);
