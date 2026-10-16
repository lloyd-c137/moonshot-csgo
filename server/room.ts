// Pure game-room logic for the shared campus world (no Cloudflare APIs, so node tests drive it directly).
// One room holds everyone; the Durable Object in worker.ts owns the sockets and calls into this class.
import type {
    ChatLine,
    ClientMessage,
    PlayerPose,
    PlayerSummary,
    Scores,
    ServerMessage,
    StampedPose,
    ThrowRecord,
    Vec3Tuple
} from '../src/net/protocol.ts';
import {
    CHAT,
    cleanChat,
    cleanName,
    colourFor,
    HEAD_ABOVE,
    HEAL_SECONDS,
    MAX_HP,
    MAX_PLAYERS,
    MAX_THROW_SPEED,
    POINTS,
    PROTOCOL_VERSION,
    randomName,
    RESPAWN_SECONDS,
    SNIPER,
    SPAWN_PROTECTION,
    THROW_CLAIM_WINDOW,
    THROW_COOLDOWN
} from '../src/net/protocol.ts';

import type { Accounts } from './accounts.ts';

/** Campus bounds (m) a reported pose must lie inside; anything else is ignored. */
const BOUNDS = { x0: -75, x1: 77, y0: -10, y1: 14, z0: -68, z1: 66 };
/** Slack (m) on the reach check: disc radius + capsule radius + latency/interpolation error. */
const HIT_SLACK = 3.5;

type Player = Omit<PlayerSummary, 'account'> & {
    pose: PlayerPose | null;
    poseAt: number;
    lastThrowAt: number;
    respawnAt: number;
    hurtAt: number;
    spawnedAt: number;
    /** Registered username when signed in; lifetime stats are recorded under it. */
    accountName: string | null;
    chatTimes: number[];
    /** Recent (arrival − sender clock) samples and the smoothed offset that maps the sender's clock to room time. */
    clockSamples: number[];
    clockOffset: number | null;
    throws: Map<number, { record: ThrowRecord; at: number; scored: boolean }>;
};

export type Outbox = {
    /** Send to one connection. */
    to: (id: string, message: ServerMessage) => void;
    /** Send to everyone, optionally except one. */
    all: (message: ServerMessage, except?: string) => void;
    /** Close a connection. */
    close: (id: string) => void;
};

export class Room {
    readonly players = new Map<string, Player>();
    private pending = new Set<string>();
    private spawnCursor = 0;
    private readonly spawnCount: number;
    private readonly out: Outbox;
    private readonly accounts: Accounts | null;
    private readonly chatLog: ChatLine[] = [];
    private chatId = 0;

    constructor(out: Outbox, spawnCount: number, accounts: Accounts | null = null) {
        this.out = out;
        this.spawnCount = spawnCount;
        this.accounts = accounts;
    }

    get online() {
        return this.players.size;
    }

    /** A socket connected; it becomes a player once it says hello. */
    connect(id: string) {
        this.pending.add(id);
    }

    disconnect(id: string) {
        this.pending.delete(id);
        if (this.players.delete(id)) this.out.all({ type: 'left', id });
    }

    message(id: string, message: ClientMessage | null, now: number) {
        if (!message) {
            if (this.pending.has(id)) {
                this.out.to(id, { type: 'rejected', reason: 'protocol' });
                this.out.close(id);
            }
            return;
        }
        if (message.type === 'hello') return this.hello(id, message.version, message.name, message.token, now);
        const player = this.players.get(id);
        if (!player) return;
        switch (message.type) {
            case 'pose':
            case 'respawned':
                if (!inBounds(message.pose)) return;
                if (message.type === 'respawned' && !player.alive && now >= player.respawnAt) {
                    player.alive = true;
                    player.spawnedAt = now;
                }
                player.pose = message.pose;
                player.poseAt = message.type === 'pose' ? stampPose(player, message.ct, now) : now;
                return;
            case 'throw':
                return this.throw(player, message.throw, now);
            case 'hit':
                return this.hit(player, message.throwId, message.target, message.at, now);
            case 'chat':
                return this.chat(player, message.text, now);
        }
    }

    /** Periodic work: respawns that are due, and the pose snapshot. */
    tick(now: number) {
        for (const player of this.players.values()) {
            if (!player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
                player.respawnAt = 0;
                player.hp = MAX_HP;
                this.out.all({ type: 'respawn', id: player.id, spawn: this.nextSpawn() });
            }
            if (player.alive && player.hp < MAX_HP && now - player.hurtAt > HEAL_SECONDS * 1000) {
                player.hp = MAX_HP;
                this.out.all({ type: 'healed', id: player.id, hp: player.hp });
            }
            for (const [throwId, entry] of player.throws) {
                if (now - entry.at > THROW_CLAIM_WINDOW * 1000) player.throws.delete(throwId);
            }
        }
        const poses: Record<string, StampedPose> = {};
        for (const player of this.players.values()) {
            if (player.pose && player.alive) poses[player.id] = { ...player.pose, t: player.poseAt };
        }
        if (this.players.size) this.out.all({ type: 'snapshot', t: now, poses });
    }

