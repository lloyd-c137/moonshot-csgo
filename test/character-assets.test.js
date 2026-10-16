import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const sourcePath = new URL('assets/source/characters/UAL1_Standard.fbx', root);
const runtimePath = new URL('public/assets/characters/moonshot-humanoid.glb', root);
const manifest = JSON.parse(readFileSync(new URL('public/assets/characters/manifest.json', root), 'utf8'));
const source = readFileSync(sourcePath);
const bytes = readFileSync(runtimePath);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function readGlb(buffer) {
    assert.equal(buffer.readUInt32LE(0), 0x46546c67, 'valid GLB magic');
    const jsonLength = buffer.readUInt32LE(12);
    const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
    const binaryStart = 28 + jsonLength;
    const binary = buffer.subarray(binaryStart, binaryStart + buffer.readUInt32LE(20 + jsonLength));
    const readAccessor = (index) => {
        const accessor = gltf.accessors[index];
        const view = gltf.bufferViews[accessor.bufferView];
        const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
        const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
        const stride = view.byteStride ?? width * size;
        const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const read =
            accessor.componentType === 5126
                ? (at) => binary.readFloatLE(at)
                : accessor.componentType === 5123
                  ? (at) => binary.readUInt16LE(at)
                  : accessor.componentType === 5121
                    ? (at) => binary.readUInt8(at)
                    : (at) => binary.readUInt32LE(at);
        return Array.from({ length: accessor.count }, (_, item) =>
            Array.from({ length: width }, (_, component) => read(start + item * stride + component * size))
        );
    };
    return { gltf, readAccessor };
}

test('published character derivative matches its CC0 source and manifest hashes', () => {
    assert.equal(sha256(source), manifest.source.sha256);
    assert.equal(sha256(bytes), manifest.runtime.sha256);
    assert.equal(manifest.source.license, 'CC0-1.0');
    assert.match(readFileSync(new URL('assets/source/characters/LICENSE.txt', root), 'utf8'), /CC0 1\.0 Universal/);
});

test('runtime model keeps the shared rig, body/head material split and complete head UVs', () => {
    const { gltf, readAccessor } = readGlb(bytes);
    const joints = gltf.skins[0].joints.map((index) => gltf.nodes[index].name);
    for (const name of [
        'Head',
        'neck_01',
        'spine_01',
        'spine_03',
        'hand_l',
        'hand_r',
        'thigh_l',
        'thigh_r',
        'foot_l',
        'foot_r'
    ]) {
        assert.ok(joints.includes(name), `has ${name} bone`);
    }

    const primitives = gltf.meshes.flatMap((mesh) => mesh.primitives);
    const materialNames = gltf.materials.map((material) => material.name);
    const head = primitives.find((primitive) => materialNames[primitive.material] === 'M_Head');
    assert.ok(head, 'head has its own material region');
    assert.ok(head.attributes.JOINTS_0 !== undefined && head.attributes.WEIGHTS_0 !== undefined, 'head stays skinned');
    const uv = readAccessor(head.attributes.TEXCOORD_0);
    const positions = readAccessor(head.attributes.POSITION);
    assert.ok(new Set(uv.map(([u, v]) => `${u.toFixed(3)},${v.toFixed(3)}`)).size > 100, 'head UVs are not collapsed');
    assert.ok(Math.min(...uv.map(([u]) => u)) < 0.5 && Math.max(...uv.map(([u]) => u)) > 1.0);
    assert.ok(Math.min(...uv.map(([, v]) => v)) <= 0.001 && Math.max(...uv.map(([, v]) => v)) >= 0.999);
    const minY = Math.min(...positions.map(([, y]) => y));
    const maxY = Math.max(...positions.map(([, y]) => y));
    // Blender's GLB exporter flips V when converting image-space UVs into glTF's coordinate convention.
    const meanUvHeightError =
        uv.reduce((sum, [, v], index) => sum + Math.abs(1 - v - (positions[index][1] - minY) / (maxY - minY)), 0) /
        uv.length;
    assert.ok(meanUvHeightError < 0.001, 'head UV vertical axis follows model height');
    const centerX = (Math.min(...positions.map(([x]) => x)) + Math.max(...positions.map(([x]) => x))) / 2;
    const centerZ = (Math.min(...positions.map(([, , z]) => z)) + Math.max(...positions.map(([, , z]) => z))) / 2;
    const meanAzimuthError =
        uv.reduce((sum, [u], index) => {
            const [, , z] = positions[index];
            const [x] = positions[index];
            const expected = (Math.atan2(x - centerX, z - centerZ) / (2 * Math.PI) + 1) % 1;
            const delta = ((u - expected + 1.5) % 1) - 0.5;
            return sum + Math.abs(delta);
        }, 0) / uv.length;
    assert.ok(meanAzimuthError < 0.001, 'head UV horizontal axis wraps around the head circumference');

    const triangles = primitives.reduce((sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3, 0);
    assert.equal(triangles, manifest.verified.triangles);
    assert.equal(joints.length, manifest.verified.joints);
});

test('runtime clips contain locomotion, jump, hit and death actions without root motion', () => {
    const { gltf, readAccessor } = readGlb(bytes);
    const clips = new Set(gltf.animations.map((animation) => animation.name.split('|').at(-1)));
    for (const name of [
        'Idle_Loop',
        'Walk_Loop',
        'Jog_Fwd_Loop',
        'Sprint_Loop',
        'Jump_Start',
        'Jump_Loop',
        'Jump_Land',
        'Hit_Chest',
        'Hit_Head',
        'Death01',
        'Idle_Torch_Loop'
    ]) {
        assert.ok(clips.has(name), `has ${name}`);
    }
    assert.equal(gltf.animations.length, manifest.verified.animationClips);

    const rootIndex = gltf.skins[0].joints.find((index) => gltf.nodes[index].name === 'root');
    assert.notEqual(rootIndex, undefined);
    let rootTranslationClips = 0;
    for (const animation of gltf.animations) {
        for (const channel of animation.channels) {
            if (channel.target.node !== rootIndex || channel.target.path !== 'translation') continue;
            rootTranslationClips++;
            const values = readAccessor(animation.samplers[channel.sampler].output);
            for (let axis = 0; axis < 3; axis++) {
                const extent =
                    Math.max(...values.map((value) => value[axis])) - Math.min(...values.map((value) => value[axis]));
                assert.ok(extent < 1e-5, `${animation.name} must not translate the root`);
            }
        }
    }
    assert.equal(rootTranslationClips, gltf.animations.length);
});
