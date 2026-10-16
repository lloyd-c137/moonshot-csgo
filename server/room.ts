// Pure game-room logic for the shared campus world (no Cloudflare APIs, so node tests drive it directly).
// One room holds everyone; the Durable Object in worker.ts owns the sockets and calls into this class.
import type {
    ClientMessage,
    PlayerPose,
    PlayerSummary,
    Scores,
    ServerMessage,
    ThrowRecord,
    Vec3Tuple
} from '../src/net/protocol.ts';
import {
    cleanName,
    colourFor,
    HEAL_SECONDS,
    MAX_HP,
    MAX_PLAYERS,
    MAX_THROW_SPEED,
    POINTS,
    PROTOCOL_VERSION,
    randomName,
    RESPAWN_SECONDS,
    THROW_CLAIM_WINDOW,
    THROW_COOLDOWN
} from '../src/net/protocol.ts';

/** Campus bounds (m) a reported pose must lie inside; anything else is ignored. */
const BOUNDS = { x0: -75, x1: 77, y0: -10, y1: 14, z0: -68, z1: 66 };
/** Slack (m) on the reach check: disc radius + capsule radius + latency/interpolation error. */
const HIT_SLACK = 3.5;

type Player = PlayerSummary & {
    pose: PlayerPose | null;
    poseAt: number;
    lastThrowAt: number;
    respawnAt: number;
    hurtAt: number;
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

    constructor(out: Outbox, spawnCount: number) {
        this.out = out;
        this.spawnCount = spawnCount;
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
        if (message.type === 'hello') return this.hello(id, message.version, message.name);
        const player = this.players.get(id);
        if (!player) return;
        switch (message.type) {
            case 'pose':
            case 'respawned':
                if (!inBounds(message.pose)) return;
                if (message.type === 'respawned' && !player.alive && now >= player.respawnAt) player.alive = true;
                player.pose = message.pose;
                player.poseAt = now;
                return;
            case 'throw':
                return this.throw(player, message.throw, now);
            case 'hit':
                return this.hit(player, message.throwId, message.target, message.at, now);
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
        const poses: Record<string, PlayerPose> = {};
        for (const player of this.players.values()) if (player.pose && player.alive) poses[player.id] = player.pose;
        if (this.players.size) this.out.all({ type: 'snapshot', t: now, poses });
    }

    summaries(): PlayerSummary[] {
        return [...this.players.values()].map((player) => summary(player));
    }

    private hello(id: string, version: number, rawName: string) {
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
        const taken = new Set([...this.players.values()].map((player) => player.name));
        let name = cleanName(rawName) || randomName();
        for (let suffix = 2; taken.has(name); suffix++) name = `${cleanName(rawName) || '飞盘手'}${suffix}`;
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
            throws: new Map()
        };
        this.players.set(id, player);
        this.out.to(id, { type: 'welcome', id, name, players: this.summaries() });
        this.out.all({ type: 'joined', player: summary(player) }, id);
    }

    private throw(player: Player, record: ThrowRecord, now: number) {
        if (!player.alive || now - player.lastThrowAt < THROW_COOLDOWN * 1000 * 0.8) return;
        const speed = Math.hypot(...record.v);
        if (speed > MAX_THROW_SPEED + 12 || player.throws.has(record.id)) return;
        // The disc must leave from near the thrower's last known position.
        if (player.pose && distance(player.pose.p, record.o) > 3) return;
        player.lastThrowAt = now;
        player.throws.set(record.id, { record, at: now, scored: false });
        this.out.all({ type: 'thrown', from: player.id, throw: record }, player.id);
    }

    private hit(player: Player, throwId: number, targetId: string, at: Vec3Tuple, now: number) {
        const entry = player.throws.get(throwId);
        const target = this.players.get(targetId);
        if (!entry || entry.scored || !target || target === player || !target.alive || !target.pose) return;
        const elapsed = (now - entry.at) / 1000;
        if (elapsed > THROW_CLAIM_WINDOW) return;
        // Reach: the target must be within what the disc could cover since release, and the claimed contact point
        // must be near the target (both with slack for latency and interpolation).
        const reach = Math.hypot(...entry.record.v) * (elapsed + 0.35) + HIT_SLACK;
        if (distance(entry.record.o, target.pose.p) > reach || distance(at, target.pose.p) > HIT_SLACK) return;
        entry.scored = true;
        target.hp = Math.max(0, target.hp - 1);
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
        this.out.all({ type: 'struck', target: target.id, by: player.id, hp: target.hp, out, at, scores });
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

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const inBounds = ({ p: [x, y, z] }: PlayerPose) =>
    x >= BOUNDS.x0 && x <= BOUNDS.x1 && y >= BOUNDS.y0 && y <= BOUNDS.y1 && z >= BOUNDS.z0 && z <= BOUNDS.z1;

const summary = ({ id, name, colour, alive, hp, score, kills, deaths }: Player): PlayerSummary => ({
    id,
    name,
    colour,
    alive,
    hp,
    score,
    kills,
    deaths
});
