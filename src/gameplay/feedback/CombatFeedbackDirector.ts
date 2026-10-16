import type { CombatFeedbackDecision, CombatFeedbackEvent } from './CombatFeedbackTypes.ts';
import { FEEDBACK_PRESETS } from './FeedbackPresets.ts';

/** Deduplicates authoritative outcomes and arbitrates transient HUD events without delaying gameplay state. */
export class CombatFeedbackDirector {
    private readonly seen = new Map<string, number>();
    private noticePriority = -1;
    private noticeUntil = 0;

    submit(event: CombatFeedbackEvent, now: number): CombatFeedbackDecision {
        this.prune(now);
        if (this.seen.has(event.id)) return { accepted: false, showHud: false };
        this.seen.set(event.id, now + 10_000);
        if (this.seen.size > 512) this.seen.delete(this.seen.keys().next().value!);

        const preset = FEEDBACK_PRESETS[event.kind];
        if (preset.hudHoldMs === 0) return { accepted: true, showHud: false };
        const showHud = now >= this.noticeUntil || preset.priority >= this.noticePriority;
        if (showHud) {
            this.noticePriority = preset.priority;
            this.noticeUntil = now + preset.hudHoldMs;
        }
        return { accepted: true, showHud };
    }

    private prune(now: number) {
        for (const [id, until] of this.seen) if (until <= now) this.seen.delete(id);
        if (now >= this.noticeUntil) this.noticePriority = -1;
    }
}
