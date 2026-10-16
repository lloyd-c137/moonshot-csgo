import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { COMBAT_AUDIO } from '../src/config/combatAudio.ts';

test('production combat clips match the approved selection, duration, gain and source hashes', () => {
    const root = new URL('../public/assets/audio/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('combat-provenance.json', root), 'utf8'));
    assert.equal(manifest.publication.status, 'OWNER_CONFIRMED_AUTHORIZED');
    assert.deepEqual(
        manifest.clips.map((clip) => clip.sourceClip),
        ['v10', 'v12', 'v16']
    );
    for (const clip of manifest.clips) {
        const config = COMBAT_AUDIO[clip.cue];
        assert.equal(config.url, `/assets/audio/${clip.file}`);
        assert.equal(config.start, 0);
        assert.equal(config.end, clip.duration);
        assert.equal(config.gain, 0.35);
        const bytes = readFileSync(new URL(clip.file, root));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
        assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    }
});
