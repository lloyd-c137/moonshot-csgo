import { SAFE_SPAWN } from '../src/config/gameplay.ts';
import { GOLD_DROP_SURFACES } from '../src/config/goldDropSurfaces.ts';
import type { PlayerPose, Vec3Tuple } from '../src/net/protocol.ts';

/** Capsule-centre anchors derived from walkable collision surfaces; never infer a floor from X/Z alone. */
export type GoldDropAnchor = readonly [x: number, y: number, z: number];

export type GoldDropResolution = {
    at: Vec3Tuple;
    source: 'current-surface' | 'nearby-surface' | 'fallback-spawn';
    relocated: boolean;
};

const HORIZONTAL_SUPPORT_RADIUS = 0.42;
const VERTICAL_SUPPORT_RADIUS = 0.72;
const MAX_RELOCATION_DISTANCE = 2.4;
// A drop may happen while the holder is briefly airborne, but must never snap through a floor to another level.
const MAX_RELOCATION_VERTICAL_DISTANCE = 2.25;

/**
 * Resolve a drop to a previously audited capsule-centre anchor. Y participates in selection, so stacked floors,
 * court-level seats and upper bowl rows cannot steal a drop from the player's current level.
 */
export const resolveGoldDrop = (
    pose: PlayerPose | null | undefined,
    surfaces: readonly GoldDropAnchor[] = GOLD_DROP_SURFACES,
    fallback: GoldDropAnchor = [SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z]
): GoldDropResolution => {
    const origin = pose?.p;
    if (origin && origin.every(Number.isFinite)) {
        let best: GoldDropAnchor | null = null;
        let bestScore = Infinity;
        for (const candidate of surfaces) {
            const horizontal = Math.hypot(candidate[0] - origin[0], candidate[2] - origin[2]);
            const vertical = Math.abs(candidate[1] - origin[1]);
            if (horizontal > HORIZONTAL_SUPPORT_RADIUS || vertical > VERTICAL_SUPPORT_RADIUS) continue;
            // Prefer the same level first, then the closest safe point. Vertical distance is deliberately weighted
            // more heavily to avoid selecting a nearby surface through a floor or stand.
            const score = horizontal + vertical * 2;
            if (score < bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        if (best) {
            const at: Vec3Tuple = [best[0], best[1], best[2]];
            const same = Math.hypot(at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]) < 0.08;
            return { at, source: same ? 'current-surface' : 'nearby-surface', relocated: !same };
        }

        // Only relocate a bad/stale position if a known safe anchor is close; otherwise use the audited spawn.
        const nearby = surfaces.reduce<GoldDropAnchor | null>((best, candidate) => {
            const distance = Math.hypot(candidate[0] - origin[0], candidate[2] - origin[2]);
            const vertical = Math.abs(candidate[1] - origin[1]);
            if (distance > MAX_RELOCATION_DISTANCE || vertical > MAX_RELOCATION_VERTICAL_DISTANCE) return best;
            const score = distance + vertical * 1.5;
            const bestScore = best
                ? Math.hypot(best[0] - origin[0], best[2] - origin[2]) + Math.abs(best[1] - origin[1]) * 1.5
                : Infinity;
            return score < bestScore ? candidate : best;
        }, null);
        if (nearby) return { at: [nearby[0], nearby[1], nearby[2]], source: 'nearby-surface', relocated: true };
    }
    return { at: [fallback[0], fallback[1], fallback[2]], source: 'fallback-spawn', relocated: true };
};