    summaries(): PlayerSummary[] {
        return [...this.players.values()].map((player) => summary(player));
    }

    private hello(id: string, version: number, rawName: string, token: string | undefined, now: number) {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        if (version !== PROTOCOL_VERSION) {
            this.out.to(id, { type: 'rejected', reason: 'version' });
            return this.out.close(id);
        }
        if (this.players.size >= MAX_PLAYERS) {
            this.out.to(id, { type: 'rejected', reason: 'full' });
            return this.out.close(id);
        }
        const account = this.accounts?.resolve(token, now) ?? null;
        // With accounts enabled every player must be signed in (there is no guest entry).
        if (this.accounts && !account) {
            this.out.to(id, { type: 'rejected', reason: 'auth' });
            return this.out.close(id);
        }
        let name: string;
        if (account) {
            // One connection per account: a new sign-in replaces an older one.
            for (const other of this.players.values()) {
                if (other.accountName === account.name) {
                    this.out.close(other.id);
                    this.disconnect(other.id);
                }
            }
            name = account.name;
        } else {
            // No account service (local practice rooms and tests): plain nicknames.
            const taken = new Set([...this.players.values()].map((player) => player.name));
            const base = cleanName(rawName) || randomName();
            name = base;
            for (let suffix = 2; taken.has(name); suffix++) name = `${base}·${suffix}`;
        }
        const player: Player = {
            id,
            name,
            colour: this.freeColour(id),
            alive: true,
            hp: MAX_HP,
            score: 0,
            kills: 0,
            deaths: 0,
            pose: null,
            poseAt: 0,
            lastThrowAt: -Infinity,
            respawnAt: 0,
            hurtAt: 0,
            spawnedAt: now,
            accountName: account?.name ?? null,
            chatTimes: [],
            clockSamples: [],
            clockOffset: null,
            throws: new Map()
        };
        this.players.set(id, player);
        this.out.to(id, {
            type: 'welcome',
            id,
            name,
            players: this.summaries(),
            account,
            king: this.accounts?.king() ?? null,
            chat: this.chatLog.slice(-20)
        });
        this.out.all({ type: 'joined', player: summary(player) }, id);
    }

    private throw(player: Player, record: ThrowRecord, now: number) {
        if (!player.alive || now - player.lastThrowAt < THROW_COOLDOWN * 1000 * 0.8) return;
        const speed = Math.hypot(...record.v);
        if (speed > MAX_THROW_SPEED + 12 || player.throws.has(record.id)) return;
        // The disc must leave from near the thrower's last known position.
        if (player.pose && distance(player.pose.p, record.o) > 3) return;
        // A sniper flag only counts on a full-speed launch.
        if (record.sniper && speed < SNIPER.minSpeed) record.sniper = false;
        player.lastThrowAt = now;
        player.throws.set(record.id, { record, at: now, scored: false });
        this.out.all({ type: 'thrown', from: player.id, t: now, throw: record }, player.id);
    }

    private hit(player: Player, throwId: number, targetId: string, at: Vec3Tuple, now: number) {
        const entry = player.throws.get(throwId);
        const target = this.players.get(targetId);
        if (!entry || entry.scored || !target || target === player || !target.alive || !target.pose) return;
        if (now - target.spawnedAt < SPAWN_PROTECTION * 1000) return;
        const elapsed = (now - entry.at) / 1000;
        if (elapsed > THROW_CLAIM_WINDOW) return;
        // Reach: the target must be within what the disc could cover since release, and the claimed contact point
        // must be near the target (both with slack for latency and interpolation).
        const reach = Math.hypot(...entry.record.v) * (elapsed + 0.35) + HIT_SLACK;
        if (distance(entry.record.o, target.pose.p) > reach || distance(at, target.pose.p) > HIT_SLACK) return;
        entry.scored = true;
        const head = at[1] - target.pose.p[1] > HEAD_ABOVE;
        const sniper = entry.record.sniper === true;
        // A sniper disc to the head is lethal outright; anything else takes one point of health.
        target.hp = sniper && head ? 0 : Math.max(0, target.hp - 1);
        target.hurtAt = now;
        player.score += POINTS.hit;
        const out = target.hp === 0;
        if (out) {
            player.kills++;
            player.score += POINTS.elimination;
            target.deaths++;
            target.alive = false;
            target.respawnAt = now + RESPAWN_SECONDS * 1000;
        }
        const scores: Scores = {};
        for (const each of this.players.values()) scores[each.id] = [each.score, each.kills, each.deaths];
        this.out.all({
            type: 'struck',
            target: target.id,
            by: player.id,
            hp: target.hp,
            out,
            head,
            sniper,
            at,
            scores
        });
        this.persist(player, target, out, now);
    }

