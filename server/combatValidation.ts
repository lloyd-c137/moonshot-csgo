// Server-side plausibility checks for disc hits and movement (pure; tested in test/combat-validation.test.js).
//
// Lag compensation ("favour the thrower, within a cap"): the thrower saw everyone RENDER_DELAY in the past, so a hit
// claim carries the room time it was seen at (`rt`). The room rewinds the target to that moment from its own pose
// history and checks the claimed contact against the rewound capsule. The rewind is capped at RENDER_DELAY plus
// LAG_ALLOWANCE (owner decision 2026-10-17: 200 ms of network allowance); older views are judged at the cap, so
// very high-latency throwers lose some hits rather than everyone else being hit around corners.
import { WALL_BOUNCE_MIN_Y } from '../src/config/bounce.ts';
import { DISC, PLAYER_HIT } from '../src/gameplay/frisbee.ts';
import type { V3 } from '../src/gameplay/frisbee.ts';
import { flightSegmentClear, maskLookup } from '../src/gameplay/occlusionMask.ts';
import { RENDER_DELAY } from '../src/net/interpolation.ts';
import { isHeadHit } from '../src/net/protocol.ts';
import type { PlayerPose, Vec3Tuple } from '../src/net/protocol.ts';

import { COMBAT_OCCLUSION } from './combatOcclusion.ts';

/** Network allowance on top of the render delay (ms). */
export const LAG_ALLOWANCE = 200;
export const MAX_REWIND = RENDER_DELAY + LAG_ALLOWANCE;
/** Pose history kept per player (ms): comfortably more than the rewind cap. */
const HISTORY_MS = 1000;
/** Extra contact distance beyond capsule + disc radius (m): interpolation and 20 Hz sampling error. */
export const CONTACT_TOLERANCE = 0.45;
/** Most bounce points a claim may list. */
export const MAX_PATH_POINTS = 8;

export type Stamped = { t: number; p: Vec3Tuple; crouched: boolean };

/** Recent room-stamped capsule centres of one player, for rewinding. */
export class PoseHistory {
    private samples: Stamped[] = [];

    push(t: number, pose: PlayerPose) {
        const last = this.samples[this.samples.length - 1];
        if (last && t <= last.t) return;
        this.samples.push({ t, p: [pose.p[0], pose.p[1], pose.p[2]], crouched: pose.crouched === true });
        while (this.samples.length > 2 && this.samples[0].t < t - HISTORY_MS) this.samples.shift();
    }

    /** Forget the past (respawn, relocation): a rewind must never reach across a teleport. */
    reset(t: number, pose: PlayerPose) {
        this.samples = [];
        this.push(t, pose);
    }

    /** The newest stamped sample, if any. */
    latest(): Stamped | null {
        return this.samples[this.samples.length - 1] ?? null;
    }

