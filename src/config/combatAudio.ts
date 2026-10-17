// Owner-selected video clips. Gain is before the existing 0.55 master, matching the audio lab.
export const COMBAT_AUDIO = {
    hit: { url: '/assets/audio/body-hit-v10.wav', gain: 0.35, start: 0, end: 0.54299 },
    kill: { url: '/assets/audio/kill-v12.wav', gain: 0.35, start: 0, end: 0.74299 },
    head: { url: '/assets/audio/headshot-v16.wav', gain: 0.35, start: 0, end: 1.05299 },
    goldKill: { url: '/assets/audio/gold-kill-06-01.wav', gain: 0.35, start: 0, end: 0.93 }
} as const;
