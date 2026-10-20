// Wire protocol shared by the browser client and the Cloudflare Durable Object room (server/). JSON over WebSocket.
// Pure: no engine or runtime imports, so the server bundle and node tests can import it directly.
//
// Authority model (GAMEPLAY_AUTHORED, first multiplayer slice):
// - Each client owns its movement and sends its pose; the room relays poses as snapshots.
// - A throw is announced to the room; every client simulates the disc locally against the level colliders.
// - The thrower's client detects hits (it sees the flight it launched) and claims them; the room validates the
//   claim (throw exists and is recent, one hit per throw, both players alive, target within reach of the throw)
//   and alone decides eliminations and respawns.

import type { MomentCutscene } from '../gameplay/cutscenes/cutscenes.ts';
import type { Execution } from '../gameplay/execution.ts';
import type { GlobalFinisher } from '../gameplay/finisher/FinisherTypes.ts';
import type { PowerState } from '../gameplay/power.ts';
export type { PowerState } from '../gameplay/power.ts';

// George Protocol changes both private welcome state and the authoritative round outcome.
export const PROTOCOL_VERSION = 16;
export const MAX_PLAYERS = 32;
/** Initial authoritative logic scheduler; stays aligned with snapshots until publication is separately scheduled. */
export const GAME_TICK_HZ = 20;
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
export const MAX_HP = 3;
/** Seconds without being hit before a damaged player is healed to full. */
export const HEAL_SECONDS = 10;
/** Points: one per elimination (hits alone score nothing). */
export const POINTS = { hit: 0, elimination: 1 } as const;
/** Fastest launch speed a client may claim (m/s), plus the thrower's own velocity allowance. */
export const MAX_THROW_SPEED = 26;
export const NAME_MAX = 16;
/** World chat: longest message, and at most `burst` messages per `windowSeconds`. */
export const CHAT = { max: 120, burst: 4, windowSeconds: 6, history: 40 } as const;
/**
 * The swept disc centre must reach the visual head region to count as a head hit. The 2.1 m runtime mannequin's
 * head starts about 0.86 m above the 0.92 m capsule centre; subtracting the 0.135 m disc radius gives a 0.725 m
 * contact-centre threshold, rounded to 0.72 m. This keeps shoulder/neck contacts in the body region.
 */
export const HEAD_ABOVE = 0.72;
export const isHeadHit = (contactY: number, capsuleCentreY: number) => contactY - capsuleCentreY > HEAD_ABOVE;
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
    /** Keep an abandoned room's active round available for signed-in players to reconnect. */
    emptyRoomGraceSeconds: 120,
    pickupRadius: 1.6,
    pickupDelay: 0.8,
    /**
     * With this long left the lights go out and the night guard starts his rounds: from then on an elimination (by
     * disc or by his flashlight) is final for the round, and if only one player is left standing they win at once.
     */
    blackoutSecondsLeft: 240,
    /** Chance that a golden-disc throw leaves an ordinary disc where it comes down. */
    goldDropChance: 0.35,
    /** The golden disc's holder moves this much slower… */
    goldSpeedFactor: 0.7,
    /** …and after every `goldBurst` throws must wait `goldCooldown` seconds. */
    goldBurst: 5,
    goldCooldown: 3,
    /** With this long left everyone still in the game is brought to the 莲花球场 for the final showdown. */
    finalSecondsLeft: 60,
    /**
     * The entrance ceremony plays in the seconds just before the final minute (gameplay/ceremony): everyone is frozen
     * and walks in on screen; nobody can be caught or hit during it.
     */
    ceremonySeconds: 26,
    /** Event cutscenes (gameplay/cutscenes): nobody can act, be hit or be caught while they play. */
    blackoutCutsceneSeconds: 4.8,
    breakerCutsceneSeconds: 4.2,
    /** The guard sets off on his night rounds this long after the lights go out (on camera in the cutscene). */
    guardNightDelaySeconds: 3.2
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
export type RoundOutcome = 'golden-disc' | 'last-survivor' | 'draw' | 'george-reboot';
/** The current round: playing until `endsAt` (room clock), or ended with a winner (name, or null) until `nextAt`. */
export type RoundState =
    | { phase: 'playing'; endsAt: number }
    | {
          phase: 'ended';
          winner: string | null;
          winnerId: string | null;
          outcome: RoundOutcome;
          nextAt: number;
      };

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
    /** Lobby occupants are visible and can chat, but do not take part in the current round. */
    phase: 'lobby' | 'playing';
    /** Signed in with a registered account (stats are kept). */
    account: boolean;
    colour: number;
    alive: boolean;
    /** Out for the rest of the round (eliminated after the lights went out): watching only. */
    spectating?: boolean;
    /** Match-clock deadline for an ordinary elimination; sent in welcome so refresh cannot skip the wait. */
    respawnAt?: number;
    /** True while revive armor is returning this player to the same position after its 3 second delay. */
    revivePending?: boolean;
    hp: number;
    score: number;
    kills: number;
    deaths: number;
    /** Public, opaque R2 object reference for the mannequin head texture. */
    avatarId?: string | null;
    avatarVersion?: string | null;
    hasReviveArmor?: boolean;
    /** Already collected this round's armor, even if it was dropped or consumed. */
    reviveTaken?: boolean;
    hasFrc?: boolean;
    hasEye?: boolean;
    hasStealth?: boolean;
    hasCreation?: boolean;
    hasFlashlight?: boolean;
    coachGift?: boolean;
    ammoCapacity?: number;
    stealthUntil?: number;
    stealthCooldownUntil?: number;
    /** Equipped disc skin (null: the default disc in the player's colour), its 计数器 and its count. */
    skin?: string | null;
    skinCounter?: boolean;
    skinKills?: number;
    frcSelected?: boolean;
    frcCooldownUntil?: number;
    creationNextAt?: number;
};

