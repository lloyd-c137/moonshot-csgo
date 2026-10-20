// Combat sounds: Web Audio synthesis plus owner-selected hit/kill/head clips in public/assets/audio.
// defeat.mp3 plays when you are eliminated; kill.mp3 remains a load-failure fallback. Remote events are positioned
// in 3D relative to the camera (equal-power panning: cheap, no HRTF start-up hitch); the local player's own sounds
// play centred. The context starts on the first user gesture.

import { BLACKOUT_THEME_AUDIO } from '../config/blackoutThemeAudio';
import { COMBAT_AUDIO } from '../config/combatAudio';
import { FINAL_SHOWDOWN_THEME_AUDIO } from '../config/finalShowdownThemeAudio';
import { HOMEPAGE_THEME_AUDIO } from '../config/homepageThemeAudio';
import { MATCH_PLAYLIST_AUDIO } from '../config/matchPlaylistAudio';
import { OPENING_THEME_AUDIO } from '../config/openingThemeAudio';
import { POWER_DOWN_AUDIO } from '../config/powerAudio';
import { SETTLEMENT_THEME_AUDIO } from '../config/settlementThemeAudio';

import { AudioVoicePool } from './feedback/AudioVoicePool';

type V3 = [number, number, number];
export type TestSoundCue = 'hit' | 'head' | 'kill' | 'bounce' | 'goldKill' | 'throw';
type SoundBus = 'combat' | 'confirmation' | 'environment' | 'ui';
const AUDIO_PRIORITY = { ambient: 0, action: 1, hit: 2, elimination: 4, critical: 5 } as const;

