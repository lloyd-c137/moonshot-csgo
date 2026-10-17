// Presentation timing of the Boomerang finisher (pure, no engine): bullet time on the strike, a smooth camera path
// and the impact moment. The server timeline stays a plain 2.6 s; only how the film is played inside it changes.

/** The disc lands on the target's neck at this fraction of the film (FinisherDiscController strike point). */
export const FINISHER_STRIKE = 0.83;

/** Bullet time: playback slows to (1 − depth) of normal speed around the strike, over about ±width. */
const WARP = { centre: FINISHER_STRIKE, depth: 0.82, width: 0.055 } as const;
const SAMPLES = 512;

/**
 * Real time spent per unit of film, cumulative: the film runs at (1 − depth) of normal speed while it is near the
 * strike, so the real time to reach film position f is ∫ 1/speed(f) df, normalised to the fixed 2.6 s.
 */
const realAtFilm = (() => {
    const speed = (f: number) => 1 - WARP.depth * Math.exp(-(((f - WARP.centre) / WARP.width) ** 2));
    const out = new Float64Array(SAMPLES + 1);
    for (let i = 1; i <= SAMPLES; i++) {
        const a = (i - 1) / SAMPLES,
            b = i / SAMPLES;
        out[i] = out[i - 1] + ((1 / speed(a) + 1 / speed(b)) / 2) * (b - a);
    }
    for (let i = 0; i <= SAMPLES; i++) out[i] /= out[SAMPLES];
    return out;
})();

/** Real progress (0…1 of the 2.6 s) → film progress used for the clips, the disc and the camera. */
export const finisherWarp = (progress: number) => {
    const r = Math.max(0, Math.min(1, progress));
    let lo = 0,
        hi = SAMPLES;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (realAtFilm[mid] <= r) lo = mid;
        else hi = mid;
    }
    const span = realAtFilm[hi] - realAtFilm[lo] || 1;
    return (lo + (r - realAtFilm[lo]) / span) / SAMPLES;
};

/** Camera keys: [film progress, orbit angle (rad, 0 = attacker's right), fov]. */
const CAMERA_KEYS: readonly (readonly [number, number, number])[] = [
    [0, -0.55, 62],
    [0.18, -0.18, 58],
    [0.44, 0.43, 52],
    [0.63, 0.12, 56],
    [0.83, -0.32, 48],
    [1, 0.06, 60]
];

/** Centripetal-free uniform Catmull-Rom through the keys: one continuous move, no stop at each key. */
export const finisherCamera = (film: number) => {
    const t = Math.max(0, Math.min(1, film));
    let i = 0;
    while (i < CAMERA_KEYS.length - 2 && t > CAMERA_KEYS[i + 1][0]) i++;
    const k = (n: number) => CAMERA_KEYS[Math.max(0, Math.min(CAMERA_KEYS.length - 1, n))];
    const p0 = k(i - 1),
        p1 = k(i),
        p2 = k(i + 1),
        p3 = k(i + 2);
    const u = (t - p1[0]) / (p2[0] - p1[0] || 1);
    const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    return { angle: cr(p0[1], p1[1], p2[1], p3[1]), fov: cr(p0[2], p1[2], p2[2], p3[2]) };
};

/** Impact punch 0…1 (sharp attack, ~0.35 s of real time decay) for shake, push-in and FOV kick. */
export const finisherPunch = (film: number) => {
    if (film < FINISHER_STRIKE) return 0;
    return Math.exp(-(film - FINISHER_STRIKE) * 28);
};