export type WorldItem = {
    id: string;
    kind: 'revive' | 'frc' | 'eye' | 'stealth' | 'creation' | 'flashlight';
    name: string;
    at: Vec3Tuple;
    holder: string | null;
    available: boolean;
    returnAt: number | null;
    cooldownUntil: number;
};

/** A pose stamped with the room's receive time (ms, server clock). */
export type StampedPose = PlayerPose & { t: number; /** Changes only when the authoritative pose changes, allowing cheap delta comparison. */ rev?: number };

/** Lifetime stats of a registered account. */
export type AccountStats = {
    name: string;
    kills: number;
    deaths: number;
    hits: number;
    score: number;
    wins: number;
    rounds: number;
    /** Losses recorded since the loss-only display baseline was initialized. */
    losses: number;
    avatarId?: string | null;
    avatarVersion?: string | null;
    /** Skin points: +1 per elimination, +10 per round won. */
    points?: number;
    /** Owned disc skins (id → edition and counted eliminations). */
    skins?: Record<string, { counter: boolean; kills: number }>;
    /** The skin thrown in play, or null for the default disc. */
    equippedSkin?: string | null;
};

/** The standing 淘汰王: the registered player with the most lifetime eliminations, held until beaten. */
export type King = { name: string; kills: number; since: number };

/** `dead`: written by an eliminated (spectating) player; only other spectators receive it while the round plays. */
export type ChatLine = {
    id: number;
    t: number;
    name: string;
    colour: number;
    text: string;
    system?: true;
    dead?: true;
};

/** Per-player [score, eliminations, times eliminated]. */
export type Scores = Record<string, [number, number, number]>;

export type GeorgeProgress = {
    streak: number;
    required: 10;
    unlocked: boolean;
    issuedThisRound: boolean;
    credentialAvailable: boolean;
};
export type GeorgeReboot =
    | { phase: 'idle' }
    | { phase: 'pending'; id: string; roundId: number; initiatorId: string; initiatorName: string; initiatorAccountName: string | null; startsAt: number; endsAt: number; disarmerId: string | null; disarmStartedAt: number | null; disarmLastSeenAt: number | null }
    | { phase: 'shutdown'; id: string; roundId: number; initiatorId: string; initiatorName: string; initiatorAccountName: string | null; resolvedAt: number }
    | { phase: 'resolved'; id: string; roundId: number; initiatorId: string; initiatorName: string; initiatorAccountName: string | null; outcome: 'aborted' | 'shutdown'; resolvedAt: number; disarmedBy?: string };

