// Shared, pure execution rules and animation sampling; no engine or wall-clock state.
import { EXECUTION_OCCLUSION } from '../config/executionOcclusion.ts';
import type { PlayerPose } from '../net/protocol.ts';

import { GLOBAL_FINISHER_CONFIG } from './finisher/FinisherTypes.ts';
import { lineClear, maskLookup } from './occlusionMask.ts';
import { inTeacherView, teacherAt } from './teacher.ts';

export const EXECUTION = {
    range: 1.45,
    minRange: 0.55,
    height: 0.45,
    rearCos: 0.65,
    facingCos: 0.55,
    durationMs: 2600,
    startDelayMs: 150
} as const;
export type ExecutionActor = { id: string; name: string; colour: number; pose: PlayerPose };
export type Execution = {
    id: string;
    attacker: ExecutionActor;
    target: ExecutionActor;
    startsAt: number;
    endsAt: number;
    cameraPlanId?: 'OPEN' | 'COMPACT' | 'TIGHT';
    variant?: 'THE_BOOMERANG' | 'THE_BOOMERANG_GOLD';
};
const blocked = maskLookup(EXECUTION_OCCLUSION);
export const executionLineClear = (a: readonly number[], b: readonly number[]) => lineClear(blocked, a, b);
/**
 * Owner rule (2026-10-17): no executions inside 纪老师's watch circle. Checked at the start of a move against either
 * participant; a move already under way is not interrupted when he walks closer.
 */
export const executionWatched = (now: number, attacker: PlayerPose, target: PlayerPose) => {
    const teacher = teacherAt(now);
    return inTeacherView(teacher, attacker.p[0], attacker.p[2]) || inTeacherView(teacher, target.p[0], target.p[2]);
};
export const canExecute = (attacker: PlayerPose, target: PlayerPose) => {
    const dx = attacker.p[0] - target.p[0],
        dz = attacker.p[2] - target.p[2],
        d = Math.hypot(dx, dz);
    if (d < EXECUTION.minRange || d > EXECUTION.range || Math.abs(attacker.p[1] - target.p[1]) > EXECUTION.height)
        return false;
    const t = (target.yaw * Math.PI) / 180,
        a = (attacker.yaw * Math.PI) / 180;
    // Target forward is (-sin yaw,-cos yaw). Attacker must be behind it, looking toward it.
    if ((dx * Math.sin(t) + dz * Math.cos(t)) / d < EXECUTION.rearCos) return false;
    if ((dx * Math.sin(a) + dz * Math.cos(a)) / d < EXECUTION.facingCos) return false;
    return (
        executionLineClear(attacker.p, target.p) &&
        executionLineClear(target.p, [target.p[0] - Math.sin(t) * 0.6, target.p[1], target.p[2] - Math.cos(t) * 0.6])
    );
};

/** Trigger and compact-orbit clearance predicate shared by local prompts and server commit validation. */
export const canStartGlobalFinisher = (attacker: PlayerPose, target: PlayerPose) => {
    const dx = attacker.p[0] - target.p[0];
    const dz = attacker.p[2] - target.p[2];
    const horizontalDistance = Math.hypot(dx, dz);
    const distance = Math.hypot(dx, attacker.p[1] - target.p[1], dz);
    if (horizontalDistance < 1e-6) return false;
    if (
        distance < GLOBAL_FINISHER_CONFIG.minDistance ||
        distance > GLOBAL_FINISHER_CONFIG.maxDistance ||
        Math.abs(attacker.p[1] - target.p[1]) > GLOBAL_FINISHER_CONFIG.maxHeightDifference
    )
        return false;
    const targetYaw = (target.yaw * Math.PI) / 180;
    const attackerYaw = (attacker.yaw * Math.PI) / 180;
    const rearCos = Math.cos((GLOBAL_FINISHER_CONFIG.rearHalfAngleDeg * Math.PI) / 180);
    const facingCos = Math.cos((GLOBAL_FINISHER_CONFIG.attackerFacingHalfAngleDeg * Math.PI) / 180);
    if ((dx * Math.sin(targetYaw) + dz * Math.cos(targetYaw)) / horizontalDistance < rearCos) return false;
    if ((dx * Math.sin(attackerYaw) + dz * Math.cos(attackerYaw)) / horizontalDistance < facingCos) return false;
    if (!executionLineClear(attacker.p, target.p)) return false;

    // Require room for the first compact orbital arc before accepting the global lock.
    const radius = 0.42;
    for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12;
        const b = (Math.PI * 2 * (i + 1)) / 12;
        const from = [target.p[0] + Math.cos(a) * radius, target.p[1], target.p[2] + Math.sin(a) * radius];
        const to = [target.p[0] + Math.cos(b) * radius, target.p[1], target.p[2] + Math.sin(b) * radius];
        if (!executionLineClear(from, to)) return false;
    }
    return true;
};
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
};
/**
 * Authored timeline of the 2.6 s disc finisher (fractions of the move). GAMEPLAY_AUTHORED; one source of truth for
 * the paired animation, the impact feedback and the HUD. The attacker closes in, raises the disc, brings it down on
 * the back of the target's neck at `impact`, the target falls, the attacker recovers.
 */
export const EXECUTION_TIMELINE = { close: 0.12, grab: 0.3, impact: 0.44, fallEnd: 0.85, recover: 0.75 } as const;
export type ExecutionPhase = 'approach' | 'grab' | 'strike' | 'fall' | 'recover';
export const executionFrame = (progress: number) => {
    const u = clamp(progress),
        T = EXECUTION_TIMELINE;
    const phase: ExecutionPhase =
        u < T.close ? 'approach' : u < T.grab ? 'grab' : u < T.impact ? 'strike' : u < T.recover ? 'fall' : 'recover';
    return {
        progress: u,
        phase,
        /** 0→1 while the attacker steps in to striking distance. */
        close: ease(u / T.close),
        /** 0→1 while the target crumples after the blow. */
        fall: ease((u - T.impact) / (T.fallEnd - T.impact)),
        /** 0→1 while the attacker settles back. */
        recover: ease((u - T.recover) / (1 - T.recover)),
        impact: u >= T.impact
    };
};
export const executionProgress = (execution: Execution, now: number) =>
    clamp((now - execution.startsAt) / (execution.endsAt - execution.startsAt));
