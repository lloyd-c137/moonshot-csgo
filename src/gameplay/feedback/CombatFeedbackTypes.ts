export type CombatFeedbackKind =
    | 'contact-predicted'
    | 'contact-rejected'
    | 'body-hit'
    | 'headshot'
    | 'elimination'
    | 'golden-elimination'
    | 'personal-damage'
    | 'round-result';

export type CombatFeedbackEvent = { id: string; kind: CombatFeedbackKind };
export type CombatFeedbackDecision = { accepted: boolean; showHud: boolean };
