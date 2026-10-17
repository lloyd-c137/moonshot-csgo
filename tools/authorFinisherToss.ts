// Authors THE TOSS finisher clips (owner brief 2026-10-17) straight into the runtime character GLB, without Blender:
// the attacker walks up behind an unaware target tossing the disc overhead, catches it, throws it forward; it loops
// out and back and takes the target down. Built by blending, in glTF bone space, the CC0 rig's own Walk_Loop and
// Idle_Loop with the key poses of the Blender-authored Boomerang clips (overhead flip, cross-body wind-up, release
// follow-through, recovery; victim recoil and collapse). In place (root translation zero); the runtime moves actors.
//
// Usage: node tools/authorFinisherToss.ts   (rewrites public/assets/characters/moonshot-humanoid.glb + manifest)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { TOSS, tossArmKeys, tossVictimKeys, tossWalkWeight } from '../src/gameplay/finisher/tossTimeline.ts';

type Quat = [number, number, number, number];
type Vec = number[];
type Gltf = {
    nodes: { name?: string }[];
    accessors: {
        bufferView: number;
        byteOffset?: number;
        componentType: number;
        count: number;
        type: string;
        min?: number[];
        max?: number[];
    }[];
    bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
    buffers: { byteLength: number }[];
    animations: {
        name: string;
        channels: { sampler: number; target: { node: number; path: string } }[];
        samplers: { input: number; output: number; interpolation?: string }[];
    }[];
    skins: { joints: number[] }[];
};

const glbPath = new URL('../public/assets/characters/moonshot-humanoid.glb', import.meta.url);
const manifestPath = new URL('../public/assets/characters/manifest.json', import.meta.url);
const NAMES = { attacker: 'Finisher_Toss_Attacker', victim: 'Finisher_Toss_Victim' } as const;

const file = readFileSync(glbPath);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.toString('utf8', 20, 20 + jsonLength)) as Gltf;
const binStart = 20 + jsonLength + 8;
const binLength = file.readUInt32LE(20 + jsonLength);
let bin = Buffer.from(file.subarray(binStart, binStart + binLength));
if (gltf.animations.some((a) => Object.values(NAMES).includes(a.name as never)))
    throw new Error('The Toss clips are already in the GLB; restore it from git before re-authoring');

const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>;
const read = (index: number) => {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const w = width[accessor.type];
    const stride = view.byteStride ?? w * 4;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    return Array.from({ length: accessor.count }, (_, i) =>
        Array.from({ length: w }, (_, c) => bin.readFloatLE(start + i * stride + c * 4))
    );
};

