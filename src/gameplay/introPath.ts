// The entry flyover's camera path (pure): a high aerial over the campus, a sweep past the 莲花球场, down onto the
// street and through the south gate into the player's own eyes. Catmull-Rom through the keys; the last stretch
// blends into the live first-person view so control hands over without a cut. GAMEPLAY_AUTHORED.
import { EXTERIOR } from '../world/exteriorLayout.ts';

type V3 = [number, number, number];
export type IntroKey = { t: number; pos: V3; look: V3; fov: number };

const GX = EXTERIOR.gate.x,
    GZ = EXTERIOR.gate.front;

/** Seconds. */
export const INTRO_DURATION = 9;
/** The last stretch (s) that blends from the gate into the player's view. */
export const INTRO_HANDOFF = 1.4;

export const INTRO_KEYS: readonly IntroKey[] = [
    { t: 0, pos: [105, 92, 165], look: [-4, 0, 6], fov: 46 },
    { t: 2.3, pos: [-52, 58, 120], look: [-8, 2, -2], fov: 48 },
    { t: 4.5, pos: [-38, 17, GZ + 36], look: [GX, 3, GZ], fov: 54 },
    { t: 6.3, pos: [GX, 4.6, GZ + 22], look: [GX, 3, GZ], fov: 58 },
    { t: INTRO_DURATION - INTRO_HANDOFF, pos: [GX, 1.9, GZ + 6], look: [GX, 1.75, GZ - 8], fov: 64 }
];

const smooth = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const cr = (a: number, b: number, c: number, d: number, u: number) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);

/** Camera at `seconds` into the intro. `eye`/`ahead`/`fov` are the live first-person view it hands over to. */
export const introCamera = (seconds: number, eye: V3, ahead: V3, fov: number) => {
    const keys = INTRO_KEYS;
    const last = keys[keys.length - 1];
    const t = Math.max(0, Math.min(INTRO_DURATION, seconds));
    if (t >= last.t) {
        const u = smooth((t - last.t) / (INTRO_DURATION - last.t));
        const pick = (a: V3, b: V3) => [0, 1, 2].map((i) => lerp(a[i], b[i], u)) as V3;
        return { pos: pick(last.pos, eye), look: pick(last.look, ahead), fov: lerp(last.fov, fov, u) };
    }
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const k = (n: number) => keys[Math.max(0, Math.min(keys.length - 1, n))];
    const [p0, p1, p2, p3] = [k(i - 1), k(i), k(i + 1), k(i + 2)];
    const u = (t - p1.t) / (p2.t - p1.t);
    const spline = (get: (key: IntroKey) => V3) =>
        [0, 1, 2].map((n) => cr(get(p0)[n], get(p1)[n], get(p2)[n], get(p3)[n], u)) as V3;
    return {
        pos: spline((key) => key.pos),
        look: spline((key) => key.look),
        fov: cr(p0.fov, p1.fov, p2.fov, p3.fov, u)
    };
};

/** The typed lines of the title card (COD-style), with the player's local date and time. */
export const introLines = (now: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return [
        '探月学校 · MOONSHOT ACADEMY',
        'FF-01 校园 · 莲花球场 · 南门',
        `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} · 飞盘大乱斗`
    ];
};
