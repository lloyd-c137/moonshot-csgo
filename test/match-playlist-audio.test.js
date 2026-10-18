import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MATCH_PLAYLIST_AUDIO } from '../src/config/matchPlaylistAudio.ts';

test('active-match playlist order, runtime config and authorized source manifests agree', () => {
    const root = new URL('../public/assets/audio/', import.meta.url);
    const manifests = ['ticking-away-provenance.json', 'die-for-you-provenance.json'].map((file) =>
        JSON.parse(readFileSync(new URL(file, root), 'utf8'))
    );
    assert.deepEqual(
        MATCH_PLAYLIST_AUDIO.map(({ name }) => name),
        ['ticking-away', 'die-for-you']
    );
    assert.deepEqual(
        MATCH_PLAYLIST_AUDIO.map(({ url }) => url),
        manifests.map(({ runtimeFile }) => `/assets/audio/${runtimeFile}`)
    );
    for (const manifest of manifests) {
        assert.equal(manifest.publication.status, 'OWNER_CONFIRMED_AUTHORIZED');
        const bytes = readFileSync(new URL(manifest.runtimeFile, root));
        assert.equal(bytes.byteLength, manifest.sizeBytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
        assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
    }
    assert.ok(MATCH_PLAYLIST_AUDIO.every(({ gain, fadeSeconds }) => gain === 0.18 && fadeSeconds === 2));
});
