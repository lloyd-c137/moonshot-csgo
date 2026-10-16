// Weapon inspect (F): cock the wrist, flick the disc up out of the hand so it flies over the centre of view while
// tumbling and spinning, snap-catch it, show off its face and settle back into the ready pose.
// Pure pose maths (tested in test/inspect.test.js); match.ts drives the viewmodel, afterimages, sound and catch kick.

export const INSPECT_SECONDS = 2.2;
/** Progress (0–1) at which the disc leaves the hand, and at which it is caught. */
export const TOSS_AT = 0.2;
export const CATCH_AT = 0.7;

type V = [number, number, number];
type Pose = [position: V, euler: V];

/** The resting in-hand pose (camera space): matches the idle viewmodel in match.ts. */
export const REST: Pose = [
    [0.3, -0.31, -0.66],
    [18, -12, -8]
];

// Hand poses around the toss. Euler angles are unwrapped (whole turns added) so the spin carries through.
const DIP: Pose = [
    [0.27, -0.37, -0.6],
    [42, -22, -24]
];
const RELEASE: Pose = [
    [0.2, -0.25, -0.62],
    [8, -8, -30]
];
/** Flight: three tumbles end over end and two spins about the disc's axis. */
const TUMBLE = 1080;
const SPIN = 720;
const APEX = 0.46; // metres above the straight line between release and catch
const CATCH: Pose = [
    [0.13, -0.2, -0.55],
    [RELEASE[1][0] + TUMBLE, 10, RELEASE[1][2] + SPIN]
];
const RECOIL: Pose = [
    [0.15, -0.245, -0.565],
    [CATCH[1][0] - 8, 14, CATCH[1][2] + 4]
];
const SHOW: Pose = [
    [0.13, -0.18, -0.52],
    [CATCH[1][0] + 66, 2, CATCH[1][2] + 22]
];
const END: Pose = [REST[0], [REST[1][0] + TUMBLE, REST[1][1], REST[1][2] + SPIN]];

const smooth = (t: number) => t * t * (3 - 2 * t);
const easeIn = (t: number) => t * t;
const mix = (a: V, b: V, t: number) => a.map((value, index) => value + (b[index] - value) * t) as V;
const blend = (a: Pose, b: Pose, t: number): Pose => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
const span = (u: number, from: number, to: number) => Math.min(1, Math.max(0, (u - from) / (to - from)));

/** True while the disc is in the air (between the toss and the catch). */
export const airborne = (u: number) => u > TOSS_AT && u < CATCH_AT;

/** Viewmodel position and Euler angles at progress `u` (0–1) of the inspect. */
export const inspectPose = (u: number): Pose => {
    const t = Math.min(1, Math.max(0, u));
    if (t < 0.14) return blend(REST, DIP, smooth(span(t, 0, 0.14)));
    // The flick accelerates into the release so the throw carries straight into the flight.
    if (t < TOSS_AT) return blend(DIP, RELEASE, easeIn(span(t, 0.14, TOSS_AT)));
    if (t < CATCH_AT) {
        const s = span(t, TOSS_AT, CATCH_AT);
        const lift = 4 * s * (1 - s);
        const [x, y, z] = mix(RELEASE[0], CATCH[0], s);
        const wobble = Math.sin(s * Math.PI * 3) * 9;
        return [
            [x - 0.06 * lift, y + APEX * lift, z - 0.1 * lift],
            [
                RELEASE[1][0] + TUMBLE * s,
                RELEASE[1][1] + (CATCH[1][1] - RELEASE[1][1]) * s + wobble,
                RELEASE[1][2] + SPIN * s
            ]
        ];
    }
    // Snap catch: a short recoil, then show the face, then settle.
    if (t < 0.76) return blend(CATCH, RECOIL, smooth(span(t, CATCH_AT, 0.76)));
    if (t < 0.88) return blend(RECOIL, SHOW, smooth(span(t, 0.76, 0.88)));
    return blend(SHOW, END, smooth(span(t, 0.88, 1)));
};
