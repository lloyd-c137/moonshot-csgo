export type AudioVoice = {
    stop(): void;
    addEventListener(type: 'ended', listener: () => void, options?: AddEventListenerOptions): void;
};

/** Bounded FIFO voice sets for each audio bus; ended voices always release their slot. */
export class AudioVoicePool<Group extends string> {
    private readonly voices: Record<Group, Set<AudioVoice>>;
    private readonly limits: Record<Group, number>;

    constructor(limits: Record<Group, number>) {
        this.limits = limits;
        this.voices = Object.fromEntries(Object.keys(limits).map((group) => [group, new Set()])) as Record<
            Group,
            Set<AudioVoice>
        >;
    }

    track(group: Group, voice: AudioVoice, cleanup: () => void) {
        const active = this.voices[group];
        if (active.size >= this.limits[group]) {
            const oldest = active.values().next().value;
            if (oldest) {
                active.delete(oldest);
                try {
                    oldest.stop();
                } catch {
                    // The source may have ended between checking the cap and stopping it.
                }
            }
        }
        active.add(voice);
        voice.addEventListener(
            'ended',
            () => {
                active.delete(voice);
                cleanup();
            },
            { once: true }
        );
    }

    count() {
        return (Object.values(this.voices) as Set<AudioVoice>[]).reduce((total, active) => total + active.size, 0);
    }
}
