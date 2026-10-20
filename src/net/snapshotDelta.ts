import type { StampedPose } from './protocol.ts';

const samePose = (pose: StampedPose, previous: StampedPose) =>
    pose.rev !== undefined && previous.rev !== undefined
        ? pose.rev === previous.rev
        : pose.p[0] === previous.p[0] && pose.p[1] === previous.p[1] && pose.p[2] === previous.p[2] &&
          pose.yaw === previous.yaw && pose.pitch === previous.pitch && pose.aim === previous.aim &&
          pose.crouched === previous.crouched;

export const poseChangeCount = (base: Record<string, StampedPose>, current: Record<string, StampedPose>, stopAt = Infinity) => {
    let count = 0;
    for (const id in current) {
        const pose = current[id];
        const previous = base[id];
        if (!previous || !samePose(pose, previous)) count++;
        if (count >= stopAt) return count;
    }
    for (const id in base) {
        if (!(id in current)) count++;
        if (count >= stopAt) return count;
    }
    return count;
};

export const diffPoses = (base: Record<string, StampedPose>, current: Record<string, StampedPose>) => {
    const updates: Record<string, StampedPose> = {};
    const removed: string[] = [];
    for (const [id, pose] of Object.entries(current)) {
        const previous = base[id];
        if (!previous || !samePose(pose, previous)) updates[id] = pose;
    }
    for (const id of Object.keys(base)) if (!(id in current)) removed.push(id);
    return { updates, removed };
};

export const applyPoseDelta = (
    base: Record<string, StampedPose>,
    updates: Record<string, StampedPose>,
    removed: string[]
) => {
    const result = { ...base };
    for (const id of removed) delete result[id];
    for (const [id, pose] of Object.entries(updates)) result[id] = pose;
    return result;
};
