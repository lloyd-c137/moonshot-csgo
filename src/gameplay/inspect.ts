// Weapon inspect (F): the in-hand disc is lifted toward the centre of view, twirled, flipped to show its underside
// and caught back in the ready pose. Pure keyframes (tested in test/inspect.test.js); match.ts drives the viewmodel.

export const INSPECT_SECONDS = 2.4;

type Pose = [position: [number, number, number], euler: [number, number, number]];

/** The resting in-hand pose (camera space): matches the idle viewmodel in match.ts. */
export const REST: Pose = [
    [0.3, -0.31, -0.66],
    [18, -12, -8]
];

// [time 0–1, pose]; Euler angles are unwrapped so interpolation spins the long way where wanted.
const KEYS: [number, Pose][] = [
    [0, REST],
    // Lift toward centre and tip the face toward the eye.
    [
        0.16,
        [
            [0.12, -0.17, -0.5],
            [72, -6, 18]
        ]
    ],
    [
        0.22,
        [
            [0.11, -0.16, -0.5],
            [76, -4, 24]
        ]
    ],
    // Twirl a full turn in the fingers, with a little wobble half-way round.
    [
        0.36,
        [
            [0.1, -0.15, -0.49],
            [62, -18, 204]
        ]
    ],
    [
        0.5,
        [
            [0.1, -0.15, -0.49],
            [78, -2, 384]
        ]
    ],
    // Flip over to show the underside.
    [
        0.68,
        [
            [0.15, -0.19, -0.53],
            [-96, 26, 372]
        ]
    ],
    [
        0.82,
        [
            [0.16, -0.2, -0.54],
            [-92, 22, 368]
        ]
    ],
    // Back to the ready pose (one turn further around, which is the same orientation).
    [
        1,
        [
            [0.3, -0.31, -0.66],
            [18, -12, 352]
        ]
    ]
];

const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: readonly number[], b: readonly number[], t: number) =>
    a.map((value, index) => value + (b[index] - value) * t) as [number, number, number];

/** Viewmodel position and Euler angles at progress `u` (0–1) of the inspect. */
export const inspectPose = (u: number): Pose => {
    const t = Math.min(1, Math.max(0, u));
    let index = 1;
    while (index < KEYS.length - 1 && KEYS[index][0] < t) index++;
    const [t0, a] = KEYS[index - 1];
    const [t1, b] = KEYS[index];
    const k = smooth((t - t0) / Math.max(1e-6, t1 - t0));
    return [mix(a[0], b[0], k), mix(a[1], b[1], k)];
};
