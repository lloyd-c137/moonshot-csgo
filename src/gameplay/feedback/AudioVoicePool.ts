export type AudioVoice = {
    stop(): void;
    addEventListener(type: 'ended', listener: () => void, options?: AddEventListenerOptions): void;
};

/** Bounded priority queues per audio bus; ties evict the oldest voice and ended voices release their slot. */
export class AudioVoicePool<Group extends string> {
    private readonly voices: Record<Group, Map<AudioVoice, number>>;
    private readonly limits: Record<Group, number>;

    constructor(limits: Record<Group, number>) {
        this.limits = limits;
        this.voices = Object.fromEntries(Object.keys(limits).map((group) => [group, new Map()])) as Record<
            Group,
            Map<AudioVoice, number>
        >;
    }

    track(group: Group, voice: AudioVoice, cleanup: () => void, priority = 0) {
        const active = this.voices[group];
        if (active.size >= this.limits[group]) {
            let victim: AudioVoice | undefined;
            let victimPriority = Infinity;
            for (const [candidate, candidatePriority] of active) {
                if (candidatePriority < victimPriority) {
                    victim = candidate;
                    victimPriority = candidatePriority;
                }
            }
            if (victimPriority > priority) {
                try {
                    voice.stop();
                } catch {
                    // The source may have ended before it was admitted to the pool.
                }
                cleanup();
                return false;
            }
            if (victim) {
                active.delete(victim);
                try {
                    victim.stop();
                } catch {
                    // The source may have ended between checking the cap and stopping it.
                }
            }
        }
        active.set(voice, priority);
        voice.addEventListener(
            'ended',
            () => {
                active.delete(voice);
                cleanup();
            },
            { once: true }
        );
        return true;
    }

    count() {
        return (Object.values(this.voices) as Map<AudioVoice, number>[]).reduce(
            (total, active) => total + active.size,
            0
        );
    }
}
