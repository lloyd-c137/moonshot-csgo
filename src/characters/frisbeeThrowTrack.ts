import { AnimCurve, AnimData, AnimTrack, INTERPOLATION_LINEAR } from 'playcanvas';

const TIMES = [0, 0.09, 0.18, 0.28, 0.43, 0.58, 0.72];

const rotation = (axis: 'x' | 'y' | 'z', degrees: number): number[] => {
    const angle = (degrees * Math.PI) / 360;
    const q = [0, 0, 0, Math.cos(angle)];
    q[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] = Math.sin(angle);
    return q;
};

const multiply = (a: number[], b: number[]) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];

const trackJoint = (path: string[], rotations: number[][], outputIndex: number) => {
    const values = TIMES.flatMap((_, index) => rotations[index]);
    return {
        output: new AnimData(4, values),
        curve: new AnimCurve(
            [{ entityPath: ['Armature', ...path], component: 'graph', propertyPath: ['localRotation'] }],
            0,
            outputIndex,
            INTERPOLATION_LINEAR
        )
    };
};

/** Authored additive upper-body throw: load, coil, release, follow-through, settle. */
export const createFrisbeeThrowTrack = () => {
    const input = new AnimData(1, TIMES);
    const neutral = (degrees: number[]) => degrees.map((value) => rotation('y', value));
    const spine = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03'];
    const rightArm = [...spine, 'clavicle_r', 'upperarm_r'];
    const joints = [
        trackJoint(spine, neutral([0, -8, -15, 12, 7, 0, 0]), 0),
        trackJoint(rightArm, neutral([0, -24, -42, 88, 58, 12, 0]), 1),
        trackJoint(
            [...rightArm, 'lowerarm_r'],
            [0, 8, 16, -18, -12, 0, 0].map((value, index) =>
                multiply(rotation('z', value), rotation('y', [0, 0, 0, 12, 8, 0, 0][index]))
            ),
            2
        ),
        trackJoint(
            [...rightArm, 'lowerarm_r', 'hand_r'],
            [0, 4, 6, -8, -5, 0, 0].map((value) => rotation('z', value)),
            3
        ),
        trackJoint([...spine, 'clavicle_l', 'upperarm_l'], neutral([0, 3, 6, -12, -8, 0, 0]), 4)
    ];
    return new AnimTrack(
        'Frisbee_Throw',
        TIMES.at(-1)!,
        [input],
        joints.map((joint) => joint.output),
        joints.map((joint) => joint.curve)
    );
};

export const FRISBEE_THROW_DURATION = TIMES.at(-1)!;
/** Remote clients receive the throw only once the authoritative disc has been released. */
export const FRISBEE_THROW_RELEASE_OFFSET = 0.39;
export const FRISBEE_THROW_REMAINING = FRISBEE_THROW_DURATION * (1 - FRISBEE_THROW_RELEASE_OFFSET);
