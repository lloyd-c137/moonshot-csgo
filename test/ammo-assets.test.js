import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const expected = new Map([
    ['ammo.js', 'ef166d1315bc4a6441a8de341ecdf6ac4e7d69055caec65c523ed1a4e8e19b15'],
    ['ammo.wasm.js', '5645b5a0c4f03be9d9d1ae604ffacd5e5e525310cfd1d0ed27474cdd1f34aab0'],
    ['ammo.wasm.wasm', 'a61b504d4a6ce6bb93bd843e0f61edb8115e7317f1b3462247031a83ddb25d09']
]);

test('official Ammo.js runtime files match their published SHA-256 values', async () => {
    for (const [filename, sha256] of expected) {
        const contents = await readFile(join(root, 'public', 'ammo', filename));
        assert.equal(createHash('sha256').update(contents).digest('hex'), sha256, filename);
    }
});

test('Ammo.js source and license notices are present', async () => {
    const [source, license] = await Promise.all([
        readFile(join(root, 'public', 'ammo', 'SOURCE.md'), 'utf8'),
        readFile(join(root, 'public', 'ammo', 'LICENSE'), 'utf8')
    ]);
    assert.match(source, /playcanvas\/engine/);
    assert.match(source, /zlib license/i);
    assert.match(license, /ammo\.js contributors/);
});