export type ThrowRecord = {
    /** Thrower-local id, unique per thrower. */
    id: number;
    /** Launch position and velocity (m, m/s) and the disc's tilt (radians about its flight direction). */
    o: Vec3Tuple;
    v: Vec3Tuple;
    tilt: number;
    /** A fully aimed sniper throw (see SNIPER). */
    sniper?: boolean;
    frc?: boolean;
};

export type ClientMessage =
    | {
          type: 'hello';
          version: number;
          name: string;
          token?: string;
          phase?: 'lobby' | 'playing';
          capabilities?: { snapshotAck?: boolean; snapshotDelta?: boolean };
      }
    | { type: 'joinRound' }
    | { type: 'interact'; target: string }
    | { type: 'toggleFrc' }
    | { type: 'activateStealth' }
    | { type: 'chat'; text: string }
    /** `ct`: the sender's own clock (ms) when the pose was sampled, so the room can stamp it without network jitter. */
    /** `tp`: the game itself moved the player (recovery, return, relocation); the room forgets their pose history. */
    | { type: 'pose'; pose: PlayerPose; ct?: number; tp?: boolean }
    | { type: 'throw'; throw: ThrowRecord }
    /**
     * `rt`: the room time the thrower saw the target at (their render time), for lag-compensated judging.
     * `path`: where the disc bounced off the level between release and contact (at most 8 points).
     */
    | { type: 'hit'; throwId: number; target: string; at: Vec3Tuple; rt?: number; path?: Vec3Tuple[] }
    /** The sender's own disc came to rest at `at` (it now lies there for anyone to pick up). */
    | { type: 'landed'; throwId: number; at: Vec3Tuple }
    /** The sender was caught in the night guard's flashlight. */
    | { type: 'spotted' }
    | { type: 'pullBreaker' }
    | { type: 'executionPrepare'; requestId: string; target: string }
    /** A spectator in the final-minute stands cheers, waves a light stick or throws confetti. */
    | { type: 'emote'; kind: 'cheer' | 'stick' | 'confetti' }
    | { type: 'skipMomentCutscene'; id: string }
    | { type: 'executionCommit'; requestId: string }
    | { type: 'executionCancel'; requestId: string }
    /** The sender threw inside 纪老师's view and is standing still for DETENTION_SECONDS. */
    | { type: 'caught' }
    /** Latency probe: the room echoes `c` straight back. */
    | { type: 'ping'; c: number }
    /** App-level receipt used by the Worker runtime where writable-buffer size is unavailable. */
    | { type: 'snapshotAck'; seq: number; epoch?: number }
    | { type: 'snapshotResync'; epoch?: number; seq?: number }
    | { type: 'respawned'; pose: PlayerPose }
    | { type: 'georgeLogin'; requestId: string; code: string }
    | { type: 'georgeStart'; requestId: string }
    | { type: 'georgeDisarmBegin'; requestId: string }
    | { type: 'georgeDisarmCancel'; requestId: string };

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
          executions: Execution[];
          globalFinisher: GlobalFinisher | null;
          momentCutscene: MomentCutscene | null;
          gold: GoldState;
          ammo: number;
          discs: GroundDisc[];
          items: WorldItem[];
          george: GeorgeProgress;
          georgeCredential: { id: string; code: string; status: 'available' | 'used' } | null;
          georgeReboot: GeorgeReboot;
          /** Room clock now (ms), so the patrol and countdown line up before the first snapshot. */
          t: number;
          /** Match clock excludes any prior global cinematic pauses. */
          matchTime: number;
      }
    | { type: 'rejected'; reason: 'version' | 'full' | 'protocol' | 'auth' }
    | { type: 'joined'; player: PlayerSummary }
    | { type: 'phaseChanged'; id: string; phase: 'lobby' | 'playing' }
    | { type: 'joinRoundDenied'; reason: string }
    | { type: 'interactionDenied'; reason: string }
    | { type: 'positionCorrected'; pose: PlayerPose }
    | { type: 'items'; items: WorldItem[] }
    | { type: 'revived'; id: string; at: Vec3Tuple }
    | { type: 'ability'; id: string; player: PlayerSummary; item: WorldItem | null }
    | { type: 'left'; id: string }
    | {
          type: 'snapshot';
          /** Monotonic per-connection sequence; optional for older servers. */
          seq?: number;
          t: number;
          poses: Record<string, StampedPose>;
          /** Players out for the round roaming the upper bowl during the final ceremony and minute (no combat). */
          fans?: Record<string, StampedPose>;
      }
    | {
          type: 'snapshotFull';
          epoch: number;
          seq: number;
          t: number;
          poses: Record<string, StampedPose>;
          fans?: Record<string, StampedPose>;
      }
    | {
          type: 'snapshotDelta';
          epoch: number;
          seq: number;
          baseSeq: number;
          t: number;
          updates: Record<string, StampedPose>;
          removed: string[];
          fanUpdates?: Record<string, StampedPose>;
          fanRemoved?: string[];
      }
    | { type: 'thrown'; from: string; t: number; throw: ThrowRecord }
    | {
          type: 'struck';
          /** Originating disc for hit acknowledgements; absent for non-disc eliminations. */
          throwId?: number;
          target: string;
          by: string;
          hp: number;
          out: boolean;
          head: boolean;
          /** Sniper disc: a head hit with one eliminates outright. */
          sniper: boolean;
          frc?: boolean;
          /** Thrown by the golden disc's holder. */
          gold: boolean;
          /** Out for the rest of the round (after the lights went out): no respawn, watch instead. */
          final?: boolean;
          execution?: boolean;
          revived?: boolean;
          /** Armor-triggered return after a permanent elimination; respawnAt is in match-clock milliseconds. */
          revivePending?: boolean;
          respawnAt?: number;
          /** The disc came off a wall (or furniture) before the hit: a bank shot. */
          bank?: boolean;
          /** Metres the disc flew (along its bounces) before the hit. */
          range?: number;
          /** The thrower's skin (for its kill effect) and, with a 计数器, the skin's new elimination count. */
          skin?: string;
          counter?: number;
          at: Vec3Tuple;
          scores: Scores;
      }
    | { type: 'hitRejected'; throwId: number }
    | { type: 'emote'; id: string; kind: 'cheer' | 'stick' | 'confetti' }
    | { type: 'chat'; line: ChatLine }
    | { type: 'king'; king: King; isNew: boolean }
    | { type: 'account'; account: AccountStats }
    | { type: 'profileUpdated'; playerId: string; avatarId: string | null; avatarVersion: string | null }
    | { type: 'healed'; id: string; hp: number }
    | { type: 'respawn'; id: string; spawn: number }
    | { type: 'gold'; gold: GoldState; event: 'spawned' | 'taken' | 'dropped' }
    | { type: 'momentCutsceneStarted'; cutscene: MomentCutscene }
    | { type: 'momentCutsceneEnded'; id: string; skipped: true }
    | { type: 'round'; round: RoundState; scores: Scores }
    | { type: 'caught'; id: string }
    /** Your disc count changed. */
    /** `creationNextAt`: with 创造之力, when the next disc is added (room clock; the timer only runs while not full). */
    | { type: 'ammo'; ammo: number; creationNextAt?: number }
    /** Discs lying around changed (`added`: a fresh one appeared, e.g. at the PE office). */
    | { type: 'discs'; discs: GroundDisc[]; added?: { id: number; office: boolean } }
    | { type: 'pong'; c: number }
    | { type: 'power'; power: PowerState }
    | { type: 'executionStarted'; execution: Execution }
    | { type: 'executionEnded'; id: string; completed: boolean; reason: string }
    | { type: 'executionDenied'; reason: string }
    | { type: 'executionPrepared'; requestId: string; intentId: string }
    | { type: 'executionPrepareDenied'; requestId: string; reason: string }
    | { type: 'globalFinisherStarted'; finisher: GlobalFinisher }
    | { type: 'globalFinisherState'; finisher: GlobalFinisher }
    | { type: 'globalFinisherCompleted'; id: string; sequence: number; target: string; by: string; resumedAt: number }
    | { type: 'globalFinisherCancelled'; id: string; sequence: number; reason: string; resumedAt: number }
    | { type: 'georgeProgress'; playerId: string; progress: GeorgeProgress }
    | { type: 'georgeCredential'; credential: { id: string; code: string; status: 'available' | 'used' | 'revoked' } | null }
    | { type: 'georgeResult'; requestId: string; result: 'granted' | 'denied' | 'started' | 'not-available'; reason?: string }
    | { type: 'georgeReboot'; state: GeorgeReboot }
    | { type: 'georgeSecurityAlert' }
    | { type: 'georgeShutdown'; id: string; initiatorId: string; initiatorName: string; resolvedAt: number };

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
const isSnapshotCapabilities = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const capabilities = value as Record<string, unknown>;
    return Object.keys(capabilities).every((key) => key === 'snapshotAck' || key === 'snapshotDelta') &&
        (capabilities.snapshotAck === undefined || typeof capabilities.snapshotAck === 'boolean') &&
        (capabilities.snapshotDelta === undefined || typeof capabilities.snapshotDelta === 'boolean');
};
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
                (value.token === undefined || typeof value.token === 'string') &&
                (value.phase === undefined || value.phase === 'lobby' || value.phase === 'playing') &&
                (value.capabilities === undefined || isSnapshotCapabilities(value.capabilities))
                ? (value as ClientMessage)
                : null;
        case 'joinRound':
            return value as ClientMessage;
        case 'toggleFrc':
        case 'activateStealth':
            return value as ClientMessage;
        case 'interact':
            return typeof value.target === 'string' && value.target.length <= 64 ? (value as ClientMessage) : null;
        case 'chat':
            return typeof value.text === 'string' ? (value as ClientMessage) : null;
        case 'caught':
            return value as ClientMessage;
        case 'ping':
            return isNumber(value.c) ? (value as ClientMessage) : null;
        case 'snapshotAck':
            return Number.isSafeInteger(value.seq) && (value.seq as number) > 0 &&
                (value.epoch === undefined || Number.isSafeInteger(value.epoch))
                ? (value as ClientMessage)
                : null;
        case 'snapshotResync':
            return (value.epoch === undefined || Number.isSafeInteger(value.epoch)) &&
                (value.seq === undefined || Number.isSafeInteger(value.seq))
                ? (value as ClientMessage)
                : null;
        case 'spotted':
        case 'pullBreaker':
            return value as ClientMessage;
        case 'emote':
            return value.kind === 'cheer' || value.kind === 'stick' || value.kind === 'confetti'
                ? (value as ClientMessage)
                : null;
        case 'executionPrepare':
            return typeof value.requestId === 'string' &&
                value.requestId.length <= 80 &&
                typeof value.target === 'string' &&
                value.target.length <= 64
                ? (value as ClientMessage)
                : null;
        case 'executionCommit':
        case 'executionCancel':
            return typeof value.requestId === 'string' && value.requestId.length <= 80
                ? (value as ClientMessage)
                : null;
        case 'georgeLogin':
            return typeof value.requestId === 'string' && value.requestId.length <= 80 &&
                typeof value.code === 'string' && /^\d{6}$/.test(value.code)
                ? (value as ClientMessage)
                : null;
        case 'georgeStart':
        case 'georgeDisarmBegin':
        case 'georgeDisarmCancel':
            return typeof value.requestId === 'string' && value.requestId.length <= 80
                ? (value as ClientMessage)
                : null;
        case 'skipMomentCutscene':
            return typeof value.id === 'string' && value.id.length <= 96 ? (value as ClientMessage) : null;
        case 'landed':
            return isNumber(value.throwId) && isVec3(value.at) ? (value as ClientMessage) : null;
        case 'pose':
            return isPose(value.pose) &&
                (value.ct === undefined || isNumber(value.ct)) &&
                (value.tp === undefined || typeof value.tp === 'boolean')
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
            return isNumber(value.throwId) &&
                typeof value.target === 'string' &&
                isVec3(value.at) &&
                (value.rt === undefined || isNumber(value.rt)) &&
                (value.path === undefined ||
                    (Array.isArray(value.path) && value.path.length <= 8 && value.path.every(isVec3)))
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
