// Wire protocol shared by the browser client and the Cloudflare Durable Object room (server/). JSON over WebSocket.
// Pure: no engine or runtime imports, so the server bundle and node tests can import it directly.
//
// Authority model (GAMEPLAY_AUTHORED, first multiplayer slice):
// - Each client owns its movement and sends its pose; the room relays poses as snapshots.
// - A throw is announced to the room; every client simulates the disc locally against the level colliders.
// - The thrower's client detects hits (it sees the flight it launched) and claims them; the room validates the
//   claim (throw exists and is recent, one hit per throw, both players alive, target within reach of the throw)
//   and alone decides eliminations and respawns.

import type { PowerState } from '../gameplay/power.ts';
export type { PowerState } from '../gameplay/power.ts';

export const PROTOCOL_VERSION = 7;
export const MAX_PLAYERS = 32;
export const SNAPSHOT_HZ = 20;
export const POSE_HZ = 20;
/** Seconds a player stays out after a hit before respawning. */
export const RESPAWN_SECONDS = 2.5;
/** Minimum seconds between two throws by the same player. */
export const THROW_COOLDOWN = 0.45;
/** Seconds after (re)spawning during which a player cannot be hit. */
export const SPAWN_PROTECTION = 1.5;
/** A disc can score for this long after release (client side). */
export const THROW_LIFETIME = 4;
/** The room accepts hit claims for this long after a throw (slack for slow clients and latency). */
export const THROW_CLAIM_WINDOW = 8;
/** Hits a player can take; the last one eliminates. */
export const MAX_HP = 2;
/** Seconds without being hit before a damaged player is healed to full. */
export const HEAL_SECONDS = 10;
/** Points: one per elimination (hits alone score nothing). */
export const POINTS = { hit: 0, elimination: 1 } as const;
/** Fastest launch speed a client may claim (m/s), plus the thrower's own velocity allowance. */
export const MAX_THROW_SPEED = 26;
export const NAME_MAX = 16;
/** World chat: longest message, and at most `burst` messages per `windowSeconds`. */
export const CHAT = { max: 120, burst: 4, windowSeconds: 6, history: 40 } as const;
/** A hit this far above the capsule centre (m) is a head hit. */
export const HEAD_ABOVE = 0.45;
/**
 * Sniper throws (a fully aimed charge): launched at `speed`, they fly dead straight (no drop, no lift) for
 * `straightSeconds`. Every disc headshot is lethal; the sniper flag adds flight/feedback only, at ≥ `minSpeed`.
 */
export const SNIPER = { speed: 34, minSpeed: 30, straightSeconds: 1.6 } as const;
/**
 * Rounds: the 金飞盘 (golden disc) appears at a random spawn point; walk within `pickupRadius` to take it; whoever
 * holds it when the `roundSeconds` clock runs out wins. Holders drop it where they are eliminated (or leave).
 */
export const ROUND = {
    roundSeconds: 600,
    intermissionSeconds: 10,
    pickupRadius: 1.6,
    pickupDelay: 0.8,
    /**
     * With this long left the lights go out and the night guard starts his rounds: from then on an elimination (by
     * disc or by his flashlight) is final for the round, and if only one player is left standing they win at once.
     */
    blackoutSecondsLeft: 180,
    /** Chance that a golden-disc throw leaves an ordinary disc where it comes down. */
    goldDropChance: 0.35,
    /** The golden disc's holder moves this much slower… */
    goldSpeedFactor: 0.7,
    /** …and after every `goldBurst` throws must wait `goldCooldown` seconds. */
    goldBurst: 5,
    goldCooldown: 3,
    /** With this long left everyone still in the game is brought to the 莲花球场 for the final showdown. */
    finalSecondsLeft: 60
} as const;
/**
 * Disc ammunition: a thrown disc stays where it lands and has to be picked up again (walk within `pickupRadius`).
 * Everyone carries at most `max`; joining and every respawn hand out a full load (`start`). The PE office puts out a fresh disc every
 * `officeSeconds` (at most `officeMax` lying there). The golden disc is never used up: it returns to its holder.
 */
