// Event cutscenes (pure; tested in test/cutscenes.test.js). GAMEPLAY_AUTHORED. Each plays on every client from the
// shared room clock when its event happens, and for its length nobody can act, be hit or be caught (the room
// rejects claims inside the window too):
//   blackout — the round's night begins: the lights cut out over the guard at his post, a close-up as he raises his
//              torch, then the camera follows him off on his rounds.
//   breaker  — someone pulled the SVC-10 breaker: sparks at the cabinet, then the guard setting off to repair it.

import { ROUND } from '../../net/protocol.ts';
import type { PowerState } from '../power.ts';
import type { TeacherPose } from '../teacher.ts';

export type V3 = [number, number, number];
export type CutsceneKind = 'blackout' | 'breaker' | 'gold-first' | 'last-two';
export type MomentCutscene = {
    id: string;
    kind: 'gold-first' | 'last-two';
    at: number;
    focus: V3;
    secondary?: V3;
};
export type Shot = { eye: V3; target: V3; fov: number };

export const CUTSCENE_SECONDS: Record<CutsceneKind, number> = {
    blackout: ROUND.blackoutCutsceneSeconds,
    breaker: ROUND.breakerCutsceneSeconds,
    'gold-first': 3.6,
    'last-two': 3.4
};

export const CUTSCENE_CAPTIONS: Record<CutsceneKind, { title: string; sub: string }> = {
    blackout: { title: '终局夜晚', sub: '保安开始巡逻 · 被手电照到即出局' },
    breaker: { title: '配电室被拉闸', sub: '全校断电 · 保安正赶去修理' },
    'gold-first': { title: '金飞盘易主', sub: '争夺进入白热化 · 守住金盘，赢下本局' },
    'last-two': { title: '最终二人对决', sub: '只剩两名选手 · 决胜时刻' }
};

/** The cutscene playing at room time `ms`, if any, and how far into it (seconds). */
export const activeCutscene = (ms: number, blackoutAt: number | null, power: PowerState, moment?: MomentCutscene | null) => {
    if (moment && ms >= moment.at && ms < moment.at + CUTSCENE_SECONDS[moment.kind] * 1000)
        return { kind: moment.kind, at: moment.at, t: (ms - moment.at) / 1000, moment };
    if (power.pulledAt !== null && ms >= power.pulledAt && ms < power.pulledAt + CUTSCENE_SECONDS.breaker * 1000)
        return { kind: 'breaker' as const, at: power.pulledAt, t: (ms - power.pulledAt) / 1000 };
    if (blackoutAt !== null && ms >= blackoutAt && ms < blackoutAt + CUTSCENE_SECONDS.blackout * 1000)
        return { kind: 'blackout' as const, at: blackoutAt, t: (ms - blackoutAt) / 1000 };
    return null;
};

export const inCutscene = (ms: number, blackoutAt: number | null, power: PowerState, moment?: MomentCutscene | null) =>
    activeCutscene(ms, blackoutAt, power, moment) !== null;

const forwardOf = (yawDeg: number): [number, number] => {
    const yaw = (yawDeg * Math.PI) / 180;
    return [-Math.sin(yaw), -Math.cos(yaw)];
};

/**
 * The camera for a cutscene at t seconds, given where the guard is now (`guard`) and, for the breaker, the
 * cabinet. Shots are framed from the guard's own heading, so they follow him wherever the patrol leads.
 */
export const cutsceneShot = (kind: CutsceneKind, t: number, guard: TeacherPose, cabinet: V3, moment?: MomentCutscene | null): Shot => {
    if ((kind === 'gold-first' || kind === 'last-two') && moment) {
        const focus = moment.focus;
        const other = moment.secondary ?? focus;
        const mid: V3 = [(focus[0] + other[0]) / 2, (focus[1] + other[1]) / 2, (focus[2] + other[2]) / 2];
        const dx = other[0] - focus[0];
        const dz = other[2] - focus[2];
        const yaw = Math.atan2(dx, dz);
        const radius = Math.max(2.2, Math.min(4.2, Math.hypot(dx, dz) * 0.8 + 2));
        const orbit = (t / CUTSCENE_SECONDS[kind]) * Math.PI * 0.65;
        const angle = yaw + orbit;
        const close = kind === 'gold-first' && t > 2.2;
        return {
            eye: [mid[0] + Math.sin(angle) * (close ? 2.2 : radius), mid[1] + (close ? 1.45 : 2.2), mid[2] + Math.cos(angle) * (close ? 2.2 : radius)],
            target: [mid[0], mid[1] + (kind === 'gold-first' ? 0.9 : 1), mid[2]],
            fov: kind === 'gold-first' ? (close ? 48 : 62) : t > 2.4 ? 52 : 64
        };
    }
    const [fx, fz] = forwardOf(guard.yaw);
    const [sx, sz] = [-fz, fx];
    const at = (forward: number, side: number, y: number): V3 => [
        guard.x + fx * forward + sx * side,
        y,
        guard.z + fz * forward + sz * side
    ];
    if (kind === 'blackout') {
        if (t < 1.6) {
            // Wide: the guard at his post as the lights go out around him; a slow push in.
            const k = t / 1.6;
            return { eye: at(6.5 - 1.5 * k, 1.8, 2.3 - 0.3 * k), target: [guard.x, 1.25, guard.z], fov: 55 };
        }
        if (t < 3.2) {
            // Close: his face and the torch coming up.
            const k = (t - 1.6) / 1.6;
            return { eye: at(2.1, 0.55 - 0.25 * k, 1.42), target: [guard.x, 1.5, guard.z], fov: 38 };
        }
        // Behind his shoulder as he sets off.
        const k = Math.min(1, (t - 3.2) / 1.6);
        return { eye: at(-2.6 - 0.6 * k, 0.7, 1.85), target: at(5, 0, 1.15), fov: 58 };
    }
    if (t < 1.5) {
        // The breaker cabinet throwing sparks: low, close, drifting sideways.
        const k = t / 1.5;
        const [cx, cy, cz] = cabinet;
        return { eye: [cx + 1.7 - 0.5 * k, cy + 0.25, cz + 1.2 + 0.4 * k], target: [cx, cy, cz], fov: 46 };
    }
    // The guard turning and hurrying off, seen from a little ahead of him.
    const k = Math.min(1, (t - 1.5) / 2.7);
    return { eye: at(3.6 - 0.6 * k, -1.2, 1.7), target: [guard.x, 1.3, guard.z], fov: 50 };
};
