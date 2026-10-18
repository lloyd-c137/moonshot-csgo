// Writes the gzip copies the game downloads instead of the large GLBs (Cloudflare Pages serves model/gltf-binary
// uncompressed). Run after changing either model: npm run assets:compress. test/compressed-assets.test.js checks
// that every copy still matches its source.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export const COMPRESSED_GLBS = ['public/assets/campus/MAC_Campus_FF01.glb', 'public/assets/characters/moonshot-humanoid.glb'];

for (const file of COMPRESSED_GLBS) {
    const source = readFileSync(file);
    // Node writes a zero mtime in the gzip header, so the copy is reproducible byte for byte.
    const packed = gzipSync(source, { level: 9 });
    writeFileSync(`${file}.gz`, packed);
    console.log(`${file}.gz  ${(source.length / 1e6).toFixed(2)} MB → ${(packed.length / 1e6).toFixed(2)} MB`);
}