export const AMMO = { start: 3, max: 3, pickupRadius: 1.5, officeSeconds: 60, officeMax: 3 } as const;
/** A disc lying on the floor, waiting to be picked up. */
export type GroundDisc = { id: number; at: Vec3Tuple };
/** 纪老师 catches a throw inside his view: the thrower stands still for this long. */
export const DETENTION_SECONDS = 4;

/** Where the golden disc is: lying somewhere (`at`), or carried by `holder`. */
export type GoldState = { holder: string | null; at: Vec3Tuple };
/** The current round: playing until `endsAt` (room clock), or ended with a winner (name, or null) until `nextAt`. */
export type RoundState =
    | { phase: 'playing'; endsAt: number }
    | { phase: 'ended'; winner: string | null; winnerId: string | null; nextAt: number };

export type Vec3Tuple = [number, number, number];

export type PlayerPose = {
    /** Capsule centre. */
    p: Vec3Tuple;
    /** Camera yaw and pitch, degrees. */
    yaw: number;
    pitch: number;
    /** How far into a sniper aim the player is (0–1), so others can see the scope glint. */
    aim?: number;
};

export type PlayerSummary = {
    id: string;
    name: string;
    /** Signed in with a registered account (stats are kept). */
    account: boolean;
    colour: number;
    alive: boolean;
    /** Out for the rest of the round (eliminated after the lights went out): watching only. */
    spectating?: boolean;
    hp: number;
    score: number;
    kills: number;
    deaths: number;
};

/** A pose stamped with the room's receive time (ms, server clock). */
export type StampedPose = PlayerPose & { t: number };

/** Lifetime stats of a registered account. */
export type AccountStats = {
    name: string;
    kills: number;
    deaths: number;
    hits: number;
    score: number;
    wins: number;
    rounds: number;
};

/** The standing 淘汰王: the registered player with the most lifetime eliminations, held until beaten. */
export type King = { name: string; kills: number; since: number };

export type ChatLine = { id: number; t: number; name: string; colour: number; text: string; system?: true };

/** Per-player [score, eliminations, times eliminated]. */
export type Scores = Record<string, [number, number, number]>;

export type ThrowRecord = {
    /** Thrower-local id, unique per thrower. */
    id: number;
    /** Launch position and velocity (m, m/s) and the disc's tilt (radians about its flight direction). */
    o: Vec3Tuple;
    v: Vec3Tuple;
    tilt: number;
    /** A fully aimed sniper throw (see SNIPER). */
    sniper?: boolean;
};

export type ClientMessage =
    | { type: 'hello'; version: number; name: string; token?: string }
    | { type: 'chat'; text: string }
    /** `ct`: the sender's own clock (ms) when the pose was sampled, so the room can stamp it without network jitter. */
    | { type: 'pose'; pose: PlayerPose; ct?: number }
    | { type: 'throw'; throw: ThrowRecord }
    | { type: 'hit'; throwId: number; target: string; at: Vec3Tuple }
    /** The sender's own disc came to rest at `at` (it now lies there for anyone to pick up). */
    | { type: 'landed'; throwId: number; at: Vec3Tuple }
    /** The sender was caught in the night guard's flashlight. */
    | { type: 'spotted' }
    | { type: 'pullBreaker' }
    /** The sender threw inside 纪老师's view and is standing still for DETENTION_SECONDS. */
    | { type: 'caught' }
    /** Latency probe: the room echoes `c` straight back. */
    | { type: 'ping'; c: number }
    | { type: 'respawned'; pose: PlayerPose };

