// Shared, pure execution rules and animation sampling; no engine or wall-clock state.
import { EXECUTION_OCCLUSION } from '../config/executionOcclusion.ts';
import type { PlayerPose } from '../net/protocol.ts';

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
/** Authored clip lengths (s) of the CC0 rig's clips used by the finisher; the view passes the loaded values. */
export const FINISHER_CLIPS = { Sword_Attack: 1.57, Hit_Chest: 0.37, Death01: 2.43 } as const;
/** The target's flinch lasts until this fraction, then the death clip plays (faster than authored). */
const DEATH_AT = 0.52;
const DEATH_SPEED = 1.25;
export type ClipCue = { clip: string; offset: number; speed: number };

/**
 * Which clip each actor plays at `progress`, where inside it (s) and how fast. One continuous swing spans
 * close → recover so its contact lands on the impact moment instead of being cut between clips; the target stands,
 * flinches at the blow and falls. Offsets follow progress, so a client that joins late lands on the same frame.
 */
export const finisherClips = (
    progress: number,
    durationSeconds: number,
    clips: { Sword_Attack: number; Hit_Chest: number; Death01: number } = FINISHER_CLIPS
) => {
    const u = clamp(progress),
        T = EXECUTION_TIMELINE;
    const swingSpeed = clips.Sword_Attack / ((T.recover - T.close) * durationSeconds);
    const attacker: ClipCue =
        u < T.close
            ? { clip: 'Idle_Loop', offset: 0, speed: 1 }
            : u < T.recover
              ? { clip: 'Sword_Attack', offset: (u - T.close) * durationSeconds * swingSpeed, speed: swingSpeed }
              : { clip: 'Idle_Loop', offset: 0, speed: 1 };
    const target: ClipCue =
        u < T.impact
            ? { clip: 'Idle_Loop', offset: 0, speed: 1 }
            : u < DEATH_AT
              ? { clip: 'Hit_Chest', offset: Math.min(clips.Hit_Chest, (u - T.impact) * durationSeconds), speed: 1 }
              : { clip: 'Death01', offset: (u - DEATH_AT) * durationSeconds * DEATH_SPEED, speed: DEATH_SPEED };
    return { attacker, target };
};

/** How long (ms) the fallen target stays after the move so the death clip finishes instead of vanishing mid-fall. */
export const finisherLingerMs = (durationSeconds: number, death = FINISHER_CLIPS.Death01) =>
    Math.max(0, (death - (1 - DEATH_AT) * durationSeconds * DEATH_SPEED) / DEATH_SPEED) * 1000;

export const executionProgress = (execution: Execution, now: number) =>
    clamp((now - execution.startsAt) / (execution.endsAt - execution.startsAt));