    /** Capsule centre at room time `t`, interpolated; clamped to the oldest/newest sample. */
    at(t: number): Vec3Tuple | null {
        const s = this.samples;
        if (!s.length) return null;
        if (t <= s[0].t) return [...s[0].p];
        const last = s[s.length - 1];
        if (t >= last.t) return [...last.p];
        let i = s.length - 1;
        while (s[i - 1].t > t) i--;
        const a = s[i - 1],
            b = s[i],
            k = (t - a.t) / (b.t - a.t);
        return [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
    }

    /** Position interpolates; stance is discrete and changes at the timestamp of the accepted pose. */
    atPose(t: number): { p: Vec3Tuple; crouched: boolean } | null {
        const p = this.at(t);
        if (!p) return null;
        let crouched = this.samples[0].crouched;
        for (const sample of this.samples) {
            if (sample.t > t) break;
            crouched = sample.crouched;
        }
        return { p, crouched };
    }
}

/** The room time to judge a claim at: the claimed view time, or the default view time, clamped to the cap. */
export const rewindTime = (now: number, claimed: number | undefined) => {
    const t = claimed !== undefined && Number.isFinite(claimed) ? claimed : now - RENDER_DELAY;
    return Math.min(now, Math.max(now - MAX_REWIND, t));
};

export const contactNearCapsule = (contact: readonly number[], centre: readonly number[], crouched = false) => {
    const halfCore = crouched ? PLAYER_HIT.crouchedHalfCore : PLAYER_HIT.halfCore;
    const y = Math.max(centre[1] - halfCore, Math.min(centre[1] + halfCore, contact[1]));
    const distance = Math.hypot(contact[0] - centre[0], contact[1] - y, contact[2] - centre[2]);
    return distance <= PLAYER_HIT.radius + DISC.radius + CONTACT_TOLERANCE;
};

const blocked = maskLookup(COMBAT_OCCLUSION);
/** Above the arena parapet (STADIUM.fasciaTop 4.6 m) a disc clears every wall the 2D mask records. */
const FLIGHT_CLEAR_ABOVE = 4.75;

/** The disc's reported flight (origin, bounces…, contact) does not pass through a wall, glass or boundary barrier. */
export const flightClear = (points: readonly (readonly number[])[]) => {
    for (let i = 1; i < points.length; i++)
        if (!flightSegmentClear(blocked, points[i - 1], points[i], 0.15, 0.3, FLIGHT_CLEAR_ABOVE)) return false;
    return true;
};

export const pathLength = (points: readonly (readonly number[])[]) => {
    let total = 0;
    for (let i = 1; i < points.length; i++)
        total += Math.hypot(
            points[i][0] - points[i - 1][0],
            points[i][1] - points[i - 1][1],
            points[i][2] - points[i - 1][2]
        );
    return total;
};

/** Wall/furniture bounces on a reported path (floor skids do not make a bank shot). */
export const wallBounces = (bounces: readonly (readonly number[])[]) =>
    bounces.filter((point) => point[1] > WALL_BOUNCE_MIN_Y).length;

export type HitVerdict =
    | { ok: true; head: boolean; centre: Vec3Tuple; bank: boolean; range: number }
    | { ok: false; reason: 'no-history' | 'contact' | 'wall' | 'reach' };

/**
 * Judges one hit claim against the target's rewound position.
 * `reach` is how far the disc could have travelled since release (m), including slack.
 */
export const judgeHit = (options: {
    history: PoseHistory;
    now: number;
    claimedTime: number | undefined;
    origin: V3;
    contact: V3;
    bounces: V3[];
    reach: number;
}): HitVerdict => {
    const historicalPose = options.history.atPose(rewindTime(options.now, options.claimedTime));
    if (!historicalPose) return { ok: false, reason: 'no-history' };
    const { p: centre, crouched } = historicalPose;
    if (!contactNearCapsule(options.contact, centre, crouched)) return { ok: false, reason: 'contact' };
    const path = [options.origin, ...options.bounces.slice(0, MAX_PATH_POINTS), options.contact];
    if (pathLength(path) > options.reach) return { ok: false, reason: 'reach' };
    if (!flightClear(path)) return { ok: false, reason: 'wall' };
    return {
        ok: true,
        head: isHeadHit(options.contact[1], centre[1], crouched),
        centre,
        bank: wallBounces(options.bounces.slice(0, MAX_PATH_POINTS)) > 0,
        range: Math.round(pathLength(path) * 10) / 10
    };
};

/**
 * Movement plausibility (log-only for now): horizontal speed between two stamped poses above what sprinting can
 * produce. Teleports the game performs itself (respawn, recovery, final relocation) reset the history first.
 */
export const MOVE_LIMIT = { speed: 14, slack: 2.5 } as const;
export const implausibleMove = (from: Stamped | null, t: number, p: readonly number[]) => {
    if (!from) return false;
    const seconds = Math.max(0.05, (t - from.t) / 1000);
    return Math.hypot(p[0] - from.p[0], p[2] - from.p[2]) > MOVE_LIMIT.speed * seconds + MOVE_LIMIT.slack;
};