export const createSound = () => {
    let ctx: AudioContext | null = null;
    let master: GainNode | null = null;
    let buses: Record<SoundBus, GainNode> | null = null;
    let activeBus: SoundBus = 'combat';
    let activePriority: number = AUDIO_PRIORITY.ambient;
    let mix = { master: 0.8, combat: 0.8, confirmation: 1 };
    let noise: AudioBuffer | null = null;
    const clips = new Map<string, AudioBuffer>();
    const pendingClipLoads = new Map<string, Promise<AudioBuffer | null>>();
    /** Compressed bytes fetched ahead of time (music): decoded only when first played, then dropped. */
    const prefetched = new Map<string, Promise<ArrayBuffer | null>>();
    const fetchBytes = async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Audio ${url}: HTTP ${response.status}`);
        return response.arrayBuffer();
    };
    let defeatVoice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
    const testClips = new Map<TestSoundCue, { buffer: AudioBuffer; gain: number; start: number; end: number }>();
    const testVersions = new Map<TestSoundCue, number>();
    const testVoices = new Map<TestSoundCue, { source: AudioBufferSourceNode; gain: GainNode }>();
    const testCache = new Map<string, AudioBuffer>();
    const voices = new AudioVoicePool<SoundBus>({ combat: 24, confirmation: 16, environment: 8, ui: 8 });
    const trackVoice = (source: AudioScheduledSourceNode, cleanup: () => void) => {
        voices.track(activeBus, source, cleanup, activePriority);
    };

    const loadClip = (audio: AudioContext, name: string, url: string) => {
        const cached = clips.get(name);
        if (cached) return Promise.resolve(cached);
        const pending = pendingClipLoads.get(name);
        if (pending) return pending;
        const loading = (async () => {
            try {
                const early = prefetched.get(name);
                prefetched.delete(name);
                const bytes = (early && (await early)) || (await fetchBytes(url));
                const buffer = await audio.decodeAudioData(bytes);
                clips.set(name, buffer);
                return buffer;
            } catch {
                /* clip unavailable: the synthesised fallback plays instead */
                return null;
            } finally {
                pendingClipLoads.delete(name);
            }
        })();
        pendingClipLoads.set(name, loading);
        return loading;
    };
    const playClip = (audio: AudioContext, name: string, volume: number, start = 0, end = Infinity, at?: V3) => {
        const buffer = clips.get(name);
        if (!buffer) return null;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        const gain = audio.createGain();
        gain.gain.value = volume;
        const destination = output(audio, at);
        source.connect(gain).connect(destination);
        source.start(0, start, Math.min(end, buffer.duration) - start);
        trackVoice(source, () => {
            source.disconnect();
            gain.disconnect();
            if (at) destination.disconnect();
        });
        return { source, gain };
    };
    const playCombatClip = (audio: AudioContext, cue: keyof typeof COMBAT_AUDIO | 'throw', at?: V3) => {
        const clip = COMBAT_AUDIO[cue as keyof typeof COMBAT_AUDIO];
        if (!clip) return null;
        return playClip(audio, cue, clip.gain, clip.start, clip.end, at);
    };

    const bus = () => (buses?.[activeBus] ?? master)!;
    const ensure = () => {
        if (!ctx) {
            const Context =
                window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Context) return null;
            ctx = new Context();
            master = ctx.createGain();
            master.gain.value = 0.55 * mix.master;
            master.connect(ctx.destination);
            buses = {
                combat: ctx.createGain(),
                confirmation: ctx.createGain(),
                environment: ctx.createGain(),
                ui: ctx.createGain()
            };
            for (const [name, node] of Object.entries(buses)) {
                node.gain.value = name === 'confirmation' ? mix.confirmation : name === 'combat' ? mix.combat : 0.8;
                node.connect(master);
            }
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            void loadClip(ctx, 'defeat', '/assets/audio/defeat.mp3');
            void loadClip(ctx, 'power-down', POWER_DOWN_AUDIO.url);
            for (const [cue, clip] of Object.entries(COMBAT_AUDIO)) void loadClip(ctx, cue, clip.url);
            void loadClip(ctx, 'legacy-kill', '/assets/audio/kill.mp3');
        }
        if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
        return ctx;
    };

    const createLoopingMusic = (
        name: string,
        config: {
            url: string;
            gain: number;
            fadeSeconds: number;
            startSeconds?: number;
            endSeconds?: number;
        }
    ) => {
        let wanted = false;
        let generation = 0;
        let loading: Promise<AudioBuffer | null> | null = null;
        let voice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
        return (active: boolean, offsetSeconds = 0, resync = false) => {
            if (active === wanted && !resync) return;
            wanted = active;
            const version = ++generation;
            const audio = ensure();
            if (!audio || !buses) return;
            const now = audio.currentTime;
            if (!active) {
                if (!voice) return;
                voice.gain.gain.cancelScheduledValues(now);
                voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
                voice.gain.gain.linearRampToValueAtTime(0, now + config.fadeSeconds);
                voice.source.stop(now + config.fadeSeconds + 0.05);
                voice = null;
                return;
            }
            if (voice) {
                voice.source.stop(now);
                voice = null;
            }
            loading ??= clips.get(name) ? Promise.resolve(clips.get(name)!) : loadClip(audio, name, config.url);
            void loading.then((decoded) => {
                loading = null;
                if (!decoded || !wanted || generation !== version || ctx !== audio || !buses || voice) return;
                const source = audio.createBufferSource();
                const gain = audio.createGain();
                source.buffer = decoded;
                source.loop = true;
                const segmentStart = config.startSeconds ?? 0;
                const segmentEnd = Math.min(config.endSeconds ?? decoded.duration, decoded.duration);
                if (config.startSeconds !== undefined) {
                    source.loopStart = segmentStart;
                    source.loopEnd = segmentEnd;
                }
                gain.gain.setValueAtTime(0, audio.currentTime);
                source.connect(gain).connect(buses.environment);
                const current = { source, gain };
                voice = current;
                source.onended = () => {
                    source.disconnect();
                    gain.disconnect();
                    if (voice === current) voice = null;
                };
                const loopDuration = Math.max(0.01, segmentEnd - segmentStart);
                const offset = config.startSeconds === undefined
                    ? ((Math.max(0, offsetSeconds) % decoded.duration) + decoded.duration) % decoded.duration
                    : segmentStart + ((Math.max(0, offsetSeconds) % loopDuration) + loopDuration) % loopDuration;
                source.start(0, offset);
                gain.gain.linearRampToValueAtTime(config.gain, audio.currentTime + config.fadeSeconds);
            });
        };
    };
    const createMatchPlaylist = () => {
        let wanted = false;
        let generation = 0;
        let voice: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
        const play = async (audio: AudioContext, positionSeconds: number, version: number) => {
            const buffers = await Promise.all(
                MATCH_PLAYLIST_AUDIO.map((track) => clips.get(track.name) ?? loadClip(audio, track.name, track.url))
            );
            if (buffers.some((buffer) => !buffer) || !wanted || generation !== version || ctx !== audio || !buses) return;
            const decoded = buffers as AudioBuffer[];
            const totalDuration = decoded.reduce((sum, buffer) => sum + buffer.duration, 0);
            let offset = ((Math.max(0, positionSeconds) % totalDuration) + totalDuration) % totalDuration;
            let index = 0;
            while (index < decoded.length - 1 && offset >= decoded[index].duration) {
                offset -= decoded[index].duration;
                index++;
            }
            const startTrack = (trackIndex: number, trackOffset: number) => {
                if (!wanted || generation !== version || ctx !== audio || !buses) return;
                const track = MATCH_PLAYLIST_AUDIO[trackIndex];
                const source = audio.createBufferSource();
                const gain = audio.createGain();
                source.buffer = decoded[trackIndex];
                gain.gain.setValueAtTime(0, audio.currentTime);
                source.connect(gain).connect(buses.environment);
                const current = { source, gain };
                voice = current;
                source.onended = () => {
                    source.onended = null;
                    source.disconnect();
                    gain.disconnect();
                    if (voice === current) voice = null;
                    if (wanted && generation === version)
                        startTrack((trackIndex + 1) % MATCH_PLAYLIST_AUDIO.length, 0);
                };
                source.start(0, Math.min(trackOffset, Math.max(0, source.buffer!.duration - 0.01)));
                gain.gain.linearRampToValueAtTime(track.gain, audio.currentTime + track.fadeSeconds);
            };
            startTrack(index, offset);
        };
        return (active: boolean, offsetSeconds = 0, resync = false) => {
            if (active === wanted && !resync) return;
            wanted = active;
            const version = ++generation;
            const audio = ensure();
            if (!audio || !buses) return;
            if (!active) {
                const current = voice;
                voice = null;
                if (!current) return;
                const fade = MATCH_PLAYLIST_AUDIO[0].fadeSeconds;
                current.gain.gain.cancelScheduledValues(audio.currentTime);
                current.gain.gain.setValueAtTime(current.gain.gain.value, audio.currentTime);
                current.gain.gain.linearRampToValueAtTime(0, audio.currentTime + fade);
                current.source.stop(audio.currentTime + fade + 0.05);
                return;
            }
            const current = voice;
            voice = null;
            if (current) {
                current.gain.gain.cancelScheduledValues(audio.currentTime);
                current.gain.gain.setValueAtTime(0, audio.currentTime);
                current.source.stop(audio.currentTime);
            }
            void play(audio, offsetSeconds, version);
        };
    };
    const setBlackoutMusic = createLoopingMusic('blackout-theme', BLACKOUT_THEME_AUDIO);
    const setHomepageMusic = createLoopingMusic('homepage-theme', HOMEPAGE_THEME_AUDIO);
    const setOpeningMusic = createLoopingMusic('opening-theme', OPENING_THEME_AUDIO);
    const setMatchPlaylist = createMatchPlaylist();
    const setFinalShowdownMusic = createLoopingMusic('final-showdown-theme', FINAL_SHOWDOWN_THEME_AUDIO);
    const setSettlementMusic = createLoopingMusic('settlement-theme', SETTLEMENT_THEME_AUDIO);
    const requiredAudio = [
        { name: 'homepage-theme', url: HOMEPAGE_THEME_AUDIO.url },
        ...MATCH_PLAYLIST_AUDIO.map(({ name, url }) => ({ name, url })),
        { name: 'blackout-theme', url: BLACKOUT_THEME_AUDIO.url },
        { name: 'final-showdown-theme', url: FINAL_SHOWDOWN_THEME_AUDIO.url },
        { name: 'settlement-theme', url: SETTLEMENT_THEME_AUDIO.url },
        { name: 'power-down', url: POWER_DOWN_AUDIO.url },
        ...Object.entries(COMBAT_AUDIO).map(([name, clip]) => ({ name, url: clip.url }))
    ];
    /** Long music tracks: the phase themes and the in-match playlist. */
    const isMusic = (name: string) =>
        name.endsWith('-theme') || MATCH_PLAYLIST_AUDIO.some((track) => track.name === name);
    const optionalAudio = [
        { name: 'defeat', url: '/assets/audio/defeat.mp3' },
        { name: 'legacy-kill', url: '/assets/audio/kill.mp3' }
    ];

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
        if (!at) return bus();
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
        panner.connect(bus());
        window.setTimeout(() => panner.disconnect(), 2_000);
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
        trackVoice(osc, () => {
            osc.disconnect();
            gain.disconnect();
        });
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
        trackVoice(source, () => {
            source.disconnect();
            filter.disconnect();
            gain.disconnect();
        });
    };

    const play = (
        build: (audio: AudioContext, now: number) => void,
        group: SoundBus = 'combat',
        priority: number = AUDIO_PRIORITY.ambient
    ) => {
        const audio = ensure();
        if (!audio) return;
        const previous = activeBus;
        const previousPriority = activePriority;
        activeBus = group;
        activePriority = priority;
        try {
            build(audio, audio.currentTime);
            if (group === 'confirmation' && buses) {
                const now = audio.currentTime;
                for (const name of ['combat', 'environment'] as const) {
                    const gain = buses[name].gain;
                    const target = name === 'combat' ? mix.combat * 0.72 : 0.42;
                    gain.cancelScheduledValues(now);
                    gain.setTargetAtTime(target, now, 0.025);
                    gain.setTargetAtTime(name === 'combat' ? mix.combat : 0.8, now + 0.28, 0.14);
                }
            }
        } finally {
            activeBus = previous;
            activePriority = previousPriority;
        }
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
        source.start(0, clip.start, clip.end - clip.start);
        trackVoice(source, () => {
            source.disconnect();
            gain.disconnect();
            if (at) destination.disconnect();
            if (testVoices.get(cue)?.source === source) testVoices.delete(cue);
        });
        return true;
    };

    return {
        setVolumes(values: { master: number; combat: number; confirmation: number }) {
            mix = {
                master: Math.max(0, Math.min(1, values.master)),
                combat: Math.max(0, Math.min(1, values.combat)),
                confirmation: Math.max(0, Math.min(1, values.confirmation))
            };
            if (!ctx || !master || !buses) return;
            const now = ctx.currentTime;
            master.gain.setTargetAtTime(0.55 * mix.master, now, 0.04);
            buses.combat.gain.setTargetAtTime(mix.combat, now, 0.04);
            buses.confirmation.gain.setTargetAtTime(mix.confirmation, now, 0.04);
        },
        voiceCount: () => voices.count(),
        async preload(onProgress?: (completed: number, total: number) => void) {
            const audio = ensure();
            if (!audio) throw new Error('浏览器不支持 Web Audio，无法准备游戏音效');
            // Music (minutes of audio each) never holds up the title screen: it is fetched in the background
            // after boot (prefetchMusic) and decoded the first time it plays.
            const all = [...requiredAudio, ...optionalAudio].filter(({ name }) => !isMusic(name));
            let completed = 0;
            const failed: string[] = [];
            await Promise.all(
                all.map(async ({ name, url }) => {
                    const buffer = await loadClip(audio, name, url);
                    if (!buffer && requiredAudio.some((clip) => clip.name === name)) failed.push(name);
                    onProgress?.(++completed, all.length);
                })
            );
            if (failed.length) throw new Error(`必需音频加载失败：${failed.join('、')}`);
        },
        /**
         * Downloads every music track's compressed bytes one after another (title theme first) without
         * decoding them, so each is ready when its moment comes but none delays loading or holds PCM in memory.
         */
        async prefetchMusic() {
            const music = [...requiredAudio, ...optionalAudio].filter(({ name }) => isMusic(name));
            music.sort((a, b) => Number(b.name === 'homepage-theme') - Number(a.name === 'homepage-theme'));
            for (const { name, url } of music) {
                if (clips.has(name) || pendingClipLoads.has(name) || prefetched.has(name)) continue;
                const bytes = fetchBytes(url).catch(() => null);
                prefetched.set(name, bytes);
                await bytes;
            }
        },
        /** Loop the owner-selected theme only while campus lighting is in its blackout state. */
        blackoutMusic: setBlackoutMusic,
        /** Loop the owner-selected theme on the title screen. */
        homepageMusic: setHomepageMusic,
        /** Play the owner-selected in-match playlist in order, handing off to phase themes when play changes. */
        matchPlaylistMusic: setMatchPlaylist,
        /** Legacy opening theme retained for compatibility with existing callers. */
        openingMusic: setOpeningMusic,
        /** Loop the owner-selected theme only during the final-arena showdown. */
        finalShowdownMusic: setFinalShowdownMusic,
        /** Loop only the owner-authorized excerpt during the end-of-round settlement. */
        settlementMusic: setSettlementMusic,
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
        /** Call from a user gesture so browsers allow audio playback. */
        unlock: async () => {
            const audio = ensure();
            if (!audio) throw new Error('浏览器不支持 Web Audio');
            if (audio.state !== 'running') await audio.resume();
            if (audio.state !== 'running') throw new Error('浏览器尚未开启音频');
        },
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
                const out = bus();
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
        /** Ceremony: a low rumble as the arena goes dark. */
        ceremonyDark: () =>
            play(
                (audio, now) => {
                    const out = bus();
                    tone(audio, out, 'sine', 55, 38, now, 2.6, 0.32);
                    hiss(audio, out, now, 2.2, 0.06, 300, 120, 0.6);
                },
                'environment',
                AUDIO_PRIORITY.hit
            ),
        /** Ceremony: a roof spotlight striking on — a heavy relay clunk and a mains hum. */
        ceremonySpot: () =>
            play(
                (audio, now) => {
                    const out = bus();
                    tone(audio, out, 'square', 140, 60, now, 0.08, 0.22);
                    hiss(audio, out, now, 0.06, 0.3, 3000, 900, 0.8);
                    tone(audio, out, 'sawtooth', 100, 100, now + 0.04, 0.9, 0.035);
                },
                'environment',
                AUDIO_PRIORITY.hit
            ),
        /** Ceremony: an entrance shutter rattling down and slamming shut. */
        ceremonyShutter: () =>
            play(
                (audio, now) => {
                    const out = bus();
                    for (let i = 0; i < 8; i++)
                        tone(audio, out, 'square', 260 + (i % 2) * 60, 200, now + i * 0.07, 0.03, 0.05);
                    hiss(audio, out, now, 0.6, 0.08, 2400, 800, 1.2);
                    tone(audio, out, 'sine', 90, 40, now + 0.6, 0.45, 0.6);
                    hiss(audio, out, now + 0.6, 0.18, 0.35, 1800, 400, 0.6);
                },
                'environment',
                AUDIO_PRIORITY.hit
            ),
        /** Ceremony finale: a volley of rockets whistling up from the parapet. */
        fireworkLaunch: () =>
            play((audio, now) => {
                const out = bus();
                for (let i = 0; i < 4; i++) {
                    tone(audio, out, 'sine', 600 + i * 90, 2400 + i * 200, now + i * 0.05, 1, 0.025);
                    hiss(audio, out, now + i * 0.05, 0.9, 0.05, 2000, 6000, 1.2);
                }
            }, 'environment', AUDIO_PRIORITY.hit),
        /** Ceremony finale: rockets bursting overhead (louder with more of them). */
        fireworkBurst: (count: number) =>
            play((audio, now) => {
                const out = bus();
                const n = Math.min(4, count);
                for (let i = 0; i < n; i++) {
                    const at = now + i * 0.07;
                    tone(audio, out, 'sine', 80, 30, at, 0.6, 0.35);
                    hiss(audio, out, at, 0.5, 0.25, 4000, 900, 0.7);
                    hiss(audio, out, at + 0.15, 0.9, 0.06, 7000, 3000, 2.5);
                }
            }, 'confirmation', AUDIO_PRIORITY.elimination),
        /** Ceremony: a ring of lamps striking on — a stadium-light boom, deeper and wider ring by ring. */
        ceremonyRing: (ring: number) =>
            play(
                (audio, now) => {
                    const out = bus();
                    const depth = 1 + ring * 0.12;
                    tone(audio, out, 'sine', 110 / depth, 34, now, 0.9 + ring * 0.1, 0.55);
                    tone(audio, out, 'triangle', 220 / depth, 80, now, 0.25, 0.18);
                    hiss(audio, out, now, 0.9 + ring * 0.15, 0.22, 5000, 600, 0.5);
                    tone(audio, out, 'sawtooth', 60, 60, now + 0.05, 1.2, 0.03 + ring * 0.005);
                },
                'confirmation',
                AUDIO_PRIORITY.elimination
            ),
        /** Interface hover: a very short, quiet tick. */
        uiHover: () =>
            play((audio, now) => {
                tone(audio, bus(), 'triangle', 2400, 2200, now, 0.025, 0.018);
            }, 'ui'),
        /** Interface confirm: a two-step click upward. */
        uiClick: () =>
            play((audio, now) => {
                tone(audio, bus(), 'square', 900, 860, now, 0.02, 0.03);
                tone(audio, bus(), 'triangle', 1500, 1700, now + 0.025, 0.06, 0.04);
            }, 'ui'),
        /** Interface tab change: a soft paper-like slide. */
        uiTab: () =>
            play((audio, now) => {
                hiss(audio, bus(), now, 0.07, 0.04, 2800, 5200, 1.6);
                tone(audio, bus(), 'triangle', 1200, 1300, now + 0.01, 0.04, 0.025);
            }, 'ui'),
        /** Interface back / close: the confirm click turned downward. */
        uiBack: () =>
            play((audio, now) => {
                tone(audio, bus(), 'triangle', 1500, 1000, now, 0.07, 0.035);
            }, 'ui'),
        /** Event-lane tick for a pickup, revive or drop elsewhere on the map. */
        feedTick: () =>
            play((audio, now) => {
                tone(audio, bus(), 'sine', 1320, 1320, now, 0.05, 0.03);
                tone(audio, bus(), 'sine', 1760, 1760, now + 0.05, 0.07, 0.022);
            }, 'ui'),
        /** Medal reveal: brighter and longer for rare and legendary medals. */
        medal: (tier: 'normal' | 'rare' | 'legend') =>
            play(
                (audio, now) => {
                    const out = bus();
                    const notes =
                        tier === 'legend' ? [659, 988, 1319, 1976] : tier === 'rare' ? [784, 1175, 1568] : [880, 1320];
                    notes.forEach((freq, index) =>
                        tone(audio, out, 'triangle', freq, freq, now + index * 0.055, 0.22, 0.07)
                    );
                    hiss(audio, out, now, tier === 'legend' ? 0.5 : 0.25, 0.05, 5000, 9000, 2);
                    if (tier === 'legend') tone(audio, out, 'sine', 110, 55, now, 0.6, 0.25);
                },
                'confirmation',
                AUDIO_PRIORITY.hit
            ),
        /** Picking up a skill item: a rising shimmer with a solid lock at the top. */
        skillPickup: () =>
            play(
                (audio, now) => {
                    const out = bus();
                    tone(audio, out, 'sawtooth', 220, 880, now, 0.28, 0.06);
                    tone(audio, out, 'triangle', 660, 1320, now + 0.04, 0.3, 0.08);
                    hiss(audio, out, now, 0.3, 0.08, 1500, 7000, 1.8);
                    tone(audio, out, 'square', 1760, 1700, now + 0.3, 0.04, 0.05);
                    tone(audio, out, 'sine', 1320, 1320, now + 0.32, 0.4, 0.05);
                },
                'confirmation',
                AUDIO_PRIORITY.hit
            ),
        /** Using a skill: a charged release; `kind` picks the colour of the sound. */
        skillUse: (kind: 'heal' | 'pulse' | 'stealth' | 'still' | 'power') =>
            play(
                (audio, now) => {
                    const out = bus();
                    if (kind === 'heal') {
                        [523, 659, 784, 1047].forEach((f, i) =>
                            tone(audio, out, 'sine', f, f, now + i * 0.06, 0.5, 0.06)
                        );
                    } else if (kind === 'pulse') {
                        tone(audio, out, 'sine', 90, 45, now, 0.6, 0.35);
                        tone(audio, out, 'triangle', 1760, 880, now, 0.5, 0.06);
                        hiss(audio, out, now, 0.6, 0.1, 400, 3000, 1.2);
                    } else if (kind === 'stealth') {
                        hiss(audio, out, now, 0.5, 0.12, 6000, 600, 1.4);
                        tone(audio, out, 'sine', 880, 220, now, 0.5, 0.05);
                    } else if (kind === 'still') {
                        tone(audio, out, 'sine', 1200, 300, now, 0.9, 0.08);
                        tone(audio, out, 'sine', 60, 40, now, 1, 0.3);
                        hiss(audio, out, now, 0.15, 0.2, 3000, 800, 0.8);
                    } else {
                        tone(audio, out, 'sawtooth', 110, 440, now, 0.25, 0.12);
                        tone(audio, out, 'square', 880, 1760, now + 0.08, 0.2, 0.05);
                        hiss(audio, out, now, 0.3, 0.14, 1200, 6000, 1.5);
                    }
                },
                'combat',
                AUDIO_PRIORITY.hit
            ),
        /** Starting to aim: a soft mechanical slide that rises with the zoom. */
        scopeIn: () =>
            play((audio, now) => {
                hiss(audio, bus(), now, 0.5, 0.07, 500, 2400, 2);
                tone(audio, bus(), 'sine', 220, 440, now, 0.6, 0.05);
            }),
        /** Fully aimed: a crisp lock click and a held high tone. */
        scopeReady: () =>
            play((audio, now) => {
                tone(audio, bus(), 'square', 1800, 1700, now, 0.03, 0.07);
                tone(audio, bus(), 'square', 2400, 2300, now + 0.05, 0.03, 0.06);
                tone(audio, bus(), 'sine', 880, 880, now + 0.06, 0.35, 0.05);
            }),
        /** Sniper release: a sharp crack and a fast, thin whoosh (positioned for other players' throws). */
        sniperThrow: (at?: V3) =>
            play((audio, now) => {
                if (playTestClip(audio, 'throw', at) || playCombatClip(audio, 'throw', at)) return;
                const out = output(audio, at);
                hiss(audio, out, now, 0.08, 0.5, 4000, 1500, 0.8);
                tone(audio, out, 'sawtooth', 900, 120, now, 0.12, 0.2);
                hiss(audio, out, now + 0.03, 0.45, 0.35, 2600, 6000, 2.4);
            }),
        /** Sniper or golden elimination; gold always keeps a distinct cue, including while its clip loads. */
        snipeConfirm: (head = true, golden = false) =>
            play(
                (audio, now) => {
                    if (golden) {
                        if (playTestClip(audio, 'goldKill') || playCombatClip(audio, 'goldKill')) return;
                        // The first confirmation can arrive before the selected WAV has decoded. Never
                        // fall through to the ordinary kill/head clip: that made golden eliminations
                        // indistinguishable whenever the asset was still loading or unavailable.
                        tone(audio, bus(), 'sawtooth', 196, 392, now, 0.34, 0.28);
                        tone(audio, bus(), 'triangle', 784, 1568, now + 0.04, 0.58, 0.22);
                        tone(audio, bus(), 'triangle', 1174, 1760, now + 0.12, 0.46, 0.16);
                        hiss(audio, bus(), now + 0.02, 0.32, 0.16, 4200, 9000, 2.5);
                        return;
                    }
                    const cue = head ? 'head' : 'kill';
                    if (playTestClip(audio, cue) || playCombatClip(audio, cue)) return;
                    tone(audio, bus(), 'sine', 120, 40, now, 0.5, 0.7);
                    tone(audio, bus(), 'triangle', 1760, 1700, now + 0.02, 0.5, 0.3);
                    tone(audio, bus(), 'triangle', 2640, 2600, now + 0.1, 0.6, 0.22);
                    hiss(audio, bus(), now, 0.12, 0.3, 6000, 2000, 0.7);
                },
                'confirmation',
                golden ? AUDIO_PRIORITY.critical : AUDIO_PRIORITY.elimination
            ),
        /** The golden disc appears (or is dropped): a shimmering rising chime. */
        goldChime: (at?: V3) =>
            play(
                (audio, now) => {
                    const out = output(audio, at);
                    [1046, 1318, 1568, 2093].forEach((f, i) =>
                        tone(audio, out, 'triangle', f, f, now + i * 0.07, 0.6, 0.12)
                    );
                    hiss(audio, out, now, 0.9, 0.06, 5000, 9000, 3);
                },
                'confirmation',
                AUDIO_PRIORITY.action
            ),
        /** You took the golden disc: a short brass-like fanfare over a shimmer. */
        goldTaken: () =>
            play(
                (audio, now) => {
                    const out = bus();
                    [523, 659, 784, 1046].forEach((f, i) => {
                        tone(audio, out, 'sawtooth', f, f, now + i * 0.09, 0.22, 0.09);
                        tone(audio, out, 'triangle', f * 2, f * 2, now + i * 0.09, 0.3, 0.06);
                    });
                    tone(audio, out, 'sawtooth', 1046, 1046, now + 0.36, 0.7, 0.1);
                    hiss(audio, out, now + 0.3, 1, 0.07, 6000, 10000, 3);
                },
                'confirmation',
                AUDIO_PRIORITY.elimination
            ),
        /** Someone else took the golden disc: a low warning swell. */
        goldLost: () =>
            play(
                (audio, now) => {
                    tone(audio, bus(), 'sawtooth', 220, 165, now, 0.5, 0.12);
                    tone(audio, bus(), 'sawtooth', 277, 207, now + 0.05, 0.5, 0.08);
                },
                'confirmation',
                AUDIO_PRIORITY.action
            ),
        /** Golden disc inspect: a rising shimmer while it spins, then the bright catch. */
        goldInspect: (seconds: number, tossAt: number, catchAt: number) =>
            play((audio, now) => {
                const out = bus();
                tone(audio, out, 'sine', 440, 1760, now + 0.1 * seconds, 0.28 * seconds, 0.07);
                hiss(audio, out, now + 0.1 * seconds, 0.28 * seconds, 0.06, 3000, 12000, 4);
                hiss(audio, out, now + tossAt * seconds - 0.05, 0.25, 0.18, 1200, 5000, 1.6);
                [1568, 2093, 2637].forEach((f, i) =>
                    tone(audio, out, 'triangle', f, f, now + catchAt * seconds + i * 0.04, 0.5, 0.1)
                );
                tone(audio, out, 'sine', 140, 60, now + catchAt * seconds, 0.3, 0.4);
            }),
        /** Shared one-shot cue for the four-minute blackout and a player-triggered breaker outage. */
        blackout: () =>
            play(
                (audio, now) => {
                    if (playClip(audio, 'power-down', POWER_DOWN_AUDIO.gain)) return;
                    tone(audio, bus(), 'sine', 90, 30, now, 1.4, 0.8);
                    tone(audio, bus(), 'sawtooth', 120, 40, now, 1.6, 0.12);
                    hiss(audio, bus(), now, 0.3, 0.2, 2000, 300, 1);
                },
                'environment',
                AUDIO_PRIORITY.critical
            ),
        /** 纪老师's whistle: two sharp blasts. */
        whistle: () =>
            play((audio, now) => {
                for (const start of [0, 0.32]) {
                    tone(audio, bus(), 'square', 2900, 2850, now + start, 0.24, 0.09);
                    tone(audio, bus(), 'sine', 3100, 3050, now + start, 0.24, 0.06);
                    hiss(audio, bus(), now + start, 0.24, 0.05, 3000, 3200, 8);
                }
            }, 'environment'),
        /** Round over: a triumphant chord if you won, a falling one otherwise. */
        roundEnd: (won: boolean, outcome: 'golden-disc' | 'last-survivor' | 'draw' | 'george-reboot') =>
            play(
                (audio, now) => {
                    const notes =
                        outcome === 'draw'
                            ? [392, 370, 349]
                            : won
                              ? outcome === 'golden-disc'
                                  ? [523, 659, 784, 1046, 1318]
                                  : [440, 554, 659, 880, 1175]
                              : outcome === 'golden-disc'
                                ? [392, 349, 311, 262]
                                : [349, 330, 294, 220];
                    notes.forEach((f, i) => tone(audio, bus(), 'triangle', f, f, now + i * 0.12, 0.9, 0.14));
                },
                'confirmation',
                AUDIO_PRIORITY.critical
            ),
        /** A new round starts. */
        roundStart: () =>
            play(
                (audio, now) => {
                    [0, 0.5, 1].forEach((t) => tone(audio, bus(), 'square', 880, 880, now + t, 0.12, 0.06));
                    tone(audio, bus(), 'square', 1760, 1760, now + 1.5, 0.4, 0.08);
                },
                'confirmation',
                AUDIO_PRIORITY.elimination
            ),
        /** Picked a disc up: a quick bright double click. */
        pickup: () =>
            play((audio, now) => {
                tone(audio, bus(), 'triangle', 880, 1320, now, 0.08, 0.12);
                tone(audio, bus(), 'triangle', 1320, 1760, now + 0.07, 0.1, 0.1);
            }),
        /** Disc release: an airy whoosh (positioned for other players' throws). */
        throw: (at?: V3) =>
            play((audio, now) => {
                if (playTestClip(audio, 'throw', at) || playCombatClip(audio, 'throw', at)) return;
                const out = output(audio, at);
                hiss(audio, out, now, 0.32, 0.5, 900, 2600, 1.6);
                tone(audio, out, 'triangle', 240, 140, now, 0.08, 0.12);
            }),
        /** One short spatial fly-by cue per remote disc, so nearby trajectories are readable without looping noise. */
        flyby: (at: V3, speed: number) =>
            play((audio, now) => {
                const out = output(audio, at);
                const intensity = Math.max(0.1, Math.min(0.24, (speed - 6) * 0.012));
                hiss(audio, out, now, 0.16, intensity, 1800, 5200, 1.4);
                tone(audio, out, 'sine', 520, 260, now, 0.11, intensity * 0.45);
            }),
        /** Disc striking a wall or floor. */
        bounce: (at: V3, strength: number) =>
            play((audio, now) => {
                if (playTestClip(audio, 'bounce', at)) return;
                const out = output(audio, at);
                tone(audio, out, 'square', 320, 180, now, 0.05, Math.min(0.12, 0.03 + strength * 0.01));
            }),
        /** Your disc hit someone: head takes precedence over kill, then a nonlethal body hit. */
        hitConfirm: (eliminated: boolean, head = false) =>
            play(
                (audio, now) => {
                    const cue = head ? 'head' : eliminated ? 'kill' : 'hit';
                    if (playTestClip(audio, cue) || playCombatClip(audio, cue)) return;
                    tone(audio, bus(), 'sine', 1320, 1250, now, 0.09, 0.32);
                    tone(audio, bus(), 'sine', 1980, 1900, now + 0.03, 0.12, 0.2);
                    // Head hits ring higher and longer.
                    if (head) tone(audio, bus(), 'triangle', 2640, 2600, now + 0.06, 0.22, 0.22);
                    if (eliminated && !playClip(audio, 'legacy-kill', 1.1)) {
                        tone(audio, bus(), 'triangle', 660, 660, now + 0.12, 0.16, 0.28);
                        tone(audio, bus(), 'triangle', 990, 990, now + 0.24, 0.26, 0.28);
                    }
                },
                'confirmation',
                eliminated ? AUDIO_PRIORITY.critical : AUDIO_PRIORITY.hit
            ),
        /** Your own elimination streak: a rising two-note sting, one step higher per kill (1–5). */
        streak: (count: number) =>
            play(
                (audio, now) => {
                    const step = Math.min(5, Math.max(1, count)) - 1;
                    const base = 520 * Math.pow(2, (step * 2) / 12);
                    tone(audio, bus(), 'triangle', base, base, now + 0.05, 0.12, 0.2);
                    tone(audio, bus(), 'triangle', base * 1.5, base * 1.5, now + 0.13, 0.18 + step * 0.03, 0.2);
                    // A low body under the eliminations that land the blow.
                    tone(audio, bus(), 'sine', 110, 48, now, 0.22, 0.45);
                },
                'confirmation',
                AUDIO_PRIORITY.elimination
            ),
        /** A spectator in the stands: a cheer swell, a light-stick whoosh or a confetti pop (positioned). */
        crowd: (at: V3, kind: 'cheer' | 'stick' | 'confetti') =>
            play((audio, now) => {
                const out = output(audio, at);
                if (kind === 'cheer') {
                    hiss(audio, out, now, 0.9, 0.5, 900, 1600, 0.7);
                    hiss(audio, out, now + 0.08, 0.8, 0.35, 1500, 2400, 0.9);
                } else if (kind === 'stick') {
                    hiss(audio, out, now, 0.35, 0.3, 2600, 900, 1.6);
                } else {
                    tone(audio, out, 'triangle', 900, 300, now, 0.08, 0.35);
                    hiss(audio, out, now + 0.02, 0.5, 0.25, 4000, 6000, 0.8);
                }
            }, 'environment'),
        /** The throw is fully charged: one short, bright ding. */
        chargeFull: () =>
            play(
                (audio, now) => {
                    tone(audio, bus(), 'sine', 2093, 2093, now, 0.09, 0.12);
                    tone(audio, bus(), 'sine', 3136, 3136, now + 0.015, 0.07, 0.06);
                },
                'ui',
                AUDIO_PRIORITY.action
            ),
        /** You were hit: a thud with a low buzz; the "defeat" clip when it eliminates you. */
        hurt: (eliminated: boolean) =>
            play(
                (audio, now) => {
                    tone(audio, bus(), 'sine', 160, 55, now, 0.28, 0.75);
                    hiss(audio, bus(), now, 0.18, 0.4, 600, 200, 0.8);
                    if (eliminated) {
                        defeatVoice = playClip(audio, 'defeat', 0.9);
                        if (!defeatVoice) tone(audio, bus(), 'sawtooth', 440, 110, now + 0.1, 0.7, 0.18);
                    }
                },
                'confirmation',
                eliminated ? AUDIO_PRIORITY.critical : AUDIO_PRIORITY.action
            ),
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
            play(
                (audio, now) => {
                    tone(audio, bus(), 'triangle', 520, 520, now, 0.12, 0.12);
                    tone(audio, bus(), 'triangle', 390, 390, now + 0.12, 0.18, 0.12);
                },
                'confirmation',
                AUDIO_PRIORITY.action
            ),
        respawn: () =>
            play((audio, now) => {
                for (const [k, f] of [523, 659, 784].entries())
                    tone(audio, bus(), 'sine', f, f, now + k * 0.07, 0.2, 0.18);
            }, 'ui'),
        join: () =>
            play((audio, now) => {
                tone(audio, bus(), 'sine', 880, 880, now, 0.08, 0.06);
            }, 'ui')
    };
};

export type Sound = ReturnType<typeof createSound>;
