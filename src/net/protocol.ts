// Wire protocol shared by the browser client and the Cloudflare Durable Object room (server/). JSON over WebSocket.
// Pure: no engine or runtime imports, so the server bundle and node tests can import it directly.
//
// Authority model (GAMEPLAY_AUTHORED, first multiplayer slice):
// - Each client owns its movement and sends its pose; the room relays poses as snapshots.
// - A throw is announced to the room; every client simulates the disc locally against the level colliders.
// - The thrower's client detects hits (it sees the flight it launched) and claims them; the room validates the
//   claim (throw exists and is recent, one hit per throw, both players alive, target within reach of the throw)
//   and alone decides eliminations and respawns.

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 32;
export const SNAPSHOT_HZ = 15;
export const POSE_HZ = 15;
/** Seconds a player stays out after a hit before respawning. */
export const RESPAWN_SECONDS = 2.5;
/** Minimum seconds between two throws by the same player. */
export const THROW_COOLDOWN = 0.55;
/** A disc can score for this long after release (client side). */
export const THROW_LIFETIME = 4;
/** The room accepts hit claims for this long after a throw (slack for slow clients and latency). */
export const THROW_CLAIM_WINDOW = 8;
/** Hits a player can take; the last one eliminates. */
export const MAX_HP = 2;
/** Seconds without being hit before a damaged player is healed to full. */
export const HEAL_SECONDS = 10;
/** Points: every hit, plus a bonus for the eliminating hit. */
export const POINTS = { hit: 1, elimination: 2 } as const;
/** Fastest launch speed a client may claim (m/s), plus the thrower's own velocity allowance. */
export const MAX_THROW_SPEED = 26;
export const NAME_MAX = 16;

export type Vec3Tuple = [number, number, number];

export type PlayerPose = {
    /** Capsule centre. */
    p: Vec3Tuple;
    /** Camera yaw and pitch, degrees. */
    yaw: number;
    pitch: number;
};

export type PlayerSummary = {
    id: string;
    name: string;
    colour: number;
    alive: boolean;
    hp: number;
    score: number;
    kills: number;
    deaths: number;
};

/** Per-player [score, eliminations, times eliminated]. */
export type Scores = Record<string, [number, number, number]>;

export type ThrowRecord = {
    /** Thrower-local id, unique per thrower. */
    id: number;
    /** Launch position and velocity (m, m/s) and the disc's tilt (radians about its flight direction). */
    o: Vec3Tuple;
    v: Vec3Tuple;
    tilt: number;
};

export type ClientMessage =
    | { type: 'hello'; version: number; name: string }
    | { type: 'pose'; pose: PlayerPose }
    | { type: 'throw'; throw: ThrowRecord }
    | { type: 'hit'; throwId: number; target: string; at: Vec3Tuple }
    | { type: 'respawned'; pose: PlayerPose };

export type ServerMessage =
    | { type: 'welcome'; id: string; name: string; players: PlayerSummary[] }
    | { type: 'rejected'; reason: 'version' | 'full' | 'protocol' }
    | { type: 'joined'; player: PlayerSummary }
    | { type: 'left'; id: string }
    | { type: 'snapshot'; t: number; poses: Record<string, PlayerPose> }
    | { type: 'thrown'; from: string; throw: ThrowRecord }
    | { type: 'struck'; target: string; by: string; hp: number; out: boolean; at: Vec3Tuple; scores: Scores }
    | { type: 'healed'; id: string; hp: number }
    | { type: 'respawn'; id: string; spawn: number };

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
    return !!pose && isVec3(pose.p) && isNumber(pose.yaw) && isNumber(pose.pitch);
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
            return isNumber(value.version) && typeof value.name === 'string' ? (value as ClientMessage) : null;
        case 'pose':
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
