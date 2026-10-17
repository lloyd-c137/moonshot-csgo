import type { ExecutionActor } from '../execution.ts';

/** First-pass tuning values for the server-authoritative GLOBAL FINISHER trigger. */
export const GLOBAL_FINISHER_CONFIG = {
    minDistance: 0.6,
    maxDistance: 1.3,
    maxHeightDifference: 0.4,
    rearHalfAngleDeg: 40,
    attackerFacingHalfAngleDeg: 35,
    holdDurationMs: 400,
    cinematicDurationMs: 2600,
    initialSyncLeadMs: 800,
    globalCooldownMs: 90000,
    maxPerPlayerPerRound: 1,
    maxPerRound: 4
} as const;

export type FinisherVariant = 'THE_BOOMERANG' | 'THE_BOOMERANG_GOLD';
export type FinisherCameraPlan = 'OPEN' | 'COMPACT' | 'TIGHT';
export type GlobalFinisher = {
    id: string;
    roundId: number;
    sequence: number;
    phase: 'pending' | 'active' | 'settling';
    attacker: ExecutionActor;
    target: ExecutionActor;
    variant: FinisherVariant;
    cinematicId: 'THE_BOOMERANG';
    cameraPlanId: FinisherCameraPlan;
    pauseAt: number;
    startsAt: number;
    endsAt: number;
};
