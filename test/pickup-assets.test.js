import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));

test('pickup model manifest matches complete GLB assets and records provenance', async () => {
    const manifest = JSON.parse(await read('public/assets/pickups/manifest.json'));
    assert.equal(manifest.models.length, 4);

    for (const source of manifest.sources) {
        const bytes = await read(`assets/source/pickups/${source.archive}`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, `${source.archive} source SHA-256`);
    }

    for (const model of manifest.models) {
        const assetPath = `public${model.path}`;
        const bytes = await read(assetPath);
        assert.equal(bytes.length, model.bytes, `${model.name} byte count`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), model.sha256, `${model.name} SHA-256`);
        assert.equal(bytes.toString('ascii', 0, 4), 'glTF', `${model.name} GLB magic`);
        assert.equal(bytes.readUInt32LE(4), 2, `${model.name} GLB version`);
        assert.equal(bytes.readUInt32LE(8), bytes.length, `${model.name} GLB length`);

        const jsonLength = bytes.readUInt32LE(12);
        assert.equal(bytes.toString('ascii', 16, 20), 'JSON', `${model.name} JSON chunk`);
        const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
        assert.ok(gltf.nodes?.length, `${model.name} has nodes`);
        assert.ok(gltf.meshes?.some((mesh) => mesh.primitives?.length), `${model.name} has renderable geometry`);
        assert.ok(gltf.materials?.length, `${model.name} has materials`);
        assert.ok(model.triangles > 0, `${model.name} triangle count`);
        assert.ok(model.heightMeters >= 0.6 && model.heightMeters <= 0.8, `${model.name} gameplay scale`);
        assert.ok(model.boundsMeters?.length === 3 && model.boundsMeters.every((value) => value > 0 && value <= 1.1), `${model.name} normalized bounds`);
        assert.match(model.source, /^https:\/\/opengameart\.org\/content\//);
        assert.ok(model.author && model.license, `${model.name} attribution`);
    }

    const gear = manifest.models.find((model) => model.name === 'creation-gear');
    assert.equal(gear.license, 'CC-BY-SA-4.0');
    const gearLicense = (await read('public/assets/pickups/LICENSE-creation-gear.txt')).toString();
    assert.match(gearLicense, /Elegant Crow/);
    assert.match(gearLicense, /CC BY-SA 4\.0/);
    assert.match(gearLicense, /https:\/\/opengameart\.org\/content\/gear-pack/);

    const monitor = manifest.models.find((model) => model.name === 'eye-monitor');
    assert.ok(monitor.boundsMeters[0] > monitor.heightMeters, 'the monitor is upright after converting its Z-up source');
    assert.ok(monitor.boundsMeters[2] < monitor.heightMeters, 'the monitor screen depth remains thin');
});
