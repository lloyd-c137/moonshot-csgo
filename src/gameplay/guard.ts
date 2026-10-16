// The night guard (保安): stands at the south gate until the lights go out with ROUND.blackoutSecondsLeft to go, then
// walks the outer corridors with a flashlight. Anyone caught in its beam is out for the rest of the round. Like
// 纪老师 he is placed from the room clock alone (pure; tested in test/guard.test.js); guardView.ts draws him.
import { GUARD_ROUTE } from '../config/guardRoute.ts';

import { makePatrol } from './teacher.ts';
import type { TeacherPose } from './teacher.ts';

export const GUARD = {
    name: '保安',
    /** Patrol speed (m/s) and the pause at each corner (s). */
    speed: 2.8,
    pause: 0.6,
    /** Flashlight beam: reach (m) and half-angle (degrees). */
    range: 13,
    halfAngle: 22,
    /** Height of the torch above the floor (m). */
    torch: 1.35
} as const;

const patrol = makePatrol(GUARD_ROUTE, GUARD.speed, GUARD.pause);

/** Where the guard is at room time `ms`, given when the lights went out (`blackoutAt`, room ms; null: not yet). */
export const guardAt = (ms: number, blackoutAt: number | null): TeacherPose => {
    if (blackoutAt === null || ms < blackoutAt) {
        const [x, z] = GUARD_ROUTE[0];
        return { x, z, yaw: patrol.firstHeading, walking: false };
    }
    return patrol.at((ms - blackoutAt) / 1000);
};

const wrapAngle = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

/** Whether a point (x, z) lies inside the flashlight beam (reach and angle only; walls are checked by the caller). */
export const inBeam = (guard: TeacherPose, x: number, z: number) => {
    const dx = x - guard.x;
    const dz = z - guard.z;
    const distance = Math.hypot(dx, dz);
    if (distance > GUARD.range || distance < 0.3) return distance < 0.3;
    const toward = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    return Math.abs(wrapAngle(toward - guard.yaw)) <= GUARD.halfAngle;
};