const normalize = (q: Vec): Quat => {
    const l = Math.hypot(...q) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
const slerp = (a: Quat, b: Quat, t: number): Quat => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const bb = d < 0 ? (b.map((v) => -v) as Quat) : b;
    d = Math.abs(d);
    if (d > 0.9995) return normalize(a.map((v, i) => v + (bb[i] - v) * t));
    const theta = Math.acos(d),
        s = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / s,
        wb = Math.sin(t * theta) / s;
    return normalize(a.map((v, i) => v * wa + bb[i] * wb));
};
const lerp = (a: Vec, b: Vec, t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** Samples one clip's channel for `node`/`path` at time t (LINEAR or STEP). */
const clip = (suffix: string) => {
    const animation = gltf.animations.find((a) => a.name.split('|').at(-1) === suffix);
    if (!animation) throw new Error(`No clip ${suffix}`);
    const cache = new Map<string, { times: number[]; values: Vec[]; step: boolean }>();
    for (const channel of animation.channels) {
        const sampler = animation.samplers[channel.sampler];
        cache.set(`${channel.target.node}:${channel.target.path}`, {
            times: read(sampler.input).map(([t]) => t),
            values: read(sampler.output),
            step: sampler.interpolation === 'STEP'
        });
    }
    const duration = Math.max(...[...cache.values()].map((c) => c.times.at(-1) ?? 0));
    return {
        duration,
        sample(node: number, path: 'rotation' | 'translation', t: number): Vec | null {
            const c = cache.get(`${node}:${path}`);
            if (!c) return null;
            if (t <= c.times[0] || c.times.length === 1) return c.values[0];
            if (t >= c.times.at(-1)!) return c.values.at(-1)!;
            let i = 0;
            while (i < c.times.length - 2 && t > c.times[i + 1]) i++;
            if (c.step) return c.values[i];
            const u = (t - c.times[i]) / (c.times[i + 1] - c.times[i]);
            return path === 'rotation'
                ? slerp(c.values[i] as Quat, c.values[i + 1] as Quat, u)
                : lerp(c.values[i], c.values[i + 1], u);
        }
    };
};

const idle = clip('Idle_Loop');
const walk = clip('Walk_Loop');
const boomerangA = clip('Finisher_Boomerang_Attacker');
const boomerangV = clip('Finisher_Boomerang_Victim');
const joints = gltf.skins[0].joints;
const nodeName = (index: number) => gltf.nodes[index].name ?? '';
const rootNode = joints.find((j) => nodeName(j) === 'root')!;

/** Upper-body bones the arm performance drives; the rest follow walk/idle. */
const UPPER = new Set([
    'spine_02',
    'spine_03',
    'neck_01',
    'Head',
    'clavicle_r',
    'upperarm_r',
    'lowerarm_r',
    'hand_r',
    'clavicle_l',
    'upperarm_l',
    'lowerarm_l',
    'hand_l'
]);
const smooth = (u: number) => u * u * (3 - 2 * u);

/** A pose source at a time: 'base' (walk/idle body) or a Boomerang key frame (30 fps frame number). */
const poseAt = (
    keys: readonly (readonly [number, number | 'base', number?])[],
    source: ReturnType<typeof clip>,
    node: number,
    frame: number,
    base: Quat
): Quat => {
    let i = 0;
    while (i < keys.length - 2 && frame > keys[i + 1][0]) i++;
    const [f0, p0, w0 = 1] = keys[i],
        [f1, p1, w1 = 1] = keys[Math.min(i + 1, keys.length - 1)];
    const resolve = (pose: number | 'base', w: number): Quat => {
        if (pose === 'base') return base;
        const q = source.sample(node, 'rotation', (pose - 1) / TOSS.fps) as Quat | null;
        return q ? slerp(base, q, w) : base;
    };
    const u = f1 === f0 ? 1 : smooth(Math.max(0, Math.min(1, (frame - f0) / (f1 - f0))));
    return slerp(resolve(p0, w0), resolve(p1, w1), u);
};

const author = (role: 'attacker' | 'victim') => {
    const frames = TOSS.frames;
    const times = Array.from({ length: frames + 1 }, (_, f) => f / TOSS.fps);
    const channels: { node: number; path: 'rotation' | 'translation'; values: Vec[] }[] = [];
    for (const node of joints) {
        const rotations: Vec[] = [],
            translations: Vec[] = [];
        for (let f = 0; f <= frames; f++) {
            const t = f / TOSS.fps;
            const idleQ = idle.sample(node, 'rotation', t % idle.duration || 0) as Quat;
            const idleT = idle.sample(node, 'translation', t % idle.duration || 0) ?? [0, 0, 0];
            let body = idleQ,
                bodyT = idleT;
            if (role === 'attacker') {
                const w = tossWalkWeight(f);
                const walkQ = walk.sample(node, 'rotation', (t * TOSS.walkCadence) % walk.duration) as Quat;
                const walkT = walk.sample(node, 'translation', (t * TOSS.walkCadence) % walk.duration) ?? idleT;
                body = slerp(idleQ, walkQ, w);
                bodyT = lerp(idleT, walkT, w);
            }
            let q = body;
            if (role === 'attacker' && UPPER.has(nodeName(node))) q = poseAt(tossArmKeys, boomerangA, node, f, body);
            if (role === 'victim') q = poseAt(tossVictimKeys, boomerangV, node, f, body);
            rotations.push(q);
            translations.push(node === rootNode ? [0, 0, 0] : bodyT);
        }
        channels.push(
            { node, path: 'rotation', values: rotations },
            { node, path: 'translation', values: translations }
        );
    }
    return { name: NAMES[role], times, channels };
};

// Append accessors (one buffer view each, like the exporter) and the two animations.
const appendFloats = (values: Vec[], type: 'SCALAR' | 'VEC3' | 'VEC4') => {
    const data = Buffer.alloc(values.length * values[0].length * 4);
    values.flat().forEach((v, i) => data.writeFloatLE(v, i * 4));
    const pad = (4 - (bin.length % 4)) % 4;
    if (pad) bin = Buffer.concat([bin, Buffer.alloc(pad)]);
    gltf.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: data.length });
    bin = Buffer.concat([bin, data]);
    const accessor: Gltf['accessors'][number] = {
        bufferView: gltf.bufferViews.length - 1,
        componentType: 5126,
        count: values.length,
        type
    };
    if (type === 'SCALAR') {
        accessor.min = [Math.min(...values.map((v) => v[0]))];
        accessor.max = [Math.max(...values.map((v) => v[0]))];
    }
    gltf.accessors.push(accessor);
    return gltf.accessors.length - 1;
};
for (const role of ['attacker', 'victim'] as const) {
    const authored = author(role);
    const input = appendFloats(
        authored.times.map((t) => [t]),
        'SCALAR'
    );
    const animation: Gltf['animations'][number] = { name: authored.name, channels: [], samplers: [] };
    for (const channel of authored.channels) {
        const output = appendFloats(channel.values, channel.path === 'rotation' ? 'VEC4' : 'VEC3');
        animation.samplers.push({ input, output, interpolation: 'LINEAR' });
        animation.channels.push({
            sampler: animation.samplers.length - 1,
            target: { node: channel.node, path: channel.path }
        });
    }
    gltf.animations.push(animation);
}
gltf.buffers[0].byteLength = bin.length;
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
const chunk = (type: number, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
};
const out = Buffer.concat([header, chunk(0x4e4f534a, jsonPadded), chunk(0x004e4942, binPadded)]);
writeFileSync(glbPath, out);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.runtime.sha256 = createHash('sha256').update(out).digest('hex');
manifest.runtime.bytes = out.length;
manifest.runtime.generator = `${manifest.runtime.generator.split(' + tools/authorFinisherToss.ts')[0]} + tools/authorFinisherToss.ts`;
manifest.verified.animationClips = gltf.animations.length;
manifest.toss = {
    name: 'THE TOSS',
    actions: [NAMES.attacker, NAMES.victim],
    durationSeconds: TOSS.frames / TOSS.fps,
    fps: TOSS.fps,
    generator: 'tools/authorFinisherToss.ts (blend of Walk_Loop, Idle_Loop and the Boomerang key poses; no Blender)',
    rootTranslation: false
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
console.log(`Authored ${NAMES.attacker}, ${NAMES.victim}: ${out.length} bytes, ${gltf.animations.length} clips`);
