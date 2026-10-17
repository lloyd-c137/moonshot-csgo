// Pure rules behind combat feel 3.0 (tested in test/combat-feel.test.js): aim-target detection, hit-stop and the
// final-elimination slow motion. GAMEPLAY_AUTHORED tuning values.
import { PLAYER_HIT } from './frisbee.ts';
import type { V3 } from './frisbee.ts';

/**
 * The enemy the crosshair is on: the nearest capsule (centre `p`) the view ray passes through within `range`.
 * Walls are checked by the caller (physics raycast); this only answers "is the ray on a body".
 */
export const aimTarget = (eye: V3, forward: V3, bodies: Iterable<[string, V3]>, range: number) => {
    let best: { id: string; distance: number } | null = null;
    for (const [id, centre] of bodies) {
        const rx = centre[0] - eye[0],
            ry = centre[1] - eye[1],
            rz = centre[2] - eye[2];
        const along = rx * forward[0] + ry * forward[1] + rz * forward[2];
        if (along <= 0.3 || along > range) continue;
        // Closest point on the ray to the capsule's vertical core.
        const px = eye[0] + forward[0] * along,
            py = eye[1] + forward[1] * along,
            pz = eye[2] + forward[2] * along;
        const dy = Math.max(0, Math.abs(py - centre[1]) - PLAYER_HIT.halfCore);
        const off = Math.hypot(px - centre[0], dy, pz - centre[2]);
        if (off > PLAYER_HIT.radius) continue;
        if (!best || along < best.distance) best = { id, distance: along };
    }
    return best;
};

/** Presentation-only freeze on your own confirmed hits (ms): body none, head 40, elimination 60. */
export const HIT_STOP_MS = { hit: 0, head: 40, kill: 60 } as const;

/** Slow motion for the elimination that ends the round: time scale and real duration (s). */
export const FINAL_SLOW_MOTION = { scale: 0.3, seconds: 0.4 } as const;

/**
 * Whether an elimination ends the round on the spot: it was final (no respawn) and at most one player is still
 * standing afterwards.
 */
export const endsRound = (final: boolean, standingAfter: number) => final && standingAfter <= 1;
