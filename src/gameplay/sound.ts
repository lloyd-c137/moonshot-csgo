// Combat sounds: synthesised with the Web Audio API, plus two clips supplied by the owner (public/assets/audio:
// defeat.mp3 when you are eliminated, kill.mp3 when you eliminate someone). Remote throws and hits are positioned
// in 3D relative to the camera (equal-power panning: cheap, no HRTF start-up hitch); the local player's own sounds
// play centred. The context starts on the first user gesture.

type V3 = [number, number, number];
export type TestSoundCue = 'hit' | 'head' | 'kill' | 'bounce';

export const createSound = () => {
    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    let noise: AudioBuffer | null = null;
    const clips = new Map<string, AudioBuffer>();
    let defeatVoice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
    const testClips = new Map<TestSoundCue, { buffer: AudioBuffer; gain: number; start: number; end: number }>();
    const testVersions = new Map<TestSoundCue, number>();
    const testVoices = new Map<TestSoundCue, { source: AudioBufferSourceNode; gain: GainNode }>();
    const testCache = new Map<string, AudioBuffer>();

    const loadClip = async (audio: AudioContext, name: string, url: string) => {
        try {
            const response = await fetch(url);
            clips.set(name, await audio.decodeAudioData(await response.arrayBuffer()));
        } catch {
            /* clip unavailable: the synthesised fallback plays instead */
        }
    };
    const playClip = (audio: AudioContext, name: string, volume: number) => {
        const buffer = clips.get(name);
        if (!buffer) return null;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        const gain = audio.createGain();
        gain.gain.value = volume;
        source.connect(gain).connect(master!);
        source.start();
        return { source, gain };
    };

    const ensure = () => {
        if (!ctx) {
            const Context =
                window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Context) return null;
            ctx = new Context();
            master = ctx.createGain();
            master.gain.value = 0.55;
            master.connect(ctx.destination);
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            void loadClip(ctx, 'defeat', '/assets/audio/defeat.mp3');
            void loadClip(ctx, 'kill', '/assets/audio/kill.mp3');
        }
        if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
        return ctx;
    };

    // Browsers only let audio start (or restart after the tab was hidden, the device changed or Safari
    // "interrupted" it) inside a user gesture. Resume on every gesture and when the page comes back, so sounds
    // never stay silent after the first one was blocked.
    const wake = () => {
        if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    };
    for (const type of ['pointerdown', 'keydown', 'mousedown', 'touchstart'] as const) {
        window.addEventListener(type, wake, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) wake();
    });
    window.addEventListener('focus', wake);

    /** Output node: centred, or a panner at a world position. */
    const output = (audio: AudioContext, at?: V3) => {
        if (!at) return master!;
        const panner = audio.createPanner();
        panner.panningModel = 'equalpower';
        panner.distanceModel = 'inverse';
        panner.refDistance = 2;
        panner.maxDistance = 60;
        panner.rolloffFactor = 1.1;
        if (panner.positionX) {
            panner.positionX.value = at[0];
            panner.positionY.value = at[1];
            panner.positionZ.value = at[2];
        } else {
            (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
                at[0],
                at[1],
                at[2]
            );
        }
        panner.connect(master!);
        return panner;
    };

    const tone = (
        audio: AudioContext,
        destination: AudioNode,
        type: OscillatorType,
        from: number,
        to: number,
        start: number,
        duration: number,
        volume: number
    ) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain).connect(destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    };

    const hiss = (
        audio: AudioContext,
        destination: AudioNode,
        start: number,
        duration: number,
        volume: number,
        fromHz: number,
        toHz: number,
        q = 1.2
    ) => {
        const source = audio.createBufferSource();
        source.buffer = noise;
        const filter = audio.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = q;
        filter.frequency.setValueAtTime(fromHz, start);
        filter.frequency.exponentialRampToValueAtTime(toHz, start + duration);
        const gain = audio.createGain();
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + duration * 0.25);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter).connect(gain).connect(destination);
        source.start(start, Math.random() * 0.5);
        source.stop(start + duration + 0.02);
    };

    const play = (build: (audio: AudioContext, now: number) => void) => {
        const audio = ensure();
        if (audio) build(audio, audio.currentTime);
    };

    /** Local audition overrides share the real event path; no replacement is active by default. */
    const playTestClip = (audio: AudioContext, cue: TestSoundCue, at?: V3) => {
        const clip = testClips.get(cue);
        if (!clip) return false;
        testVoices.get(cue)?.source.stop();
        const source = audio.createBufferSource();
        source.buffer = clip.buffer;
        const gain = audio.createGain();
        gain.gain.value = clip.gain;
        const destination = output(audio, at);
        source.connect(gain).connect(destination);
        testVoices.set(cue, { source, gain });
        source.onended = () => {
            source.disconnect();
            gain.disconnect();
            if (destination !== master) destination.disconnect();
            if (testVoices.get(cue)?.source === source) testVoices.delete(cue);
        };
        source.start(0, clip.start, clip.end - clip.start);
        return true;
    };

    return {
        /** Decodes a local test clip; generation checks prevent fast selections from restoring a stale response. */
        async setTestClip(cue: TestSoundCue, url: string | null, gain = 0.35, start = 0, end = Infinity) {
            const version = (testVersions.get(cue) ?? 0) + 1;
            testVersions.set(cue, version);
            testVoices.get(cue)?.source.stop();
            if (!url) {
                testClips.delete(cue);
                return;
            }
            const audio = ensure();
            if (!audio) throw new Error('浏览器不支持 Web Audio');
            let buffer = testCache.get(url);
            if (!buffer) {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`音效加载失败：${response.status}`);
                buffer = await audio.decodeAudioData(await response.arrayBuffer());
                testCache.set(url, buffer);
            }
            const until = Math.min(end, buffer.duration);
            if (!Number.isFinite(start) || start < 0 || start >= until || !Number.isFinite(until))
                throw new Error('片段起止时间无效');
            if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error('音量需在 0–1 之间');
            if (testVersions.get(cue) === version) testClips.set(cue, { buffer, gain, start, end: until });
        },
        stopTestClips: () => {
            for (const voice of testVoices.values()) voice.source.stop();
        },
        /** Call from a user gesture (entering the campus) so browsers allow audio. */
        unlock: () => void ensure(),
        /** Keeps the 3D listener on the camera. */
        listener(position: V3, forward: V3) {
            if (!ctx) return;
            const l = ctx.listener;
            if (!l.positionX) {
                // Firefox and older Safari: the deprecated setters (otherwise positioned sounds stay at the origin
                // and fall silent when you are far from it).
                const legacy = l as unknown as {
                    setPosition?: (x: number, y: number, z: number) => void;
                    setOrientation?: (x: number, y: number, z: number, ux: number, uy: number, uz: number) => void;
                };
                legacy.setPosition?.(position[0], position[1], position[2]);
                legacy.setOrientation?.(forward[0], forward[1], forward[2], 0, 1, 0);
                return;
            }
            {
                l.positionX.value = position[0];
                l.positionY.value = position[1];
                l.positionZ.value = position[2];
                l.forwardX.value = forward[0];
                l.forwardY.value = forward[1];
                l.forwardZ.value = forward[2];
                l.upX.value = 0;
                l.upY.value = 1;
                l.upZ.value = 0;
            }
        },
        /**
         * Weapon inspect: wrist cock, a sharp flick, the whirr of the spinning disc (one pulse per tumble), a solid
         * snap catch and a light settle. Times are fractions of `seconds`.
         */
        inspect: (seconds: number, tossAt: number, catchAt: number) =>
            play((audio, now) => {
                const out = master!;
                const at = (u: number) => now + u * seconds;
                hiss(audio, out, at(0.02), 0.2, 0.08, 400, 900, 1.2);
                // Flick: a rising whoosh with a finger snap.
                hiss(audio, out, at(tossAt) - 0.07, 0.22, 0.2, 900, 3800, 1.6);
                tone(audio, out, 'triangle', 2400, 1700, at(tossAt) - 0.01, 0.03, 0.08);
                // In the air: whup-whup of the tumbling disc, rising then falling in pitch.
                const pulses = 6;
                for (let i = 0; i < pulses; i++) {
                    const u = tossAt + ((catchAt - tossAt) * (i + 0.5)) / pulses;
                    const height = Math.sin(((i + 0.5) / pulses) * Math.PI);
                    hiss(audio, out, at(u) - 0.05, 0.11, 0.05 + height * 0.06, 1400 + height * 1600, 900, 2.5);
                }
                // Catch: a firm slap with a low thump.
                hiss(audio, out, at(catchAt), 0.08, 0.32, 2600, 1200, 0.9);
                tone(audio, out, 'sine', 180, 70, at(catchAt), 0.14, 0.4);
                tone(audio, out, 'square', 520, 360, at(catchAt), 0.03, 0.05);
                // Settle back into the ready grip.
                hiss(audio, out, at(0.9), 0.18, 0.06, 700, 1500, 1.4);
                tone(audio, out, 'square', 380, 260, at(0.99), 0.04, 0.035);
            }),
        /** Starting to aim: a soft mechanical slide that rises with the zoom. */
        scopeIn: () =>
            play((audio, now) => {
                hiss(audio, master!, now, 0.5, 0.07, 500, 2400, 2);
                tone(audio, master!, 'sine', 220, 440, now, 0.6, 0.05);
            }),
        /** Fully aimed: a crisp lock click and a held high tone. */
        scopeReady: () =>
            play((audio, now) => {
                tone(audio, master!, 'square', 1800, 1700, now, 0.03, 0.07);
                tone(audio, master!, 'square', 2400, 2300, now + 0.05, 0.03, 0.06);
                tone(audio, master!, 'sine', 880, 880, now + 0.06, 0.35, 0.05);
            }),
        /** Sniper release: a sharp crack and a fast, thin whoosh (positioned for other players' throws). */
        sniperThrow: (at?: V3) =>
            play((audio, now) => {
                const out = output(audio, at);
                hiss(audio, out, now, 0.08, 0.5, 4000, 1500, 0.8);
                tone(audio, out, 'sawtooth', 900, 120, now, 0.12, 0.2);
                hiss(audio, out, now + 0.03, 0.45, 0.35, 2600, 6000, 2.4);
            }),
        /** Your sniper disc took someone's head: a heavy bass hit under a bright bell. */
        snipeConfirm: () =>
            play((audio, now) => {
                if (playTestClip(audio, 'head')) return;
                tone(audio, master!, 'sine', 120, 40, now, 0.5, 0.7);
                tone(audio, master!, 'triangle', 1760, 1700, now + 0.02, 0.5, 0.3);
                tone(audio, master!, 'triangle', 2640, 2600, now + 0.1, 0.6, 0.22);
                hiss(audio, master!, now, 0.12, 0.3, 6000, 2000, 0.7);
            }),
        /** The golden disc appears (or is dropped): a shimmering rising chime. */
        goldChime: (at?: V3) =>
            play((audio, now) => {
                const out = output(audio, at);
                [1046, 1318, 1568, 2093].forEach((f, i) =>
                    tone(audio, out, 'triangle', f, f, now + i * 0.07, 0.6, 0.12)
                );
                hiss(audio, out, now, 0.9, 0.06, 5000, 9000, 3);
            }),
        /** You took the golden disc: a short brass-like fanfare over a shimmer. */
        goldTaken: () =>
            play((audio, now) => {
                const out = master!;
                [523, 659, 784, 1046].forEach((f, i) => {
                    tone(audio, out, 'sawtooth', f, f, now + i * 0.09, 0.22, 0.09);
                    tone(audio, out, 'triangle', f * 2, f * 2, now + i * 0.09, 0.3, 0.06);
                });
                tone(audio, out, 'sawtooth', 1046, 1046, now + 0.36, 0.7, 0.1);
                hiss(audio, out, now + 0.3, 1, 0.07, 6000, 10000, 3);
            }),
        /** Someone else took the golden disc: a low warning swell. */
        goldLost: () =>
            play((audio, now) => {
                tone(audio, master!, 'sawtooth', 220, 165, now, 0.5, 0.12);
                tone(audio, master!, 'sawtooth', 277, 207, now + 0.05, 0.5, 0.08);
            }),
        /** Golden disc inspect: a rising shimmer while it spins, then the bright catch. */
        goldInspect: (seconds: number, tossAt: number, catchAt: number) =>
            play((audio, now) => {
                const out = master!;
                tone(audio, out, 'sine', 440, 1760, now + 0.1 * seconds, 0.28 * seconds, 0.07);
                hiss(audio, out, now + 0.1 * seconds, 0.28 * seconds, 0.06, 3000, 12000, 4);
                hiss(audio, out, now + tossAt * seconds - 0.05, 0.25, 0.18, 1200, 5000, 1.6);
                [1568, 2093, 2637].forEach((f, i) =>
                    tone(audio, out, 'triangle', f, f, now + catchAt * seconds + i * 0.04, 0.5, 0.1)
                );
                tone(audio, out, 'sine', 140, 60, now + catchAt * seconds, 0.3, 0.4);
            }),
        /** Lights out: a heavy power-down thud and a falling hum. */
        blackout: () =>
            play((audio, now) => {
                tone(audio, master!, 'sine', 90, 30, now, 1.4, 0.8);
                tone(audio, master!, 'sawtooth', 120, 40, now, 1.6, 0.12);
                hiss(audio, master!, now, 0.3, 0.2, 2000, 300, 1);
            }),
        /** 纪老师's whistle: two sharp blasts. */
        whistle: () =>
            play((audio, now) => {
                for (const start of [0, 0.32]) {
                    tone(audio, master!, 'square', 2900, 2850, now + start, 0.24, 0.09);
                    tone(audio, master!, 'sine', 3100, 3050, now + start, 0.24, 0.06);
                    hiss(audio, master!, now + start, 0.24, 0.05, 3000, 3200, 8);
                }
            }),
        /** Round over: a triumphant chord if you won, a falling one otherwise. */
        roundEnd: (won: boolean) =>
            play((audio, now) => {
                const notes = won ? [523, 659, 784, 1046, 1318] : [392, 349, 311, 262];
                notes.forEach((f, i) => tone(audio, master!, 'triangle', f, f, now + i * 0.12, 0.9, 0.14));
            }),
        /** A new round starts. */
        roundStart: () =>
            play((audio, now) => {
                [0, 0.5, 1].forEach((t) => tone(audio, master!, 'square', 880, 880, now + t, 0.12, 0.06));
                tone(audio, master!, 'square', 1760, 1760, now + 1.5, 0.4, 0.08);
            }),
        /** Picked a disc up: a quick bright double click. */
        pickup: () =>
            play((audio, now) => {
                tone(audio, master!, 'triangle', 880, 1320, now, 0.08, 0.12);
                tone(audio, master!, 'triangle', 1320, 1760, now + 0.07, 0.1, 0.1);
            }),
        /** Disc release: an airy whoosh (positioned for other players' throws). */
        throw: (at?: V3) =>
            play((audio, now) => {
                const out = output(audio, at);
                hiss(audio, out, now, 0.32, 0.5, 900, 2600, 1.6);
                tone(audio, out, 'triangle', 240, 140, now, 0.08, 0.12);
            }),
        /** Disc striking a wall or floor. */
        bounce: (at: V3, strength: number) =>
            play((audio, now) => {
                if (playTestClip(audio, 'bounce', at)) return;
                const out = output(audio, at);
                tone(audio, out, 'square', 320, 180, now, 0.05, Math.min(0.12, 0.03 + strength * 0.01));
            }),
        /** Your disc hit someone: a crisp confirmation; the "kill" clip when it eliminates. */
        hitConfirm: (eliminated: boolean, head = false) =>
            play((audio, now) => {
                if (playTestClip(audio, head ? 'head' : eliminated ? 'kill' : 'hit')) return;
                tone(audio, master!, 'sine', 1320, 1250, now, 0.09, 0.32);
                tone(audio, master!, 'sine', 1980, 1900, now + 0.03, 0.12, 0.2);
                // Head hits ring higher and longer.
                if (head) tone(audio, master!, 'triangle', 2640, 2600, now + 0.06, 0.22, 0.22);
                if (eliminated && !playClip(audio, 'kill', 1.1)) {
                    tone(audio, master!, 'triangle', 660, 660, now + 0.12, 0.16, 0.28);
                    tone(audio, master!, 'triangle', 990, 990, now + 0.24, 0.26, 0.28);
                }
            }),
        /** You were hit: a thud with a low buzz; the "defeat" clip when it eliminates you. */
        hurt: (eliminated: boolean) =>
            play((audio, now) => {
                tone(audio, master!, 'sine', 160, 55, now, 0.28, 0.75);
                hiss(audio, master!, now, 0.18, 0.4, 600, 200, 0.8);
                if (eliminated) {
                    defeatVoice = playClip(audio, 'defeat', 0.9);
                    if (!defeatVoice) tone(audio, master!, 'sawtooth', 440, 110, now + 0.1, 0.7, 0.18);
                }
            }),
        /** Fades out the defeat clip (on respawn). */
        endDefeat: () => {
            if (!ctx || !defeatVoice) return;
            const { source, gain } = defeatVoice;
            defeatVoice = null;
            gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
            source.stop(ctx.currentTime + 1.2);
        },
        /** Someone else was hit nearby (positioned). */
        impact: (at: V3) =>
            play((audio, now) => {
                const out = output(audio, at);
                tone(audio, out, 'sine', 220, 90, now, 0.18, 0.5);
            }),
        /** Elimination announcement for other players' eliminations. */
        announce: () =>
            play((audio, now) => {
                tone(audio, master!, 'triangle', 520, 520, now, 0.12, 0.12);
                tone(audio, master!, 'triangle', 390, 390, now + 0.12, 0.18, 0.12);
            }),
        respawn: () =>
            play((audio, now) => {
                for (const [k, f] of [523, 659, 784].entries())
                    tone(audio, master!, 'sine', f, f, now + k * 0.07, 0.2, 0.18);
            }),
        join: () =>
            play((audio, now) => {
                tone(audio, master!, 'sine', 880, 880, now, 0.08, 0.06);
            })
    };
};

export type Sound = ReturnType<typeof createSound>;