export type ServerMessage =
    | {
          type: 'welcome';
          id: string;
          name: string;
          players: PlayerSummary[];
          account: AccountStats | null;
          king: King | null;
          chat: ChatLine[];
          round: RoundState;
          power: PowerState;
          gold: GoldState;
          ammo: number;
          discs: GroundDisc[];
          /** Room clock now (ms), so the patrol and countdown line up before the first snapshot. */
          t: number;
      }
    | { type: 'rejected'; reason: 'version' | 'full' | 'protocol' | 'auth' }
    | { type: 'joined'; player: PlayerSummary }
    | { type: 'left'; id: string }
    | { type: 'snapshot'; t: number; poses: Record<string, StampedPose> }
    | { type: 'thrown'; from: string; t: number; throw: ThrowRecord }
    | {
          type: 'struck';
          target: string;
          by: string;
          hp: number;
          out: boolean;
          head: boolean;
          /** Sniper disc: a head hit with one eliminates outright. */
          sniper: boolean;
          /** Thrown by the golden disc's holder. */
          gold: boolean;
          /** Out for the rest of the round (after the lights went out): no respawn, watch instead. */
          final?: boolean;
          at: Vec3Tuple;
          scores: Scores;
      }
    | { type: 'chat'; line: ChatLine }
    | { type: 'king'; king: King; isNew: boolean }
    | { type: 'account'; account: AccountStats }
    | { type: 'healed'; id: string; hp: number }
    | { type: 'respawn'; id: string; spawn: number }
    | { type: 'gold'; gold: GoldState; event: 'spawned' | 'taken' | 'dropped' }
    | { type: 'round'; round: RoundState; scores: Scores }
    | { type: 'caught'; id: string }
    /** Your disc count changed. */
    | { type: 'ammo'; ammo: number }
    /** Discs lying around changed (`added`: a fresh one appeared, e.g. at the PE office). */
    | { type: 'discs'; discs: GroundDisc[]; added?: { id: number; office: boolean } }
    | { type: 'pong'; c: number }
    | { type: 'power'; power: PowerState };

/** Cleans a player-supplied nickname: trims, drops control/format characters, caps the length. */
export const cleanName = (raw: unknown) => {
    if (typeof raw !== 'string') return '';
    const cleaned = raw
        .normalize('NFKC')
        .replace(/[\p{C}<>]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    return [...cleaned].slice(0, NAME_MAX).join('');
};

export const randomName = (random: () => number = Math.random) =>
    `飞盘手${String(Math.floor(random() * 1000)).padStart(3, '0')}`;

/** A stable, well-spread avatar hue (0..359) for a player id. */
export const colourFor = (id: string) => {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return ((hash >>> 0) % 12) * 30;
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const isVec3 = (value: unknown): value is Vec3Tuple =>
    Array.isArray(value) && value.length === 3 && value.every(isNumber);
export const isPose = (value: unknown): value is PlayerPose => {
    const pose = value as PlayerPose;
    return (
        !!pose &&
        isVec3(pose.p) &&
        isNumber(pose.yaw) &&
        isNumber(pose.pitch) &&
        (pose.aim === undefined || isNumber(pose.aim))
    );
};

/** Parses and shape-checks a client message; anything malformed returns null. */
export const parseClientMessage = (text: string): ClientMessage | null => {
    if (text.length > 2048) return null;
    let value: Record<string, unknown>;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    switch (value.type) {
        case 'hello':
            return isNumber(value.version) &&
                typeof value.name === 'string' &&
                (value.token === undefined || typeof value.token === 'string')
                ? (value as ClientMessage)
                : null;
        case 'chat':
            return typeof value.text === 'string' ? (value as ClientMessage) : null;
        case 'caught':
            return value as ClientMessage;
        case 'ping':
            return isNumber(value.c) ? (value as ClientMessage) : null;
        case 'spotted':
        case 'pullBreaker':
            return value as ClientMessage;
        case 'landed':
            return isNumber(value.throwId) && isVec3(value.at) ? (value as ClientMessage) : null;
        case 'pose':
            return isPose(value.pose) && (value.ct === undefined || isNumber(value.ct))
                ? (value as ClientMessage)
                : null;
        case 'respawned':
            return isPose(value.pose) ? (value as ClientMessage) : null;
        case 'throw': {
            const record = value.throw as ThrowRecord;
            return record && isNumber(record.id) && isVec3(record.o) && isVec3(record.v) && isNumber(record.tilt)
                ? (value as ClientMessage)
                : null;
        }
        case 'hit':
            return isNumber(value.throwId) && typeof value.target === 'string' && isVec3(value.at)
                ? (value as ClientMessage)
                : null;
        default:
            return null;
    }
};

/** Cleans a chat message: no control/format characters, collapsed spaces, capped length. Empty means drop. */
export const cleanChat = (raw: unknown) => {
    if (typeof raw !== 'string') return '';
    const cleaned = raw
        .normalize('NFKC')
        .replace(/[\p{C}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
    return [...cleaned].slice(0, CHAT.max).join('');
};
