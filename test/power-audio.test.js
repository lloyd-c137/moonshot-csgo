import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BLACKOUT_THEME_AUDIO } from '../src/config/blackoutThemeAudio.ts';
import { OPENING_THEME_AUDIO } from '../src/config/openingThemeAudio.ts';
import { POWER_DOWN_AUDIO } from '../src/config/powerAudio.ts';

test('owner-approved power-down buzzer matches its runtime config and provenance', () => {
    const root = new URL('../public/assets/audio/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('power-audio-provenance.json', root), 'utf8'));
    const [clip] = manifest.clips;
    assert.equal(manifest.publication.status, 'OWNER_CONFIRMED_AUTHORIZED');
    assert.deepEqual(manifest.events, ['four-minute blackout', 'manual breaker outage']);
    assert.equal(clip.file, 'buzzer.mp3');
    assert.equal(POWER_DOWN_AUDIO.url, `/assets/audio/${clip.file}`);
    assert.equal(POWER_DOWN_AUDIO.sha256, clip.sha256);
    assert.equal(POWER_DOWN_AUDIO.duration, clip.duration);
    assert.equal(POWER_DOWN_AUDIO.gain, clip.gain);
    const bytes = readFileSync(new URL(clip.file, root));
    assert.equal(bytes.byteLength, clip.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
});

test('owner-approved blackout theme matches its runtime config and provenance', () => {
    const root = new URL('../public/assets/audio/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('blackout-theme-provenance.json', root), 'utf8'));
    assert.equal(manifest.publication.status, 'OWNER_CONFIRMED_AUTHORIZED');
    assert.equal(manifest.runtimeFile, 'blackout-theme.mp3');
    assert.equal(BLACKOUT_THEME_AUDIO.url, `/assets/audio/${manifest.runtimeFile}`);
    assert.equal(BLACKOUT_THEME_AUDIO.duration, manifest.durationSeconds);
    assert.equal(BLACKOUT_THEME_AUDIO.fadeSeconds, 2);
    const bytes = readFileSync(new URL(manifest.runtimeFile, root));
    assert.equal(bytes.byteLength, manifest.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
    assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
});

test('owner-approved opening theme matches its runtime config and provenance', () => {
    const root = new URL('../public/assets/audio/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('opening-theme-provenance.json', root), 'utf8'));
    assert.equal(manifest.publication.status, 'OWNER_CONFIRMED_AUTHORIZED');
    assert.equal(manifest.runtimeFile, 'opening-theme.mp3');
    assert.equal(OPENING_THEME_AUDIO.url, `/assets/audio/${manifest.runtimeFile}`);
    assert.equal(OPENING_THEME_AUDIO.duration, manifest.durationSecondsEstimated);
    assert.equal(OPENING_THEME_AUDIO.fadeSeconds, 2);
    const bytes = readFileSync(new URL(manifest.runtimeFile, root));
    assert.equal(bytes.byteLength, manifest.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
    assert.equal(bytes.toString('ascii', 0, 3), 'ID3');
});
