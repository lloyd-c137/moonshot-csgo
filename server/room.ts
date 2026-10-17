// Pure game-room logic for the shared campus world (no Cloudflare APIs, so node tests drive it directly).
// One room holds everyone; the Durable Object in worker.ts owns the sockets and calls into this class.
import { PE_OFFICE } from '../src/config/office.ts';
import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { canExecute, canStartGlobalFinisher, EXECUTION } from '../src/gameplay/execution.ts';
import type { Execution } from '../src/gameplay/execution.ts';
import { GLOBAL_FINISHER_CONFIG } from '../src/gameplay/finisher/FinisherTypes.ts';
import type { GlobalFinisher } from '../src/gameplay/finisher/FinisherTypes.ts';
import { guardAt, GUARD } from '../src/gameplay/guard.ts';
import { nearBreaker } from '../src/gameplay/power.ts';
import type { PowerState } from '../src/gameplay/power.ts';
import { teacherAt } from '../src/gameplay/teacher.ts';
import type {
    ChatLine,
    ClientMessage,
    GroundDisc,
    GoldState,
    RoundOutcome,
    RoundState,
    PlayerPose,
    PlayerSummary,
    Scores,
    ServerMessage,
    StampedPose,
    ThrowRecord,
    Vec3Tuple
} from '../src/net/protocol.ts';
import {
    AMMO,
    CHAT,
    cleanChat,
    cleanName,
    colourFor,
    DETENTION_SECONDS,
    isHeadHit,
    HEAL_SECONDS,
    MAX_HP,
    MAX_PLAYERS,
    MAX_THROW_SPEED,
    POINTS,
    PROTOCOL_VERSION,
    randomName,
    RESPAWN_SECONDS,
    ROUND,
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
    avatarId: string | null;
    avatarVersion: string | null;
    chatTimes: number[];
    /** Discs in hand. */
    ammo: number;
    /** Eliminated after the lights went out: out until the next round. */
    spectating: boolean;
    /** Golden throws so far, and when the golden disc may be thrown again after a burst. */
    goldThrows: number;
    goldCooldownUntil: number;
    detainedUntil: number;
    /** Recent (arrival − sender clock) samples and the smoothed offset that maps the sender's clock to room time. */
    clockSamples: number[];
    clockOffset: number | null;
    throws: Map<number, { record: ThrowRecord; at: number; scored: boolean; golden: boolean; landed: boolean }>;
};
type FinisherPreparation = {
    requestId: string;
    intentId: string;
    targetId: string;
    preparedAt: number;
    commitRequested: boolean;
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
    /** Accounts that actually joined play this round; retained across disconnects, deduplicated on reconnect. */
    private roundParticipants = new Set<string>();
    private spawnCursor = 0;
    private readonly spawnCount: number;
    private readonly out: Outbox;
    private readonly accounts: Accounts | null;
    private readonly chatLog: ChatLine[] = [];
    private chatId = 0;
    /** The current round and the golden disc (null while the room is empty). */
    round: RoundState | null = null;
    power: PowerState = { pulledAt: null };
    readonly executions = new Map<string, Execution>();
    private executionCounter = 0;
    private executedAccounts = new Set<string>();
    private roundId = 0;
    private finisherSequence = 0;
    private finisherCounter = 0;
    private finisherCooldownUntil = 0;
    private finisherUses = new Map<string, number>();
    private finisherRoundUses = 0;
    private preparations = new Map<string, FinisherPreparation>();
    private globalFinisher: GlobalFinisher | null = null;
    /** Match-time offset grows only while the authoritative world is globally frozen. */
    private matchClockOffset = 0;
    gold: GoldState = { holder: null, at: [0, 0.92, 0] };
    private goldDroppedAt = 0;
    /** Discs a newcomer carries (tests raise it to throw repeatedly). */
    startAmmo: number = AMMO.start;
    /** Discs lying on the floor, and when the PE office last put one out. */
    discs: GroundDisc[] = [];
    private discId = 0;
    private officeAt: number | null = null;
    private readonly random: () => number;

    constructor(out: Outbox, spawnCount: number, accounts: Accounts | null = null, random = Math.random) {
        this.out = out;
        this.random = random;
        this.spawnCount = spawnCount;
        this.accounts = accounts;
    }

    get online() {
        return this.players.size;
    }

    private matchNow(realNow: number) {
        return (this.globalFinisher ? Math.min(realNow, this.globalFinisher.pauseAt) : realNow) - this.matchClockOffset;
    }

    /** A socket connected; it becomes a player once it says hello. */
    connect(id: string) {
        this.pending.add(id);
    }

    disconnect(id: string, realNow = Date.now()) {
        const now = this.matchNow(realNow);
        this.pending.delete(id);
        const player = this.players.get(id);
        if (!player) return;
        if (this.globalFinisher && (this.globalFinisher.attacker.id === id || this.globalFinisher.target.id === id))
            this.cancelGlobalFinisher('处决参与者断开连接', realNow);
        this.preparations.delete(id);
        this.cancelExecutionFor(id, '玩家离开');
        // Leaving with the golden disc drops it where they stood.
        if (this.gold.holder === id) this.dropGold(player, now);
        this.players.delete(id);
        this.out.all({ type: 'left', id });
        this.checkLastStanding(now);
        // An empty room forgets its round; the next arrival starts a fresh one.
        if (!this.players.size) {
            this.globalFinisher = null;
            this.matchClockOffset = 0;
            this.preparations.clear();
            this.round = null;
            this.executedAccounts.clear();
            this.power = { pulledAt: null };
            this.roundParticipants.clear();
            this.discs = [];
            this.officeAt = null;
        }
    }

    message(id: string, message: ClientMessage | null, realNow: number) {
        if (!message) {
            if (this.pending.has(id)) {
                this.out.to(id, { type: 'rejected', reason: 'protocol' });
                this.out.close(id);
            }
            return;
        }
        if (message.type === 'hello') return this.hello(id, message.version, message.name, message.token, realNow);
        const player = this.players.get(id);
        if (!player) return;
        if (message.type === 'ping') return this.out.to(player.id, { type: 'pong', c: message.c });
        // The room is authoritative: no gameplay or chat message is queued while a finisher owns the world.
        if (this.globalFinisher) return;
        if (message.type === 'executionPrepare')
            return this.prepareFinisher(player, message.requestId, message.target, realNow, this.matchNow(realNow));
        if (message.type === 'executionCommit') return this.commitFinisher(player, message.requestId, realNow);
        if (message.type === 'executionCancel') return this.cancelFinisherPreparation(player, message.requestId);
        const now = this.matchNow(realNow);
        switch (message.type) {
            case 'pose':
            case 'respawned':
                if (player.spectating || this.executionFor(id)) return;
                if (!inBounds(message.pose)) return;
                if (message.type === 'respawned' && !player.alive && now >= player.respawnAt) {
                    player.alive = true;
                    player.spawnedAt = now;
                }
                player.pose = message.pose;
                player.poseAt = message.type === 'pose' ? stampPose(player, message.ct, now) : now;
                this.tryPickup(player, now);
                this.pickupDiscs(player);
                return;
            case 'throw':
                return this.throw(player, message.throw, now);
            case 'hit':
                return this.hit(player, message.throwId, message.target, message.at, now);
            case 'chat':
                return this.chat(player, message.text, now);
            case 'caught':
                return this.caught(player, now);
            case 'landed':
                return this.landed(player, message.throwId, message.at);
            case 'spotted':
                return this.spotted(player, now);
            case 'pullBreaker':
                if (
                    this.round?.phase !== 'playing' ||
                    this.blackout(now) ||
                    this.power.pulledAt !== null ||
                    !player.alive ||
                    !!this.executionFor(id) ||
                    player.spectating ||
                    !player.pose ||
                    now - player.poseAt > 1000 ||
                    !nearBreaker(player.pose.p)
                )
                    return;
                this.power = { pulledAt: now };
                this.out.all({ type: 'power', power: this.power });
                this.system(`${player.name} 拉下了配电室总闸，保安正在前往恢复供电`, now);
                return;
        }
    }

    /** Periodic work: respawns that are due, and the pose snapshot. */
    tick(realNow: number) {
        if (this.globalFinisher) {
            const finisher = this.globalFinisher;
            if (finisher.phase === 'pending' && realNow >= finisher.startsAt) {
                finisher.phase = 'active';
                finisher.sequence = ++this.finisherSequence;
                this.out.all({ type: 'globalFinisherState', finisher: structuredClone(finisher) });
            }
            if (realNow >= finisher.endsAt) this.finishGlobalFinisher(finisher, realNow);
            return;
        }
        const now = this.matchNow(realNow);
        this.advanceRound(now);
        this.processFinisherCommits(realNow, now);
        if (this.globalFinisher) return;
        for (const execution of [...this.executions.values()])
            if (now >= execution.endsAt) this.finishExecution(execution, now);
        this.officeTick(now);
        for (const player of this.players.values()) {
            if (!player.alive && !player.spectating && player.respawnAt > 0 && now >= player.respawnAt) {
                player.respawnAt = 0;
                player.hp = MAX_HP;
                if (player.ammo < this.startAmmo) {
                    player.ammo = this.startAmmo;
                    this.out.to(player.id, { type: 'ammo', ammo: player.ammo });
                }
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
            if (player.pose && player.alive) poses[player.id] = { ...player.pose, t: realNow };
        }
        if (this.players.size) this.out.all({ type: 'snapshot', t: realNow, poses });
    }

    summaries(): PlayerSummary[] {
        return [...this.players.values()].map((player) => summary(player));
    }

    updateAvatar(name: string, avatarId: string | null, avatarVersion: string | null) {
        const player = [...this.players.values()].find((entry) => entry.accountName === name);
        if (!player) return;
        player.avatarId = avatarId;
        player.avatarVersion = avatarVersion;
        this.out.all({ type: 'profileUpdated', playerId: player.id, avatarId, avatarVersion });
    }

    private hello(id: string, version: number, rawName: string, token: string | undefined, realNow: number) {
        if (!this.pending.has(id)) return;
        const now = this.matchNow(realNow);
        this.pending.delete(id);
        if (version !== PROTOCOL_VERSION) {
            this.out.to(id, { type: 'rejected', reason: 'version' });
            return this.out.close(id);
        }
        if (this.players.size >= MAX_PLAYERS) {
            this.out.to(id, { type: 'rejected', reason: 'full' });
            return this.out.close(id);
        }
        const account = this.accounts?.resolve(token, realNow) ?? null;
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
                    this.disconnect(other.id, realNow);
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
            spawnedAt: this.matchNow(realNow),
            accountName: account?.name ?? null,
            avatarId: account?.avatarId ?? null,
            avatarVersion: account?.avatarVersion ?? null,
            chatTimes: [],
            ammo: this.startAmmo,
            spectating: false,
            goldThrows: 0,
            goldCooldownUntil: 0,
            detainedUntil: 0,
            clockSamples: [],
            clockOffset: null,
            throws: new Map()
        };
        this.players.set(id, player);
        if (!this.round) this.startRound(this.matchNow(realNow), false);
        // Arriving after the lights went out: watch until the next round.
        if (this.blackout(now) || (account && this.executedAccounts.has(account.name))) {
            player.alive = false;
            player.spectating = true;
        }
        if (this.round?.phase === 'playing' && !player.spectating && player.accountName)
            this.roundParticipants.add(player.accountName);
        this.out.to(id, {
            type: 'welcome',
            id,
            name,
            players: this.summaries(),
            account,
            king: this.accounts?.king() ?? null,
            chat: this.chatLog.slice(-20),
            round: this.round!,
            power: this.power,
            executions: [...this.executions.values()],
            globalFinisher: this.globalFinisher ? structuredClone(this.globalFinisher) : null,
            gold: this.gold,
            ammo: player.ammo,
            discs: this.discs,
            t: realNow,
            matchTime: this.matchNow(realNow)
        });
        this.out.all({ type: 'joined', player: summary(player) }, id);
    }

    private executionFor(id: string) {
        return [...this.executions.values()].find((entry) => entry.attacker.id === id || entry.target.id === id);
    }

    private cancelExecutionFor(id: string, reason: string) {
        const entry = this.executionFor(id);
        if (!entry) return;
        this.executions.delete(entry.id);
        this.out.all({ type: 'executionEnded', id: entry.id, completed: false, reason });
    }

    private cancelAllExecutions(reason: string) {
        for (const entry of [...this.executions.values()]) this.cancelExecutionFor(entry.attacker.id, reason);
    }

    private prepareFinisher(attacker: Player, requestId: string, targetId: string, realNow: number, matchNow: number) {
        const pending = this.preparations.get(attacker.id);
        if (pending) {
            if (pending.requestId === requestId)
                this.out.to(attacker.id, { type: 'executionPrepared', requestId, intentId: pending.intentId });
            else this.out.to(attacker.id, { type: 'executionPrepareDenied', requestId, reason: '已有处决准备正在进行' });
            return;
        }
        const reason = this.finisherDenial(attacker, targetId, matchNow);
        if (reason) {
            this.out.to(attacker.id, { type: 'executionPrepareDenied', requestId, reason });
            return;
        }
        const preparation: FinisherPreparation = {
            requestId,
            intentId: `${this.roundId}-${++this.finisherCounter}-${attacker.id}`,
            targetId,
            preparedAt: realNow,
            commitRequested: false
        };
        this.preparations.set(attacker.id, preparation);
        this.out.to(attacker.id, { type: 'executionPrepared', requestId, intentId: preparation.intentId });
    }

    private commitFinisher(attacker: Player, requestId: string, realNow: number) {
        const preparation = this.preparations.get(attacker.id);
        if (!preparation || preparation.requestId !== requestId) {
            this.out.to(attacker.id, { type: 'executionPrepareDenied', requestId, reason: '处决准备已失效，请重新尝试' });
            return;
        }
        preparation.commitRequested = true;
        if (realNow >= preparation.preparedAt + GLOBAL_FINISHER_CONFIG.holdDurationMs)
            this.tryStartGlobalFinisher(attacker, preparation, realNow, this.matchNow(realNow));
    }

    private cancelFinisherPreparation(attacker: Player, requestId: string) {
        const preparation = this.preparations.get(attacker.id);
        if (preparation?.requestId === requestId) this.preparations.delete(attacker.id);
    }

    private processFinisherCommits(realNow: number, matchNow: number) {
        const ready = [...this.preparations.entries()]
            .filter(([, preparation]) =>
                preparation.commitRequested && realNow >= preparation.preparedAt + GLOBAL_FINISHER_CONFIG.holdDurationMs
            )
            .sort((a, b) => a[1].preparedAt - b[1].preparedAt);
        for (const [id, preparation] of ready) {
            if (this.globalFinisher) break;
            const attacker = this.players.get(id);
            if (attacker) this.tryStartGlobalFinisher(attacker, preparation, realNow, matchNow);
        }
        for (const [id, preparation] of this.preparations)
            if (realNow - preparation.preparedAt > 3000) this.preparations.delete(id);
    }

    private finisherDenial(attacker: Player, targetId: string, now: number): string | null {
        const target = this.players.get(targetId);
        if (this.globalFinisher) return '全场处决正在进行';
        if (this.round?.phase !== 'playing') return '当前回合不能处决';
        if (!target || target === attacker) return '没有有效的处决目标';
        if (!attacker.alive || attacker.spectating || !target.alive || target.spectating)
            return '处决双方都必须处于存活状态';
        if (!attacker.pose || !target.pose || now - attacker.poseAt > 1000 || now - target.poseAt > 1000)
            return '玩家位置数据已过期';
        if (now - attacker.spawnedAt < SPAWN_PROTECTION * 1000 || now - target.spawnedAt < SPAWN_PROTECTION * 1000)
            return '出生保护期间不能处决';
        if (attacker.detainedUntil > now) return '罚站期间不能处决';
        if (target.detainedUntil > now) return '目标正在罚站，无法发动全场处决';
        if (this.executionFor(attacker.id) || this.executionFor(target.id)) return '处决双方正在参与其他动作';
        if ((this.finisherUses.get(attacker.accountName ?? attacker.id) ?? 0) >= GLOBAL_FINISHER_CONFIG.maxPerPlayerPerRound)
            return '本局处决次数已用完';
        if (this.finisherRoundUses >= GLOBAL_FINISHER_CONFIG.maxPerRound) return '本局全场处决次数已达上限';
        if (now < this.finisherCooldownUntil) return '全场处决冷却中';
        if (this.gold.holder !== attacker.id && attacker.ammo <= 0) return '至少需要一张可用飞盘';
        if (!canStartGlobalFinisher(attacker.pose, target.pose)) return '需要位于目标身后、靠近目标且无遮挡';
        return null;
    }

    private tryStartGlobalFinisher(attacker: Player, preparation: FinisherPreparation, realNow: number, matchNow: number) {
        if (this.preparations.get(attacker.id) !== preparation || this.globalFinisher) return;
        const reason = this.finisherDenial(attacker, preparation.targetId, matchNow);
        if (reason) {
            this.preparations.delete(attacker.id);
            this.out.to(attacker.id, {
                type: 'executionPrepareDenied', requestId: preparation.requestId, reason
            });
            return;
        }
        const target = this.players.get(preparation.targetId)!;
        const actor = (entry: Player) => ({
            id: entry.id,
            name: entry.name,
            colour: entry.colour,
            pose: { ...entry.pose!, p: [...entry.pose!.p] as Vec3Tuple }
        });
        const startsAt = realNow + GLOBAL_FINISHER_CONFIG.initialSyncLeadMs;
        const finisher: GlobalFinisher = {
            id: `${this.roundId}-finisher-${++this.finisherCounter}`,
            roundId: this.roundId,
            sequence: ++this.finisherSequence,
            phase: 'pending',
            attacker: actor(attacker),
            target: actor(target),
            variant: this.gold.holder === attacker.id ? 'THE_BOOMERANG_GOLD' : 'THE_BOOMERANG',
            cinematicId: 'THE_BOOMERANG',
            cameraPlanId: 'COMPACT',
            pauseAt: realNow,
            startsAt,
            endsAt: startsAt + GLOBAL_FINISHER_CONFIG.cinematicDurationMs
        };
        this.globalFinisher = finisher;
        this.preparations.clear();
        this.out.all({ type: 'globalFinisherStarted', finisher: structuredClone(finisher) });
    }

    private finishGlobalFinisher(finisher: GlobalFinisher, now: number) {
        if (this.globalFinisher?.id !== finisher.id || finisher.phase === 'settling') return;
        finisher.phase = 'settling';
        finisher.sequence = ++this.finisherSequence;
        this.out.all({ type: 'globalFinisherState', finisher: structuredClone(finisher) });
        const attacker = this.players.get(finisher.attacker.id);
        const target = this.players.get(finisher.target.id);
        this.matchClockOffset += Math.max(0, now - finisher.pauseAt);
        this.globalFinisher = null;
        const matchNow = this.matchNow(now);
        if (attacker?.alive && target?.alive && this.round?.phase === 'playing') {
            target.hp = 0;
            target.alive = false;
            target.spectating = true;
            target.respawnAt = 0;
            target.deaths++;
            if (target.accountName) this.executedAccounts.add(target.accountName);
            attacker.kills++;
            attacker.score += POINTS.elimination;
            this.out.all({
                type: 'struck', target: target.id, by: attacker.id, hp: 0, out: true,
                head: false, sniper: false, gold: false, final: true, execution: true,
                at: [...target.pose!.p], scores: this.scores()
            });
            this.persist(attacker, target, true, matchNow, false);
            this.fallen(target, matchNow);
            const key = attacker.accountName ?? attacker.id;
            this.finisherUses.set(key, (this.finisherUses.get(key) ?? 0) + 1);
            this.finisherRoundUses++;
            this.finisherCooldownUntil = matchNow + GLOBAL_FINISHER_CONFIG.globalCooldownMs;
        }
        this.out.all({
            type: 'globalFinisherCompleted', id: finisher.id, sequence: ++this.finisherSequence,
            target: finisher.target.id, by: finisher.attacker.id, resumedAt: now
        });
        this.broadcastResumedClock();
    }

    private cancelGlobalFinisher(reason: string, now: number) {
        const finisher = this.globalFinisher;
        if (!finisher) return;
        this.globalFinisher = null;
        this.matchClockOffset += Math.max(0, now - finisher.pauseAt);
        this.out.all({
            type: 'globalFinisherCancelled', id: finisher.id, sequence: ++this.finisherSequence, reason, resumedAt: now
        });
        this.broadcastResumedClock();
    }

    private broadcastResumedClock() {
        if (this.round) this.out.all({ type: 'round', round: this.round, scores: this.scores() });
        this.out.all({ type: 'power', power: this.power });
    }

    private startExecution(attacker: Player, targetId: string, now: number) {
        const target = this.players.get(targetId);
        if (
            this.round?.phase !== 'playing' ||
            !attacker.alive ||
            attacker.spectating ||
            !target ||
            target === attacker ||
            !target.alive ||
            target.spectating ||
            !attacker.pose ||
            !target.pose ||
            now - attacker.poseAt > 1000 ||
            now - target.poseAt > 1000 ||
            now - attacker.spawnedAt < SPAWN_PROTECTION * 1000 ||
            now - target.spawnedAt < SPAWN_PROTECTION * 1000 ||
            this.executionFor(attacker.id) ||
            this.executionFor(target.id) ||
            !canExecute(attacker.pose, target.pose)
        ) {
            this.out.to(attacker.id, {
                type: 'executionDenied',
                reason: '目标不满足处决条件：需要靠近背后、无遮挡，且双方未受出生保护或参与其他处决'
            });
            return;
        }
        const actor = (entry: Player) => ({
            id: entry.id,
            name: entry.name,
            colour: entry.colour,
            pose: { ...entry.pose!, p: [...entry.pose!.p] as Vec3Tuple }
        });
        const startsAt = now + EXECUTION.startDelayMs;
        const execution: Execution = {
            id: `${now}-${++this.executionCounter}`,
            attacker: actor(attacker),
            target: actor(target),
            startsAt,
            endsAt: startsAt + EXECUTION.durationMs
        };
        this.executions.set(execution.id, execution);
        this.out.all({ type: 'executionStarted', execution });
    }

    private finishExecution(execution: Execution, now: number) {
        const attacker = this.players.get(execution.attacker.id),
            target = this.players.get(execution.target.id);
        if (!attacker?.alive || !target?.alive || this.round?.phase !== 'playing') {
            this.cancelExecutionFor(execution.attacker.id, '处决已中断');
            return;
        }
        this.executions.delete(execution.id);
        target.hp = 0;
        target.alive = false;
        target.spectating = true;
        target.respawnAt = 0;
        target.deaths++;
        if (target.accountName) this.executedAccounts.add(target.accountName);
        attacker.kills++;
        attacker.score += POINTS.elimination;
        this.out.all({ type: 'executionEnded', id: execution.id, completed: true, reason: '处决完成' });
        this.out.all({
            type: 'struck',
            target: target.id,
            by: attacker.id,
            hp: 0,
            out: true,
            head: false,
            sniper: false,
            gold: false,
            final: true,
            execution: true,
            at: [...target.pose!.p],
            scores: this.scores()
        });
        this.persist(attacker, target, true, now, false);
        this.fallen(target, now);
    }

    private throw(player: Player, record: ThrowRecord, now: number) {
        if (this.executionFor(player.id)) return;
        if (!player.alive || now - player.lastThrowAt < THROW_COOLDOWN * 1000 * 0.8) return;
        const speed = Math.hypot(...record.v);
        if (speed > MAX_THROW_SPEED + 12 || player.throws.has(record.id)) return;
        // The disc must leave from near the thrower's last known position.
        if (player.pose && distance(player.pose.p, record.o) > 3) return;
        // A sniper flag only counts on a full-speed launch.
        if (record.sniper && speed < SNIPER.minSpeed) record.sniper = false;
        // Every throw spends a disc, except the golden one (it comes back).
        const golden = this.gold.holder === player.id;
        if (golden) {
            // Every ROUND.goldBurst golden throws, a cooldown (a little slack for latency).
            if (now < player.goldCooldownUntil) return;
            player.goldThrows++;
            if (player.goldThrows % ROUND.goldBurst === 0)
                player.goldCooldownUntil = now + ROUND.goldCooldown * 1000 * 0.85;
        } else {
            if (player.ammo <= 0) return;
            player.ammo--;
            this.out.to(player.id, { type: 'ammo', ammo: player.ammo });
        }
        player.lastThrowAt = now;
        player.throws.set(record.id, { record, at: now, scored: false, golden, landed: false });
        this.out.all({ type: 'thrown', from: player.id, t: now, throw: record }, player.id);
    }

    private hit(player: Player, throwId: number, targetId: string, at: Vec3Tuple, now: number) {
        const entry = player.throws.get(throwId);
        const target = this.players.get(targetId);
        if (!entry || entry.scored || !target || target === player || !target.alive || !target.pose) {
            this.out.to(player.id, { type: 'hitRejected', throwId });
            return;
        }
        if (now - target.spawnedAt < SPAWN_PROTECTION * 1000) {
            this.out.to(player.id, { type: 'hitRejected', throwId });
            return;
        }
        const elapsed = (now - entry.at) / 1000;
        if (elapsed > THROW_CLAIM_WINDOW) {
            this.out.to(player.id, { type: 'hitRejected', throwId });
            return;
        }
        // Reach: the target must be within what the disc could cover since release, and the claimed contact point
        // must be near the target (both with slack for latency and interpolation).
        const reach = Math.hypot(...entry.record.v) * (elapsed + 0.35) + HIT_SLACK;
        if (distance(entry.record.o, target.pose.p) > reach || distance(at, target.pose.p) > HIT_SLACK) {
            this.out.to(player.id, { type: 'hitRejected', throwId });
            return;
        }
        entry.scored = true;
        this.cancelExecutionFor(target.id, '被飞盘命中');
        const head = isHeadHit(at[1], target.pose.p[1]);
        const sniper = entry.record.sniper === true;
        // Every disc to the head is lethal outright; body hits take one point of health.
        target.hp = head ? 0 : Math.max(0, target.hp - 1);
        target.hurtAt = now;
        player.score += POINTS.hit;
        const out = target.hp === 0;
        if (out) {
            player.kills++;
            player.score += POINTS.elimination;
            target.deaths++;
            target.alive = false;
            target.respawnAt = now + RESPAWN_SECONDS * 1000;
            // After the lights go out an elimination is final for the round.
            if (this.blackout(now)) target.spectating = true;
        }
        const scores: Scores = {};
        for (const each of this.players.values()) scores[each.id] = [each.score, each.kills, each.deaths];
        this.out.all({
            type: 'struck',
            throwId: entry.record.id,
            target: target.id,
            by: player.id,
            hp: target.hp,
            out,
            head,
            sniper,
            gold: entry.golden,
            final: out && target.spectating,
            at,
            scores
        });
        this.persist(player, target, out, now);
        if (out) this.fallen(target, now);
    }

    /** Someone was eliminated: the golden disc (if theirs) and a spare disc drop where they fell. */
    private fallen(target: Player, now: number) {
        if (this.gold.holder === target.id) this.dropGold(target, now);
        if (target.pose) {
            this.discs.push({ id: ++this.discId, at: [target.pose.p[0], 0.02, target.pose.p[2]] });
            this.out.all({ type: 'discs', discs: this.discs });
        }
        this.checkLastStanding(now);
    }

    /** Room time when the lights go out this round (null: not playing). */
    blackoutAt(): number | null {
        return this.round?.phase === 'playing' ? this.round.endsAt - ROUND.blackoutSecondsLeft * 1000 : null;
    }

    private blackout(now: number) {
        const at = this.blackoutAt();
        return at !== null && now >= at;
    }

    /** The guard's flashlight caught a player (checked against walls on their client; the room checks reach). */
    private spotted(player: Player, now: number) {
        if (!player.alive || !player.pose || !this.blackout(now)) return;
        const guard = guardAt(now, this.blackoutAt(), this.power);
        if (Math.hypot(player.pose.p[0] - guard.x, player.pose.p[2] - guard.z) > GUARD.range + 4) return;
        this.cancelExecutionFor(player.id, '被保安淘汰');
        player.hp = 0;
        player.alive = false;
        player.deaths++;
        player.spectating = true;
        player.respawnAt = 0;
        this.out.all({
            type: 'struck',
            target: player.id,
            by: 'guard',
            hp: 0,
            out: true,
            head: false,
            sniper: false,
            gold: false,
            final: true,
            at: [player.pose.p[0], player.pose.p[1] + 0.5, player.pose.p[2]],
            scores: this.scores()
        });
        this.fallen(player, now);
    }

    /** After the lights go out: when one player (or nobody) is left standing, the round ends at once. */
    private checkLastStanding(now: number) {
        if (!this.blackout(now) || this.round?.phase !== 'playing') return;
        const standing = [...this.players.values()].filter((each) => !each.spectating);
        if (standing.length > 1 || this.players.size < 2) return;
        this.endRound(
            now,
            standing[0] ?? null,
            standing[0] ? `${standing[0].name} 是最后的幸存者，赢得本局！` : null,
            standing[0] ? 'last-survivor' : 'draw'
        );
    }

    // ---------- rounds and the golden disc ----------

    private startRound(now: number, announce = true) {
        this.cancelAllExecutions('新一局开始');
        this.executedAccounts.clear();
        this.power = { pulledAt: null };
        this.roundParticipants.clear();
        this.roundId++;
        this.finisherRoundUses = 0;
        this.finisherUses.clear();
        this.preparations.clear();
        for (const player of this.players.values()) {
            if (player.accountName) this.roundParticipants.add(player.accountName);
            player.score = 0;
            player.kills = 0;
            player.deaths = 0;
            // Everyone watching from the last round's blackout plays again.
            if (player.spectating || !player.alive) {
                player.spectating = false;
                player.alive = false;
                player.respawnAt = now; // the next tick respawns them at full health with a full load
            }
        }
        this.officeAt = now;
        this.round = { phase: 'playing', endsAt: now + ROUND.roundSeconds * 1000 };
        const [x, z] = SPAWN_POINTS[Math.floor(this.random() * SPAWN_POINTS.length) % SPAWN_POINTS.length];
        this.gold = { holder: null, at: [x, 0.92, z] };
        this.goldDroppedAt = now;
        if (!announce) return; // the first arrival learns both from its welcome
        this.out.all({ type: 'round', round: this.round, scores: this.scores() });
        this.out.all({ type: 'power', power: this.power });
        this.out.all({ type: 'gold', gold: this.gold, event: 'spawned' });
    }

    private advanceRound(now: number) {
        if (!this.round || !this.players.size) return;
        if (this.round.phase === 'playing' && now >= this.round.endsAt) {
            const holder = this.gold.holder ? this.players.get(this.gold.holder) : undefined;
            this.endRound(
                now,
                holder ?? null,
                holder ? `${holder.name} 守住了金飞盘，赢得本局！` : null,
                holder ? 'golden-disc' : 'draw'
            );
        } else if (this.round.phase === 'ended' && now >= this.round.nextAt) {
            this.startRound(now);
        }
    }

    /** Local-development QA only: broadcast one of the authored climax thresholds to the whole room. */
    setTestRoundRemaining(now: number, remainingMs: number) {
        if (
            this.globalFinisher ||
            this.round?.phase !== 'playing' ||
            ![ROUND.blackoutSecondsLeft, ROUND.finalSecondsLeft].some((seconds) => seconds * 1000 === remainingMs)
        )
            return false;
        const round = this.round;
        this.round = { ...round, endsAt: this.matchNow(now) + remainingMs };
        this.out.all({ type: 'round', round: this.round, scores: this.scores() });
        return true;
    }

    private endRound(now: number, winner: Player | null, line: string | null, outcome: RoundOutcome) {
        if (this.round?.phase !== 'playing') return;
        this.cancelAllExecutions('本局结束');
        for (const name of this.roundParticipants) {
            const account = this.accounts?.record(name, {
                rounds: 1,
                wins: name === winner?.accountName ? 1 : 0,
                losses: winner && name !== winner.accountName ? 1 : 0
            });
            if (account) {
                const connected = [...this.players.values()].find((player) => player.accountName === name);
                if (connected) this.out.to(connected.id, { type: 'account', account });
            }
        }
        this.roundParticipants.clear();
        this.round = {
            phase: 'ended',
            winner: winner?.name ?? null,
            winnerId: winner?.id ?? null,
            outcome,
            nextAt: now + ROUND.intermissionSeconds * 1000
        };
        this.out.all({ type: 'round', round: this.round, scores: this.scores() });
        this.system(line ?? '本局结束：没有胜者', now);
    }

    private tryPickup(player: Player, now: number) {
        if (this.gold.holder || !player.alive || !player.pose || this.round?.phase !== 'playing') return;
        if (now - this.goldDroppedAt < ROUND.pickupDelay * 1000) return;
        const [x, y, z] = player.pose.p;
        const [gx, gy, gz] = this.gold.at;
        if (Math.hypot(x - gx, z - gz) > ROUND.pickupRadius || Math.abs(y - gy) > 1.6) return;
        this.gold = { holder: player.id, at: [x, y, z] };
        this.out.all({ type: 'gold', gold: this.gold, event: 'taken' });
    }

    private dropGold(holder: Player, now: number) {
        const at: Vec3Tuple = holder.pose ? [holder.pose.p[0], 0.92, holder.pose.p[2]] : this.gold.at;
        this.gold = { holder: null, at };
        this.goldDroppedAt = now;
        this.out.all({ type: 'gold', gold: this.gold, event: 'dropped' });
    }

    /** The thrower reports where its (ordinary) disc came to rest: it lies there for anyone to pick up. */
    private landed(player: Player, throwId: number, at: Vec3Tuple) {
        const entry = player.throws.get(throwId);
        // Golden throws count too: the golden disc flies home, but leaves an ordinary disc where it came down.
        if (!entry || entry.landed) return;
        entry.landed = true;
        // A golden-disc throw only sometimes leaves a disc behind.
        if (entry.golden && this.random() >= ROUND.goldDropChance) return;
        // Plausibility: within reach of the launch, inside the campus, and laid on the floor.
        const reach = Math.hypot(...entry.record.v) * DISC_REST_SECONDS + 5;
        if (distance(entry.record.o, at) > reach || !inBounds({ p: at, yaw: 0, pitch: 0 })) return;
        this.discs.push({ id: ++this.discId, at: [at[0], Math.max(0.02, Math.min(at[1], 3)), at[2]] });
        this.out.all({ type: 'discs', discs: this.discs });
    }

    private pickupDiscs(player: Player) {
        if (!player.alive || !player.pose || player.ammo >= AMMO.max) return;
        const [x, y, z] = player.pose.p;
        const taken = this.discs.filter(
            (disc) =>
                Math.hypot(disc.at[0] - x, disc.at[2] - z) <= AMMO.pickupRadius &&
                Math.abs(disc.at[1] - (y - 0.9)) < 1.6
        );
        if (!taken.length) return;
        const room = AMMO.max - player.ammo;
        const picked = taken.slice(0, room);
        player.ammo += picked.length;
        this.discs = this.discs.filter((disc) => !picked.includes(disc));
        this.out.to(player.id, { type: 'ammo', ammo: player.ammo });
        this.out.all({ type: 'discs', discs: this.discs });
    }

    /** The PE office puts out a fresh disc every AMMO.officeSeconds (a few may pile up there, no more). */
    private officeTick(now: number) {
        if (!this.players.size) return;
        if (this.officeAt === null) this.officeAt = now;
        if (now - this.officeAt < AMMO.officeSeconds * 1000) return;
        this.officeAt = now;
        const near = this.discs.filter((disc) => Math.hypot(disc.at[0] - PE_OFFICE.x, disc.at[2] - PE_OFFICE.z) < 3);
        if (near.length >= AMMO.officeMax) return;
        const a = this.random() * Math.PI * 2;
        const r = 0.3 + this.random() * 0.6;
        const id = ++this.discId;
        this.discs.push({ id, at: [PE_OFFICE.x + Math.cos(a) * r, 0.02, PE_OFFICE.z + Math.sin(a) * r] });
        this.out.all({ type: 'discs', discs: this.discs, added: { id, office: true } });
    }

    /** A player threw inside 纪老师's view (checked on the client against walls); the room checks he is near. */
    private caught(player: Player, now: number) {
        if (this.executionFor(player.id)) return;
        if (!player.pose) return;
        const teacher = teacherAt(now);
        if (Math.hypot(player.pose.p[0] - teacher.x, player.pose.p[2] - teacher.z) > 20) return;
        player.detainedUntil = Math.max(player.detainedUntil, now + DETENTION_SECONDS * 1000);
        this.out.all({ type: 'caught', id: player.id });
    }

    private scores(): Scores {
        const scores: Scores = {};
        for (const each of this.players.values()) scores[each.id] = [each.score, each.kills, each.deaths];
        return scores;
    }

    /** Lifetime stats for signed-in players, and the standing 淘汰王. */
    private persist(attacker: Player, target: Player, out: boolean, now: number, discHit = true) {
        if (!this.accounts) return;
        if (attacker.accountName) {
            const stats = this.accounts.record(attacker.accountName, {
                hits: discHit ? 1 : 0,
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

/** A thrown disc must have come to rest within this long of flight (generous; it bounces and slides). */
const DISC_REST_SECONDS = 6;

const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const inBounds = ({ p: [x, y, z] }: PlayerPose) =>
    x >= BOUNDS.x0 && x <= BOUNDS.x1 && y >= BOUNDS.y0 && y <= BOUNDS.y1 && z >= BOUNDS.z0 && z <= BOUNDS.z1;

const summary = ({
    id,
    name,
    accountName,
    colour,
    alive,
    spectating,
    hp,
    score,
    kills,
    deaths,
    avatarId,
    avatarVersion
}: Player): PlayerSummary => ({
    id,
    name,
    account: accountName !== null,
    colour,
    alive,
    spectating,
    hp,
    score,
    kills,
    deaths,
    avatarId,
    avatarVersion
});