    /** Lifetime stats for signed-in players, and the standing 淘汰王. */
    private persist(attacker: Player, target: Player, out: boolean, now: number) {
        if (!this.accounts) return;
        if (attacker.accountName) {
            const stats = this.accounts.record(attacker.accountName, {
                hits: 1,
                kills: out ? 1 : 0,
                score: POINTS.hit + (out ? POINTS.elimination : 0)
            });
            if (stats) {
                this.out.to(attacker.id, { type: 'account', account: stats });
                const crowned = out ? this.accounts.challenge(stats, now) : null;
                if (crowned) {
                    this.out.all({ type: 'king', king: crowned.king, isNew: crowned.isNew });
                    if (crowned.isNew)
                        this.system(`新的淘汰王诞生：${crowned.king.name}（累计淘汰 ${crowned.king.kills}）`, now);
                }
            }
        }
        if (out && target.accountName) {
            const stats = this.accounts.record(target.accountName, { deaths: 1 });
            if (stats) this.out.to(target.id, { type: 'account', account: stats });
        }
    }

    private chat(player: Player, raw: string, now: number) {
        const text = cleanChat(raw);
        if (!text) return;
        player.chatTimes = player.chatTimes.filter((t) => now - t < CHAT.windowSeconds * 1000);
        if (player.chatTimes.length >= CHAT.burst) return;
        player.chatTimes.push(now);
        this.pushChat({ id: ++this.chatId, t: now, name: player.name, colour: player.colour, text });
    }

    /** A system line in the world chat. */
    system(text: string, now: number) {
        this.pushChat({ id: ++this.chatId, t: now, name: '系统', colour: 45, text, system: true });
    }

    private pushChat(line: ChatLine) {
        this.chatLog.push(line);
        while (this.chatLog.length > CHAT.history) this.chatLog.shift();
        this.out.all({ type: 'chat', line });
    }

    /** The hue (30° steps) furthest from every hue already in use, so players stay easy to tell apart. */
    private freeColour(id: string) {
        const used = [...this.players.values()].map((player) => player.colour);
        if (!used.length) return colourFor(id);
        let best = 0;
        let bestGap = -1;
        for (let hue = 0; hue < 360; hue += 30) {
            const gap = Math.min(...used.map((other) => Math.min(Math.abs(hue - other), 360 - Math.abs(hue - other))));
            if (gap > bestGap) {
                bestGap = gap;
                best = hue;
            }
        }
        return best;
    }

    private nextSpawn() {
        // Rotate through the spawn list with a stride so consecutive respawns land far apart.
        this.spawnCursor = (this.spawnCursor + 7) % Math.max(1, this.spawnCount);
        return this.spawnCursor;
    }
}

/**
 * Room time for a pose sampled at the sender's clock `ct`. Arrival times jitter with the network, which made other
 * players' motion uneven; the sender's own clock is even. The offset is the smallest recent (arrival − ct), i.e.
 * the fastest delivery, eased so it never jumps; stamps stay increasing and never in the future.
 */
export const stampPose = (
    player: { clockSamples: number[]; clockOffset: number | null; poseAt: number },
    ct: number | undefined,
    now: number
) => {
    if (ct === undefined || !Number.isFinite(ct)) return now;
    player.clockSamples.push(now - ct);
    if (player.clockSamples.length > 60) player.clockSamples.shift();
    const best = Math.min(...player.clockSamples);
    player.clockOffset = player.clockOffset === null ? best : player.clockOffset + (best - player.clockOffset) * 0.05;
    let stamp = Math.min(now, ct + player.clockOffset);
    // A stamp far behind arrival means the sender's clock jumped (tab sleep): start over from arrival time.
    if (now - stamp > 1000) {
        player.clockSamples.length = 0;
        player.clockOffset = null;
        stamp = now;
    }
    return Math.max(stamp, player.poseAt + 1);
};

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const inBounds = ({ p: [x, y, z] }: PlayerPose) =>
    x >= BOUNDS.x0 && x <= BOUNDS.x1 && y >= BOUNDS.y0 && y <= BOUNDS.y1 && z >= BOUNDS.z0 && z <= BOUNDS.z1;

const summary = ({ id, name, accountName, colour, alive, hp, score, kills, deaths }: Player): PlayerSummary => ({
    id,
    name,
    account: accountName !== null,
    colour,
    alive,
    hp,
    score,
    kills,
    deaths
});
