// GAMEPLAY_AUTHORED breaker in source-labelled SVC-10. Shared deterministic timing, not real electrical data.
import { BREAKER_ROUTE } from '../config/breakerRoute.ts';
import { BREAKER_CABINET } from '../config/specialLocations.ts';

import type { TeacherPose } from './teacher.ts';

export type PowerState = { pulledAt: number | null };
export const BREAKER = {
    room: 'SVC-10',
    cabinet: BREAKER_CABINET,
    reach: 1.1,
    speed: 2.8,
    repairSeconds: 3
} as const;
const length = BREAKER_ROUTE.slice(1).reduce(
    (sum, p, i) => sum + Math.hypot(p[0] - BREAKER_ROUTE[i][0], p[1] - BREAKER_ROUTE[i][1]),
    0
);
export const POWER_TRAVEL_MS = (length / BREAKER.speed) * 1000;
export const POWER_RESTORE_MS = POWER_TRAVEL_MS + BREAKER.repairSeconds * 1000;
export const POWER_RETURN_MS = POWER_RESTORE_MS + POWER_TRAVEL_MS;
export const powerPhase = (ms: number, power: PowerState) => {
    if (power.pulledAt === null || ms < power.pulledAt) return 'ready';
    const elapsed = ms - power.pulledAt;
    return elapsed < POWER_TRAVEL_MS
        ? 'outbound'
        : elapsed < POWER_RESTORE_MS
          ? 'repairing'
          : elapsed < POWER_RETURN_MS
            ? 'returning'
            : 'complete';
};
export const powerOut = (ms: number, power: PowerState) => ['outbound', 'repairing'].includes(powerPhase(ms, power));
export const nearBreaker = (p: readonly number[]) => {
    const destination = BREAKER_ROUTE[BREAKER_ROUTE.length - 1];
    // This interior interaction circle stays inside the room; Y prevents interaction from a different elevation.
    return p[1] >= 0.4 && p[1] <= 1.6 && Math.hypot(p[0] - destination[0], p[2] - destination[1]) <= BREAKER.reach;
};
/** Walking out, repairing, then retracing the same collision-checked path to the original post. */
export const repairGuardAt = (ms: number, power: PowerState): TeacherPose | null => {
    const phase = powerPhase(ms, power);
    if (phase === 'ready' || phase === 'complete') return null;
    const elapsed = ms - power.pulledAt!;
    const back = phase === 'returning';
    if (phase === 'repairing') {
        const [x, z] = BREAKER_ROUTE[BREAKER_ROUTE.length - 1];
        return { x, z, yaw: 0, walking: false };
    }
    let distance = ((back ? elapsed - POWER_RESTORE_MS : elapsed) / 1000) * BREAKER.speed;
    const route = back ? [...BREAKER_ROUTE].reverse() : BREAKER_ROUTE;
    for (let i = 1; i < route.length; i++) {
        const [a, b] = [route[i - 1], route[i]];
        const leg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (distance <= leg || i === route.length - 1) {
            const u = Math.min(1, Math.max(0, distance / leg));
            return {
                x: a[0] + (b[0] - a[0]) * u,
                z: a[1] + (b[1] - a[1]) * u,
                yaw: (Math.atan2(a[0] - b[0], a[1] - b[1]) * 180) / Math.PI,
                walking: true
            };
        }
        distance -= leg;
    }
    return null;
};
