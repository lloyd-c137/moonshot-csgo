import type { CombatFeedbackKind } from './CombatFeedbackTypes.ts';

export const FEEDBACK_PRESETS: Record<CombatFeedbackKind, { priority: number; hudHoldMs: number }> = {
    'contact-predicted': { priority: 0, hudHoldMs: 0 },
    'contact-rejected': { priority: 0, hudHoldMs: 0 },
    'body-hit': { priority: 1, hudHoldMs: 260 },
    headshot: { priority: 2, hudHoldMs: 450 },
    elimination: { priority: 3, hudHoldMs: 700 },
    'golden-elimination': { priority: 4, hudHoldMs: 1_000 },
    'personal-damage': { priority: 3, hudHoldMs: 650 },
    'round-result': { priority: 5, hudHoldMs: 1_800 }
};
