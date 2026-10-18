import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

// The game downloads these gzip copies (src/world/glbBytes.ts); a stale copy would ship an old model.
for (const file of ['public/assets/campus/MAC_Campus_FF01.glb', 'public/assets/characters/moonshot-humanoid.glb']) {
    test(`${file}.gz matches the GLB (run npm run assets:compress after changing it)`, () => {
        const source = readFileSync(new URL(`../${file}`, import.meta.url));
        const copy = gunzipSync(readFileSync(new URL(`../${file}.gz`, import.meta.url)));
        assert.ok(copy.equals(source), `${file}.gz is out of date`);
    });
}
