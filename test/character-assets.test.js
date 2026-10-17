import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Entity } from 'playcanvas';

import { characterMaterialColour } from '../src/characters/CharacterAssetLoader.ts';
import {
    createFrisbeeThrowTrack,
    FRISBEE_THROW_DURATION,
    FRISBEE_THROW_RELEASE_OFFSET,
    FRISBEE_THROW_REMAINING
} from '../src/characters/frisbeeThrowTrack.ts';
import { attachHeldItemSocket, RIGHT_HAND_SOCKET_POSITION } from '../src/characters/heldItemSocket.ts';

const root = new URL('../', import.meta.url);
const sourcePath = new URL('assets/source/characters/UAL1_Standard.fbx', root);
const runtimePath = new URL('public/assets/characters/moonshot-humanoid.glb', root);
const finisherSourcePath = new URL('assets/source/characters/Finisher_Boomerang.blend', root);
const manifest = JSON.parse(readFileSync(new URL('public/assets/characters/manifest.json', root), 'utf8'));
const source = readFileSync(sourcePath);
const bytes = readFileSync(runtimePath);
const finisherSource = readFileSync(finisherSourcePath);
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

test('paired finisher source and runtime clips are versioned and distinct', () => {
    assert.equal(sha256(finisherSource), manifest.finisher.authoringSceneSha256);
    assert.equal(finisherSource.byteLength, manifest.finisher.authoringSceneBytes);
    const { gltf, readAccessor } = readGlb(bytes);
    for (const name of manifest.finisher.actions) {
        const action = gltf.animations.find((animation) => animation.name === name);
        assert.ok(action, `runtime has ${name}`);
        assert.ok(action.channels.length >= 190, `${name} is a baked full-body rig action`);
        const duration = Math.max(...action.samplers.map((sampler) => gltf.accessors[sampler.input].max[0]));
        assert.ok(duration >= 2.59 && duration <= 2.61, `${name} spans the 2.6 second film`);
        const channels = action.channels.map((channel) => `${gltf.nodes[channel.target.node].name}:${channel.target.path}`);
        assert.ok(channels.some((channel) => channel === 'upperarm_r:rotation'));
        assert.ok(channels.some((channel) => channel === 'Head:rotation'));
        const root = gltf.skins[0].joints.find((index) => gltf.nodes[index].name === 'root');
        const translation = action.channels.find(
            (channel) => channel.target.node === root && channel.target.path === 'translation'
        );
        assert.ok(translation, `${name} carries an explicit in-place root channel`);
        const rootValues = readAccessor(action.samplers[translation.sampler].output);
        assert.ok(rootValues.every((value) => value.every((axis) => Math.abs(axis) < 1e-5)));
    }
    const [attacker, victim] = manifest.finisher.actions.map((name) =>
        gltf.animations.find((animation) => animation.name === name)
    );
    const actionSignature = (action) =>
        action.samplers
            .map((sampler) => JSON.stringify(readAccessor(sampler.output).map((value) => value.map((x) => x.toFixed(5)))))
            .join('|');
    assert.notEqual(actionSignature(attacker), actionSignature(victim), 'attacker and target have different poses');
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

test('right-hand grip animation covers every finger used by held props', () => {
    const { gltf } = readGlb(bytes);
    const grip = gltf.animations.find((animation) => animation.name.endsWith('Pistol_Idle_Loop'));
    assert.ok(grip, 'has the source hand-held grip pose');
    const nodes = new Set(grip.channels.map((channel) => gltf.nodes[channel.target.node].name));
    for (const name of ['thumb_01_r', 'index_01_r', 'middle_01_r', 'ring_01_r', 'pinky_01_r']) {
        assert.ok(nodes.has(name), `grip pose animates ${name}`);
    }
});

test('all mannequin joint regions default to white unless a role explicitly overrides them', () => {
    assert.deepEqual(characterMaterialColour('M_Joints', [0.1, 0.4, 0.8]), [1, 1, 1]);
    assert.deepEqual(characterMaterialColour('M_Joints', [0, 0, 0], { M_Joints: [1, 1, 1] }), [1, 1, 1]);
    assert.deepEqual(characterMaterialColour('M_Main', [0.1, 0.4, 0.8]), [0.1, 0.4, 0.8]);
});

test('held props share one palm socket positioned at the fingers rather than through the fist', () => {
    const character = new Entity('character');
    const hand = new Entity('hand_r');
    character.addChild(hand);
    const socket = attachHeldItemSocket(character, 'held-item-socket');
    assert.equal(socket.parent, hand);
    assert.deepEqual(socket.getLocalPosition().toArray(), [...RIGHT_HAND_SOCKET_POSITION]);
});

test('the authored frisbee release track is an upper-body, non-root-motion action', () => {
    const track = createFrisbeeThrowTrack();
    assert.equal(track.name, 'Frisbee_Throw');
    assert.equal(track.duration, 0.72);
    assert.equal(FRISBEE_THROW_DURATION, 0.72);
    assert.ok(FRISBEE_THROW_RELEASE_OFFSET > 0 && FRISBEE_THROW_RELEASE_OFFSET < 1);
    assert.ok(FRISBEE_THROW_REMAINING > 0 && FRISBEE_THROW_REMAINING < FRISBEE_THROW_DURATION);
    assert.equal(track.inputs[0].components, 1);
    assert.deepEqual([...track.inputs[0].data], [0, 0.09, 0.18, 0.28, 0.43, 0.58, 0.72]);
    assert.equal(track.curves.length, 5);
    const paths = track.curves.map((curve) => curve.paths[0].entityPath.join('/'));
    assert.ok(paths.some((path) => path.endsWith('/spine_03')));
    assert.ok(paths.some((path) => path.endsWith('/clavicle_r/upperarm_r')));
    assert.ok(paths.some((path) => path.endsWith('/lowerarm_r/hand_r')));
    assert.ok(paths.some((path) => path.endsWith('/clavicle_l/upperarm_l')));
    assert.ok(paths.every((path) => !path.endsWith('/root') && !path.endsWith('/pelvis')));
    for (const output of track.outputs)
        for (let index = 0; index < output.data.length; index += 4) {
            const norm = Math.hypot(...Array.from(output.data.slice(index, index + 4)));
            assert.ok(Math.abs(norm - 1) < 1e-5, `unit quaternion at sample ${index / 4}`);
        }
});
