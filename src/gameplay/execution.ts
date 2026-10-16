// Shared, pure execution rules and animation sampling; no engine or wall-clock state.
import { EXECUTION_OCCLUSION as MAP } from '../config/executionOcclusion.ts';
import type { PlayerPose } from '../net/protocol.ts';

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
const blocked = Uint8Array.from(atob(MAP.bits), (c) => c.charCodeAt(0));
const cellBlocked = (x: number, z: number) => {
    const i = Math.floor((x - MAP.x0) / MAP.resolution),
        j = Math.floor((z - MAP.z0) / MAP.resolution);
    if (i < 0 || j < 0 || i >= MAP.width || j >= MAP.height) return true;
    const index = j * MAP.width + i;
    return !!(blocked[index >> 3] & (1 << (index & 7)));
};
export const executionLineClear = (a: readonly number[], b: readonly number[]) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.05));
    for (let i = 0; i <= steps; i++)
        if (cellBlocked(a[0] + ((b[0] - a[0]) * i) / steps, a[2] + ((b[2] - a[2]) * i) / steps)) return false;
    return true;
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
// Piecewise action timing is authored gameplay animation, not UI entrance timing.
const ease = (value: number) => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
};
export const executionFrame = (progress: number) => {
    const u = clamp(progress),
        reach = ease(u / 0.24),
        strike = ease((u - 0.28) / 0.16),
        recover = ease((u - 0.7) / 0.3),
        fall = ease((u - 0.48) / 0.38);
    return {
        progress: u,
        reach,
        attackerArm: -65 * reach + 185 * strike - 120 * recover,
        attackerLean: 12 * reach - 8 * recover,
        targetLean: 12 * reach + 70 * fall,
        targetDrop: 0.35 * fall,
        targetArm: 35 * reach + 35 * fall,
        fall,
        recover,
        impact: u >= 0.44
    };
};
export const executionProgress = (execution: Execution, now: number) =>
    clamp((now - execution.startsAt) / (execution.endsAt - execution.startsAt));
