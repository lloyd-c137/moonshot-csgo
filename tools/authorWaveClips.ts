// Authors the ceremony wave clips straight into the runtime character GLB, without Blender: Walk_Wave_Loop (walking
// in while waving to the crowd) and Idle_Wave_Loop (standing on the mark, still waving). The body is the CC0 rig's
// own Walk_Loop / Idle_Loop; the right arm pumps around the raised Pistol_Aim_Up pose, while the right fingers use
// the open-hand A_TPose. The raised pose points the hand nearly vertically and turns the thumb toward the torso.
// In place (root translation zero); the
// runtime moves the actors.
//
// Usage: node tools/authorWaveClips.ts   (rewrites public/assets/characters/moonshot-humanoid.glb + manifest)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';


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
const NAMES = { walk: 'Walk_Wave_Loop', idle: 'Idle_Wave_Loop' } as const;

const file = readFileSync(glbPath);
const jsonLength = file.readUInt32LE(12);
const gltf = JSON.parse(file.toString('utf8', 20, 20 + jsonLength)) as Gltf;
const binStart = 20 + jsonLength + 8;
const binLength = file.readUInt32LE(20 + jsonLength);
let bin = Buffer.from(file.subarray(binStart, binStart + binLength));

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
const openPalm = clip('A_TPose');
const raisedArm = clip('Pistol_Aim_Up');
const joints = gltf.skins[0].joints;
const nodeName = (index: number) => gltf.nodes[index].name ?? '';
const rootNode = joints.find((j) => nodeName(j) === 'root')!;

const FPS = 30;
/** One walk cycle (looped), and an idle wave of two full waves. */
const WALK_SECONDS = walk.duration;
const IDLE_SECONDS = 2;
/** Waves per second while walking / standing. */
const WAVE_RATE = 1.6;
/** How high the arm sits on the base→overhead arc (top and bottom of the wave), per bone. */
const ARM: Record<string, [number, number]> = {
    clavicle_r: [0.98, 0.92],
    upperarm_r: [1, 0.94],
    lowerarm_r: [0.96, 0.9],
    hand_r: [0.96, 0.88]
};
/** Keep the raised waving hand open instead of inheriting the relaxed, curled fingers. */
const RIGHT_FINGER = /^(thumb|index|middle|ring|pinky)_\d+_(?:leaf_)?r$/;
/** Carry the raised-arm shoulder line through the chest; keep the head near the crowd-facing body pose. */
const TORSO: Record<string, number> = { spine_02: 0.82, spine_03: 0.9, neck_01: 0.18, Head: 0.12 };

const author = (kind: 'walk' | 'idle') => {
    const seconds = kind === 'walk' ? WALK_SECONDS : IDLE_SECONDS;
    const frames = Math.max(2, Math.round(seconds * FPS));
    const times = Array.from({ length: frames + 1 }, (_, f) => (f / frames) * seconds);
    const channels: { node: number; path: 'rotation' | 'translation'; values: Vec[] }[] = [];
    for (const node of joints) {
        const name = nodeName(node);
        const rotations: Vec[] = [],
            translations: Vec[] = [];
        for (const t of times) {
            const source = kind === 'walk' ? walk : idle;
            const local = t % source.duration || 0;
            const body = source.sample(node, 'rotation', local) as Quat;
            const bodyT = source.sample(node, 'translation', local) ?? [0, 0, 0];
            let q = body;
            const high = raisedArm.sample(node, 'rotation', 0) as Quat | null;
            const torsoPose = raisedArm.sample(node, 'rotation', 0) as Quat | null;
            if (RIGHT_FINGER.test(name)) {
                q = openPalm.sample(node, 'rotation', 0) as Quat;
            } else if (high && ARM[name]) {
                // The loop must close: the wave rate is rounded to whole waves over the clip.
                const waves = Math.max(1, Math.round(seconds * WAVE_RATE));
                const phase = 0.5 + 0.5 * Math.cos((2 * Math.PI * waves * t) / seconds);
                const [top, bottom] = ARM[name];
                q = slerp(body, high, bottom + (top - bottom) * phase);
            } else if (torsoPose && TORSO[name]) q = slerp(body, torsoPose, TORSO[name]);
            rotations.push(q);
            translations.push(node === rootNode ? [0, 0, 0] : bodyT);
        }
        channels.push(
            { node, path: 'rotation', values: rotations },
            { node, path: 'translation', values: translations }
        );
    }
    return { name: NAMES[kind], times, channels };
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
const overwriteFloats = (index: number, values: Vec[], type: 'SCALAR' | 'VEC3' | 'VEC4') => {
    const accessor = gltf.accessors[index];
    if (!accessor || accessor.componentType !== 5126 || accessor.type !== type || accessor.count !== values.length)
        throw new Error(`Cannot re-author accessor ${index}: incompatible animation track`);
    const view = gltf.bufferViews[accessor.bufferView];
    const widthValue = width[type];
    const stride = view.byteStride ?? widthValue * 4;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    values.forEach((row, i) => row.forEach((value, c) => bin.writeFloatLE(value, start + i * stride + c * 4)));
    if (type === 'SCALAR') {
        accessor.min = [Math.min(...values.map((value) => value[0]))];
        accessor.max = [Math.max(...values.map((value) => value[0]))];
    }
};
for (const kind of ['walk', 'idle'] as const) {
    const authored = author(kind);
    const existing = gltf.animations.find((animation) => animation.name === NAMES[kind]);
    if (existing) {
        const input = existing.samplers[0]?.input;
        if (input === undefined) throw new Error(`Existing ${NAMES[kind]} has no time track`);
        overwriteFloats(input, authored.times.map((t) => [t]), 'SCALAR');
        const byChannel = new Map(authored.channels.map((channel) => [`${channel.node}:${channel.path}`, channel]));
        for (const channel of existing.channels) {
            const authoredChannel = byChannel.get(`${channel.target.node}:${channel.target.path}`);
            if (!authoredChannel) throw new Error(`Existing ${NAMES[kind]} has an unexpected channel`);
            overwriteFloats(
                existing.samplers[channel.sampler].output,
                authoredChannel.values,
                channel.target.path === 'rotation' ? 'VEC4' : 'VEC3'
            );
            byChannel.delete(`${channel.target.node}:${channel.target.path}`);
        }
        if (byChannel.size) throw new Error(`Existing ${NAMES[kind]} is missing authored channels`);
        continue;
    }
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
manifest.runtime.generator = `${manifest.runtime.generator.split(' + tools/authorWaveClips.ts')[0]} + tools/authorWaveClips.ts`;
manifest.verified.animationClips = gltf.animations.length;
manifest.wave = {
    actions: [NAMES.walk, NAMES.idle],
    durationSeconds: { walk: WALK_SECONDS, idle: IDLE_SECONDS },
    handPose: 'Open right palm from A_TPose; raised arm uses Pistol_Aim_Up with the thumb turned toward the torso',
    generator:
        'tools/authorWaveClips.ts (Walk_Loop / Idle_Loop body, open right palm from A_TPose, raised Pistol_Aim_Up arm pose; no Blender)',
    rootTranslation: false
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
console.log(`Authored ${NAMES.walk}, ${NAMES.idle}: ${out.length} bytes, ${gltf.animations.length} clips`);
