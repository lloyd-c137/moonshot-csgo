// 纪老师 (the discipline teacher): a resident NPC who patrols the ring corridor on a fixed schedule, so every client
// (and the room) can place him from the room clock alone. Pure maths here (tested in test/teacher.test.js);
// gameplay/teacherView.ts draws him and enforces his rule: no frisbees indoors inside his field of view.
import { PATROL_ROUTE } from '../config/patrol.ts';

export const TEACHER = {
    name: '纪老师',
    title: '德育主任',
    /** Walking speed (m/s). */
    speed: 1.6,
    /** At each corner he stops and looks around for this long (s). */
    pause: 2.2,
    /** He notices everything within this radius (m) of him, all round. */
    range: 10,
    /** Eye height above the floor (m). */
    eye: 1.62
} as const;

type Leg = { from: [number, number]; to: [number, number]; heading: number; walk: number; start: number };

const wrapAngle = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

export type TeacherPose = { x: number; z: number; yaw: number; walking: boolean };

/**
 * A closed patrol on a fixed schedule: walk each leg at `speed`, stop `pause` seconds at each corner glancing left and
 * right, turn onto the next leg. Returns the lap time and the pose at any time (seconds into the patrol, any number).
 */
export const makePatrol = (route: readonly (readonly [number, number])[], speed: number, pause: number) => {
    const legs: Leg[] = [];
    let cycle = 0;
    for (let i = 0; i < route.length; i++) {
        const from = route[i] as [number, number];
        const to = route[(i + 1) % route.length] as [number, number];
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        // Heading in degrees, the convention used for player yaw (0 = facing -Z, positive turns toward -X).
        const heading = (Math.atan2(-(to[0] - from[0]), -(to[1] - from[1])) * 180) / Math.PI;
        legs.push({ from, to, heading, walk: length / speed, start: cycle });
        cycle += length / speed + pause;
    }
    const at = (seconds: number): TeacherPose => {
        const t = ((seconds % cycle) + cycle) % cycle;
        let index = legs.length - 1;
        while (index > 0 && legs[index].start > t) index--;
        const leg = legs[index];
        const local = t - leg.start;
        if (local < leg.walk) {
            const u = local / leg.walk;
            return {
                x: leg.from[0] + (leg.to[0] - leg.from[0]) * u,
                z: leg.from[1] + (leg.to[1] - leg.from[1]) * u,
                yaw: leg.heading,
                walking: true
            };
        }
        const next = legs[(index + 1) % legs.length];
        const p = (local - leg.walk) / pause;
        const turn = wrapAngle(next.heading - leg.heading);
        const glance = Math.sin(p * Math.PI * 2) * 40 * (1 - p);
        return { x: leg.to[0], z: leg.to[1], yaw: wrapAngle(leg.heading + turn * p * p + glance), walking: false };
    };
    return { seconds: cycle, at, firstHeading: legs[0].heading };
};

const teacherPatrol = makePatrol(PATROL_ROUTE, TEACHER.speed, TEACHER.pause);
/** Seconds for one full patrol lap, pauses included. */
export const PATROL_SECONDS = teacherPatrol.seconds;

/** Where 纪老师 is and where he looks at room time `ms`. */
export const teacherAt = (ms: number): TeacherPose => teacherPatrol.at(ms / 1000);

/** Whether a point (x, z) lies inside his watch: a circle of TEACHER.range around him. */
export const inTeacherView = (teacher: TeacherPose, x: number, z: number) =>
    Math.hypot(x - teacher.x, z - teacher.z) <= TEACHER.range;
