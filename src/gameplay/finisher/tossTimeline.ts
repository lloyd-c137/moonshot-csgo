// THE TOSS (owner brief 2026-10-17), one timeline shared by the clip author (tools/authorFinisherToss.ts) and the
// runtime disc and staging (pure, no engine). 2.6 s at 30 fps, frames 0–78:
//   0–36   the attacker strolls up behind the unaware target, tossing the disc overhead (release 10, catch 28)
//   36–42  stops, winds the disc across the body
//   42     throws it forward past the target's shoulder; it loops out ahead and swings back
//   65     the returning disc takes the target (bullet time, finisherTiming.ts) — the target collapses
//   65–76  the disc flies home into the attacker's raised hand
// GAMEPLAY_AUTHORED.

export const TOSS = {
    fps: 30,
    frames: 78,
    /** Walk_Loop playback rate while strolling. */
    walkCadence: 1,
    /** The attacker starts this far behind their real position and walks into it. */
    approach: 1.6,
    walkEndFrame: 38,
    tossRelease: 10,
    tossCatch: 28,
    /** Height (m) of the overhead toss above the release point. */
    tossHeight: 1.55,
    throwRelease: 42,
    strike: 65,
    homeCatch: 76
} as const;

const smooth = (u: number) => {
    const t = Math.max(0, Math.min(1, u));
    return t * t * (3 - 2 * t);
};

/** Walk_Loop weight on the attacker's body (1 while strolling, easing to idle as they stop to throw). */
export const tossWalkWeight = (frame: number) => 1 - smooth((frame - 32) / 10);

/** How far along the approach the attacker is (0 at the start, 1 at their real position): a stroll that settles. */
export const tossApproach = (frame: number) => 1 - (1 - Math.max(0, Math.min(1, frame / TOSS.walkEndFrame))) ** 1.6;

/**
 * Upper-body key poses for the attacker: [frame, source, weight]. Sources are frames of the Blender-authored
 * Boomerang attacker clip: 14 right hand overhead, 35 counter-rotated tracking, 50 cross-body reach,
 * 65 release follow-through, 79 recovered stance; 'base' is the walk/idle body.
 */
export const tossArmKeys: readonly (readonly [number, number | 'base', number?])[] = [
    [0, 'base'],
    [4, 'base'],
    [9, 14, 1],
    [11, 14, 1],
    [17, 'base'],
    [22, 'base'],
    [26, 14, 1],
    [29, 14, 1],
    [35, 50, 1],
    [39, 50, 1],
    [44, 65, 1],
    [53, 65, 0.85],
    [60, 35, 0.75],
    [66, 79, 1],
    [72, 14, 0.75],
    [76, 14, 0.8],
    [78, 79, 1]
];

/** The target: unaware idle, a late flinch as the disc comes back, the hit and the collapse (victim clip frames). */
export const tossVictimKeys: readonly (readonly [number, number | 'base', number?])[] = [
    [0, 'base'],
    [55, 'base'],
    [61, 35, 0.45],
    [65, 65, 1],
    [71, 79, 1],
    [78, 79, 1]
];

type V3 = [number, number, number];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const mix = (a: V3, b: V3, t: number): V3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
];
const catmull = (p: readonly V3[], u: number): V3 => {
    const n = p.length - 1;
    const x = Math.max(0, Math.min(0.99999, u)) * n;
    const i = Math.floor(x),
        t = x - i;
    const [p0, p1, p2, p3] = [p[Math.max(0, i - 1)], p[i], p[i + 1], p[Math.min(n, i + 2)]];
    return [0, 1, 2].map(
        (k) =>
            0.5 *
            (2 * p1[k] +
                (-p0[k] + p2[k]) * t +
                (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t +
                (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t)
    ) as V3;
};

/**
 * Disc position at `frame`. `hand` is the attacker's right hand now; `releaseHand` where it was at the toss
 * release; `victim` the target's feet; `forward` the unit direction attacker → target (horizontal).
 * Returns the position and how it spins: 'flip' end over end (toss), 'flat' spinning flat (throw), 'held'.
 */
export const tossDisc = (frame: number, hand: V3, releaseHand: V3, throwHand: V3, victim: V3, forward: V3) => {
    const right: V3 = [-forward[2], 0, forward[0]];
    const up = (h: number): V3 => [0, h, 0];
    if (frame < TOSS.tossRelease || (frame >= TOSS.tossCatch && frame < TOSS.throwRelease) || frame >= TOSS.homeCatch)
        return { at: hand, spin: 'held' as const };
    if (frame < TOSS.tossCatch) {
        // Overhead toss: a parabola from the release point, settling into the (moving) catching hand.
        const u = (frame - TOSS.tossRelease) / (TOSS.tossCatch - TOSS.tossRelease);
        const along = mix(releaseHand, hand, u);
        const arc = add(along, up(4 * TOSS.tossHeight * u * (1 - u)));
        return { at: mix(arc, hand, smooth((u - 0.8) / 0.2)), spin: 'flip' as const };
    }
    const neck = add(victim, up(1.5));
    if (frame < TOSS.strike) {
        // Out past the target's right shoulder, a wide loop ahead, back in from the left onto the neck.
        const u = (frame - TOSS.throwRelease) / (TOSS.strike - TOSS.throwRelease);
        const path: V3[] = [
            throwHand,
            add(add(add(victim, forward, 1.2), right, 1.0), up(1.75)),
            add(add(add(victim, forward, 5.2), right, 1.6), up(2.2)),
            add(add(add(victim, forward, 7.2), right, -0.6), up(2.3)),
            add(add(add(victim, forward, 4.4), right, -2.4), up(1.9)),
            add(add(add(victim, forward, 1.3), right, -0.9), up(1.6)),
            neck
        ];
        return { at: catmull(path, u), spin: 'flat' as const };
    }
    // Home: from the strike back over the target's shoulder into the raised hand.
    const u = (frame - TOSS.strike) / (TOSS.homeCatch - TOSS.strike);
    const lift = add(mix(neck, hand, smooth(u)), up(0.9 * Math.sin(Math.PI * u)));
    return { at: lift, spin: 'flat' as const };
};
