// Kill feed and kill banner content (pure; tested in test/kill-feed.test.js). Every icon has one fixed meaning.
import { LONG_SHOT_METRES } from '../config/bounce.ts';

export type KillIcon = 'disc' | 'head' | 'sniper' | 'execution' | 'gold' | 'guard' | 'bank' | 'long';

export type KillFacts = {
    head: boolean;
    sniper: boolean;
    gold: boolean;
    execution: boolean;
    /** Eliminated by the night guard's flashlight. */
    guard: boolean;
    bank: boolean;
    range: number | null;
};

export const KILL_ICON_LABEL: Record<KillIcon, string> = {
    disc: '飞盘淘汰',
    head: '爆头',
    sniper: '狙击',
    execution: '处决',
    gold: '金飞盘',
    guard: '保安手电',
    bank: '反弹击杀',
    long: '远射'
};

/** Weapon icon first (what eliminated them), then modifiers (how). */
export const killIcons = (facts: KillFacts): KillIcon[] => {
    if (facts.guard) return ['guard'];
    if (facts.execution) return ['execution'];
    const icons: KillIcon[] = [facts.gold ? 'gold' : facts.sniper ? 'sniper' : 'disc'];
    if (facts.head) icons.push('head');
    if (facts.bank) icons.push('bank');
    if (facts.range !== null && facts.range >= LONG_SHOT_METRES) icons.push('long');
    return icons;
};

/** Streaks within this window (ms) of the previous own elimination count up on the kill banner. */
export const STREAK_WINDOW_MS = 12_000;
export const STREAK_NAMES = ['淘汰', '双杀', '三杀', '四杀', '五杀'] as const;
export const streakName = (count: number) =>
    count <= STREAK_NAMES.length ? STREAK_NAMES[count - 1] : `${count} 连淘汰`;

/** Inline 16×16 glyphs, drawn with currentColor so tones apply. */
export const KILL_ICON_SVG: Record<KillIcon, string> = {
    disc: '<ellipse cx="8" cy="8" rx="6.5" ry="3.2"/><ellipse cx="8" cy="7.4" rx="3" ry="1.2"/>',
    head: '<circle cx="8" cy="8" r="5.6"/><path d="M8 0.8v4M8 11.2v4M0.8 8h4M11.2 8h4"/>',
    sniper: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><path d="M8 2v3M8 11v3M2 8h3M11 8h3"/>',
    execution: '<path d="M3 13 13 3M9.5 3H13v3.5M3 9.5V13h3.5"/>',
    gold: '<ellipse cx="8" cy="8" rx="6.5" ry="3.2" fill="currentColor"/><path d="M8 1.5v2M3 2.8l1.2 1.4M13 2.8l-1.2 1.4"/>',
    guard: '<path d="M2 6h5l6-3v10l-6-3H2z"/>',
    bank: '<path d="M2 13 8 4l6 9"/><path d="M5.8 4H10" stroke-dasharray="1.6 1.4"/>',
    long: '<path d="M1.5 8h13M4 6v4M8 5v6M12 6v4"/>'
};
