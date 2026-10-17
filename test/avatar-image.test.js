import assert from 'node:assert/strict';
import test from 'node:test';

import { webpDimensions } from '../server/avatarImage.ts';

const vp8x = (width, height) => {
    const bytes = Buffer.alloc(30);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WEBP', 8);
    bytes.write('VP8X', 12);
    bytes.writeUInt32LE(10, 16);
    bytes.writeUIntLE(width - 1, 24, 3);
    bytes.writeUIntLE(height - 1, 27, 3);
    return bytes;
};

test('avatar gate reads dimensions from a complete extended WebP header', () => {
    assert.deepEqual(webpDimensions(vp8x(1024, 512)), { width: 1024, height: 512 });
});

test('avatar gate rejects truncated RIFF data and unknown image chunks', () => {
    assert.equal(webpDimensions(vp8x(1024, 512).subarray(0, 29)), null);
    const unknown = vp8x(1024, 512);
    unknown.write('JUNK', 12);
    assert.equal(webpDimensions(unknown), null);
});

test('avatar gate rejects inconsistent RIFF length', () => {
    const bytes = vp8x(64, 64);
    bytes.writeUInt32LE(10, 4);
    assert.equal(webpDimensions(bytes), null);
});
