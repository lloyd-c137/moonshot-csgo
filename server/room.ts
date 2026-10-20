// Pure game-room logic for the shared campus world (no Cloudflare APIs, so node tests drive it directly).
// One room holds everyone; the Durable Object in worker.ts owns the sockets and calls into this class.
import { SOUTH_GATE } from '../src/config/gameplay.ts';
import { ITEM_RULES, ITEM_SPAWNS, NPC_SPAWNS } from '../src/config/gameplayItems.ts';
import { PE_OFFICE } from '../src/config/office.ts';
import { SKIN_POINTS } from '../src/config/skins.ts';
import { SPAWN_POINTS } from '../src/config/spawns.ts';
import { CUTSCENE_SECONDS, inCutscene  } from '../src/gameplay/cutscenes/cutscenes.ts';
import type { MomentCutscene } from '../src/gameplay/cutscenes/cutscenes.ts';
import { canExecute, canStartGlobalFinisher, EXECUTION, executionWatched } from '../src/gameplay/execution.ts';
import type { Execution } from '../src/gameplay/execution.ts';
import { GLOBAL_FINISHER_CONFIG } from '../src/gameplay/finisher/FinisherTypes.ts';
import type { GlobalFinisher } from '../src/gameplay/finisher/FinisherTypes.ts';
import { inPlaza } from '../src/gameplay/gateLobby.ts';
import { guardAt, GUARD } from '../src/gameplay/guard.ts';
import { nearBreaker, powerOut } from '../src/gameplay/power.ts';
import type { PowerState } from '../src/gameplay/power.ts';
import { teacherAt } from '../src/gameplay/teacher.ts';
import type {
    AccountStats,
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
    Vec3Tuple,
    WorldItem
} from '../src/net/protocol.ts';
import {
    AMMO,
    CHAT,
    cleanChat,
    cleanName,
    colourFor,
    DETENTION_SECONDS,
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
import { implausibleMove, judgeHit, PoseHistory } from './combatValidation.ts';
import { resolveGoldDrop } from './goldDrop.ts';

/** Campus bounds (m) a reported pose must lie inside; anything else is ignored. */
const BOUNDS = { x0: -75, x1: 77, y0: -10, y1: 14, z0: -68, z1: 66 };
/** Slack (m) on the flight-length check: the disc's own radius, bounce losses and claim rounding. */
const REACH_SLACK = 1.5;
/** Minimum time (ms) between two crowd emotes from one spectator. */
const EMOTE_INTERVAL = 1000;
const samePlayerPose = (a: PlayerPose | null, b: PlayerPose) =>
    !!a && a.p[0] === b.p[0] && a.p[1] === b.p[1] && a.p[2] === b.p[2] && a.yaw === b.yaw && a.pitch === b.pitch && a.aim === b.aim && a.crouched === b.crouched;

type Player = Omit<PlayerSummary, 'account'> & {
    pose: PlayerPose | null;
    poseRevision: number;
    poseAt: number;
    lastThrowAt: number;
    lastCrouchAt: number;
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
    /** Where a spectator is walking in the stands (final ceremony and minute only). */
    fanPose?: PlayerPose | null;
    fanPoseAt: number;
    /** Golden throws so far, and when the golden disc may be thrown again after a burst. */
    goldThrows: number;
    goldCooldownUntil: number;
    detainedUntil: number;
    /** Recent (arrival − sender clock) samples and the smoothed offset that maps the sender's clock to room time. */
    clockSamples: number[];
    clockOffset: number | null;
    throws: Map<number, { record: ThrowRecord; at: number; scored: boolean; golden: boolean; landed: boolean }>;
    /** Room-stamped recent positions, for judging hits where the thrower saw the target. */
    history: PoseHistory;
    /** Moves faster than sprinting allows (logged only; see combatValidation.ts). */
    suspiciousMoves: number;
    /** Last final-minute crowd emote (rate limit). */
    lastEmoteAt: number;
    lastJoinAttemptAt: number;
    lastBoundaryCorrectionAt: number;
    hasReviveArmor: boolean;
    reviveUsed: boolean;
    reviveTaken: boolean;
    hasFrc: boolean;
    hasEye: boolean;
    hasStealth: boolean;
    hasCreation: boolean;
    hasFlashlight: boolean;
    coachGift: boolean;
    ammoCapacity: number;
    frcSelected: boolean;
    frcCooldownUntil: number;
    stealthUntil: number;
    stealthCooldownUntil: number;
    creationNextAt: number;
};
type FinisherPreparation = {
    requestId: string;
    intentId: string;
    targetId: string;
    preparedAt: number;
    commitRequested: boolean;
};
/** Account-scoped state that must survive a socket replacement for the current round. */
type RoundStanding = {
    roundId: number;
    phase: 'lobby' | 'playing';
    alive: boolean;
    spectating: boolean;
    finalOut: boolean;
    respawnAt: number;
    hp: number;
    score: number;
    kills: number;
    deaths: number;
    ammo: number;
    ammoCapacity: number;
    /** A round-long talent rather than a dropped world item. */
    coachGift: boolean;
    reviveTaken: boolean;
    fanPose: PlayerPose | null;
    pose: PlayerPose | null;
    lastSeen: number;
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
    private roundStanding = new Map<string, RoundStanding>();
    private spawnCursor = 0;
    private readonly spawnCount: number;
    private readonly out: Outbox;
    private readonly accounts: Accounts | null;
    private readonly requireLobbyEntry: boolean;
    private items = new Map<string, WorldItem>();
    private markGiven = false;
    private interactionTimes = new Map<string, number>();
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
    private momentCutscene: MomentCutscene | null = null;
    private momentCutsceneSequence = 0;
    private goldCutscenePlayed = false;
    private lastTwoCutscenePlayed = false;
    private roundPeakPlayers = 0;
    /** Match-time offset grows only while the authoritative world is globally frozen. */
    private matchClockOffset = 0;
    /** Real-time start of the current empty-room grace period. */
    private emptySince: number | null = null;
    gold: GoldState = { holder: null, at: [0, 0.92, 0] };
    private goldDroppedAt = 0;
    /** Discs a newcomer carries (tests raise it to throw repeatedly). */
    startAmmo: number = AMMO.start;
    /** Discs lying on the floor, and when the PE office last put one out. */
    discs: GroundDisc[] = [];
    private discId = 0;
    private officeAt: number | null = null;
    private readonly random: () => number;

    constructor(
        out: Outbox,
        spawnCount: number,
        accounts: Accounts | null = null,
        random = Math.random,
        requireLobbyEntry = false
    ) {
        this.out = out;
        this.random = random;
        this.spawnCount = spawnCount;
        this.accounts = accounts;
        this.requireLobbyEntry = requireLobbyEntry;
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
        const global = this.globalFinisher;
        const execution = this.executionFor(id);
        // A target cannot dodge an already-started execution by refreshing. The server resolves it before removing
        // the socket. An attacker disconnect still cancels the scene without eliminating the target.
        if (global?.target.id === id) this.settleDisconnectedExecutionTarget(player, global.attacker.id, now, realNow);
        else if (execution?.target.id === id) this.settleDisconnectedExecutionTarget(player, execution.attacker.id, now, realNow);
        if (global && (global.attacker.id === id || global.target.id === id))
            this.cancelGlobalFinisher('处决参与者断开连接', realNow);
        this.preparations.delete(id);
        if (execution) {
            this.executions.delete(execution.id);
            this.out.all({ type: 'executionEnded', id: execution.id, completed: execution.target.id === id, reason: '玩家离开' });
        }
        this.interactionTimes.delete(id);
        this.dropHeldItems(player, now);
        // Leaving with the golden disc drops it where they stood.
        if (this.gold.holder === id) this.dropGold(player, now);
        this.saveStanding(player, realNow);
        this.players.delete(id);
        this.out.all({ type: 'left', id });
        this.checkLastStanding(now);
        // An empty room forgets its round; the next arrival starts a fresh one.
        if (!this.players.size) {
            this.emptySince = realNow;
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
        if (message.type === 'hello')
            return this.hello(id, message.version, message.name, message.token, realNow, message.phase ?? 'playing');
        const player = this.players.get(id);
        if (!player) return;
        if (message.type === 'ping') return this.out.to(player.id, { type: 'pong', c: message.c });
        // The room is authoritative: no gameplay or chat message is queued while a finisher owns the world.
        if (this.globalFinisher) return;
        if (message.type === 'skipMomentCutscene') return this.skipMomentCutscene(message.id, realNow);
        const matchNow = this.matchNow(realNow);
        // Fans in the stands keep moving through the ceremony (their poses never take part in combat).
        if (message.type === 'pose' && player.spectating) return this.fanPose(player, message.pose, matchNow);
        if (this.inMomentCutscene(matchNow) || this.inCeremony(matchNow) || inCutscene(matchNow, this.blackoutAt(), this.power))
            return;
        if (message.type === 'joinRound') return this.joinRound(player, realNow);
        if (message.type === 'interact') return this.interact(player, message.target, this.matchNow(realNow));
        if (message.type === 'toggleFrc') return this.toggleFrc(player, this.matchNow(realNow));
        if (message.type === 'activateStealth') return this.activateStealth(player, this.matchNow(realNow));
        if (player.phase === 'lobby' && message.type !== 'chat' && message.type !== 'pose') return;
        if (message.type === 'executionPrepare')
            return this.prepareFinisher(player, message.requestId, message.target, realNow, this.matchNow(realNow));
        if (message.type === 'executionCommit') return this.commitFinisher(player, message.requestId, realNow);
        if (message.type === 'executionCancel') return this.cancelFinisherPreparation(player, message.requestId);
        const now = this.matchNow(realNow);
        switch (message.type) {
            case 'pose':
            case 'respawned': {
                if (player.spectating || this.executionFor(id)) return;
                if (!inBounds(message.pose)) return;
                if (player.phase === 'lobby' && !this.validLobbyPose(message.pose.p)) {
                    if (now - player.lastBoundaryCorrectionAt >= 250 && player.pose) {
                        player.lastBoundaryCorrectionAt = now;
                        this.out.to(player.id, { type: 'positionCorrected', pose: player.pose });
                    }
                    return;
                }
                if (player.phase === 'lobby' && message.type === 'respawned') return;
                if (message.type === 'respawned' && !player.alive && now >= player.respawnAt) {
                    player.alive = true;
                    player.spawnedAt = now;
                }
                let acceptedPose = message.pose;
                const stanceChanged = !!player.pose?.crouched !== !!message.pose.crouched && (player.pose !== null || message.pose.crouched === true);
                // Stance is discrete. Throttle rapid toggles without discarding the position update.
                if (stanceChanged && now - player.lastCrouchAt < 250)
                    acceptedPose = { ...message.pose, crouched: !!player.pose?.crouched };
                else if (stanceChanged) player.lastCrouchAt = now;
                if (!samePlayerPose(player.pose, acceptedPose)) player.poseRevision++;
                player.pose = acceptedPose;
                player.poseAt = message.type === 'pose' ? stampPose(player, message.ct, now) : now;
                // Lag-compensation history runs on the real room clock (the one snapshots and hit claims use), not the
                // match clock that stops during a global finisher.
                const historyAt = player.poseAt + (realNow - now);
                if (message.type === 'respawned' || message.tp) player.history.reset(historyAt, acceptedPose);
                else {
                    if (implausibleMove(player.history.latest(), historyAt, message.pose.p)) {
                        // Log-only until real sprint speeds and every in-game teleport are measured in playtests.
                        if (++player.suspiciousMoves % 20 === 1)
                            console.warn(`implausible move #${player.suspiciousMoves} by ${player.name}`);
                    }
                    player.history.push(historyAt, acceptedPose);
                }
                this.tryPickup(player, now);
                this.pickupDiscs(player);
                return;
            }
            case 'throw':
                return this.throw(player, message.throw, now);
            case 'hit':
                return this.hit(
                    player,
                    message.throwId,
                    message.target,
                    message.at,
                    now,
                    realNow,
                    message.rt,
                    message.path
                );
            case 'chat':
                return this.chat(player, message.text, now);
            case 'emote':
                return this.emote(player, message.kind, now);
            case 'caught':
                return this.caught(player, now);
            case 'landed':
                return this.landed(player, message.throwId, message.at);
            case 'spotted':
                return this.spotted(player, now);
            case 'pullBreaker':
                if (
                    this.round?.phase !== 'playing' ||
                    player.phase !== 'playing' ||
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
        let itemsReturned = false;
        for (const item of this.items.values()) {
            if (item.returnAt !== null && now >= item.returnAt) {
                const spawn = ITEM_SPAWNS.find((candidate) => candidate.id === item.id)!;
                item.at = [...spawn.at];
                item.returnAt = null;
                item.available = true;
                itemsReturned = true;
            }
        }
        for (const player of this.players.values()) {
            if (player.stealthUntil && now >= player.stealthUntil) {
                player.stealthUntil = 0;
                this.broadcastAbility(player);
            }
            if (player.hasCreation) {
                if (!player.alive || player.ammo >= player.ammoCapacity) {
                    // The refill timer only runs while there is room for a disc (and its holder is alive): a full
                    // stack holds it at a whole interval, so the first throw never refills on the spot.
                    player.creationNextAt = now + ITEM_RULES.creationRefillMs;
                } else if (now >= player.creationNextAt) {
                    player.ammo++;
                    player.creationNextAt = now + ITEM_RULES.creationRefillMs;
                    this.sendAmmo(player);
                }
            }
            if (!player.alive && !player.spectating && player.respawnAt > 0 && now >= player.respawnAt) {
                player.respawnAt = 0;
                player.hp = MAX_HP;
                player.alive = true;
                player.spawnedAt = now;
                const spawn = this.nextSpawn();
                const [x, z] = SPAWN_POINTS[spawn];
                const pose: PlayerPose = { p: [x, 0.92, z], yaw: player.pose?.yaw ?? 0, pitch: 0 };
                player.pose = pose;
                player.poseAt = now;
                player.poseRevision++;
                player.history.reset(realNow, pose);
                const respawnAmmo = Math.min(this.startAmmo, player.ammoCapacity);
                if (player.ammo < respawnAmmo) {
                    player.ammo = respawnAmmo;
                    this.sendAmmo(player);
                }
                this.out.all({ type: 'respawn', id: player.id, spawn });
            }
            if (player.alive && player.hp < MAX_HP && now - player.hurtAt > HEAL_SECONDS * 1000) {
                player.hp = MAX_HP;
                this.out.all({ type: 'healed', id: player.id, hp: player.hp });
            }
            for (const [throwId, entry] of player.throws) {
                if (now - entry.at > THROW_CLAIM_WINDOW * 1000) player.throws.delete(throwId);
            }
        }
        if (this.players.size) {
            for (const recipient of this.players.values()) {
                const poses: Record<string, StampedPose> = {};
                for (const player of this.players.values()) {
                    // Stealth positions are omitted per recipient, never merely hidden by a presentation flag.
                    if (player.id === recipient.id || player.stealthUntil > now) continue;
                    if (player.pose && player.alive)
                        poses[player.id] = { ...player.pose, t: player.poseAt + (realNow - now), rev: player.poseRevision };
                }
                const fans: Record<string, StampedPose> = {};
                if (this.standsOpen(now))
                    for (const player of this.players.values())
                        if (player.id !== recipient.id && player.spectating && player.fanPose && now - player.fanPoseAt < 2000)
                            fans[player.id] = { ...player.fanPose, t: player.fanPoseAt + (realNow - now) };
                this.out.to(recipient.id, { type: 'snapshot', t: realNow, poses, ...(Object.keys(fans).length ? { fans } : {}) });
            }
        }
        if (itemsReturned) this.broadcastItems();
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

    /** A player bought or switched skins (from the shop API): everyone sees the new disc from the next throw. */
    updateSkin(account: AccountStats) {
        const player = [...this.players.values()].find((entry) => entry.accountName === account.name);
        if (!player) return;
        const skin = account.equippedSkin ?? null;
        player.skin = skin;
        player.skinCounter = !!(skin && account.skins?.[skin]?.counter);
        player.skinKills = skin ? (account.skins?.[skin]?.kills ?? 0) : 0;
        this.broadcastAbility(player);
    }

    private hello(
        id: string,
        version: number,
        rawName: string,
        token: string | undefined,
        realNow: number,
        phase: 'lobby' | 'playing'
    ) {
        if (!this.pending.has(id)) return;
        let now = this.matchNow(realNow);
        // Production Worker rooms never trust the client's initial phase claim; the turnstile is the only entry.
        phase = this.requireLobbyEntry ? 'lobby' : phase;
        this.pending.delete(id);
        if (version !== PROTOCOL_VERSION) {
            this.out.to(id, { type: 'rejected', reason: 'version' });
            return this.out.close(id);
        }
        const account = this.accounts?.resolve(token, realNow) ?? null;
        // With accounts enabled every player must be signed in (there is no guest entry).
        if (this.accounts && !account) {
            this.out.to(id, { type: 'rejected', reason: 'auth' });
            return this.out.close(id);
        }
        const replacingAccount = !!account && [...this.players.values()].some((player) => player.accountName === account.name);
        if (this.players.size >= MAX_PLAYERS && !replacingAccount) {
            this.out.to(id, { type: 'rejected', reason: 'full' });
            return this.out.close(id);
        }
        if (!this.players.size && this.emptySince !== null) {
            if (realNow - this.emptySince >= ROUND.emptyRoomGraceSeconds * 1000) {
                if (this.round?.phase === 'playing' && now >= this.round.endsAt) this.advanceRound(now);
                this.clearEmptyRoom();
            } else this.advanceRound(now);
            now = this.matchNow(realNow);
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
        const standing = account && this.roundStanding.get(account.name);
        const resumed = standing?.roundId === this.roundId ? standing : undefined;
        if (resumed?.phase === 'playing') phase = 'playing';
        const player: Player = {
            id,
            name,
            phase,
            colour: this.freeColour(id),
            alive: resumed?.alive ?? true,
            hp: resumed?.hp ?? MAX_HP,
            score: resumed?.score ?? 0,
            kills: resumed?.kills ?? 0,
            deaths: resumed?.deaths ?? 0,
            pose: phase === 'lobby'
                ? { p: [SOUTH_GATE.spawn.x, SOUTH_GATE.spawn.y, SOUTH_GATE.spawn.z], yaw: 0, pitch: 0 }
                : resumed?.pose ? structuredClone(resumed.pose) : null,
            poseRevision: 0,
            poseAt: phase === 'lobby' || resumed?.pose ? now : 0,
            lastThrowAt: -Infinity,
            lastCrouchAt: -Infinity,
            respawnAt: resumed ? (resumed.alive || resumed.finalOut ? 0 : Math.max(now, resumed.respawnAt)) : 0,
            hurtAt: 0,
            spawnedAt: this.matchNow(realNow),
            accountName: account?.name ?? null,
            avatarId: account?.avatarId ?? null,
            avatarVersion: account?.avatarVersion ?? null,
            skin: account?.equippedSkin ?? null,
            skinCounter: !!(account?.equippedSkin && account.skins?.[account.equippedSkin]?.counter),
            skinKills: account?.equippedSkin ? (account.skins?.[account.equippedSkin]?.kills ?? 0) : 0,
            chatTimes: [],
            ammo: resumed?.ammo ?? this.startAmmo,
            spectating: resumed?.finalOut === true || resumed?.spectating === true,
            fanPose: resumed?.fanPose ? structuredClone(resumed.fanPose) : null,
            fanPoseAt: resumed?.fanPose ? now : 0,
            goldThrows: 0,
            goldCooldownUntil: 0,
            detainedUntil: 0,
            clockSamples: [],
            clockOffset: null,
            throws: new Map(),
            history: new PoseHistory(),
            suspiciousMoves: 0,
            lastEmoteAt: -Infinity,
            lastJoinAttemptAt: -Infinity,
            lastBoundaryCorrectionAt: -Infinity,
            hasReviveArmor: false,
            reviveUsed: resumed?.reviveTaken ?? false,
            reviveTaken: resumed?.reviveTaken ?? false,
            hasFrc: false,
            hasEye: false,
            hasStealth: false,
            hasCreation: false,
            hasFlashlight: false,
            coachGift: resumed?.coachGift ?? false,
            ammoCapacity: resumed?.ammoCapacity ?? AMMO.max,
            frcSelected: false,
            frcCooldownUntil: 0,
            stealthUntil: 0,
            stealthCooldownUntil: 0,
            creationNextAt: now + ITEM_RULES.creationRefillMs
        };
        if (resumed?.finalOut) {
            player.alive = false;
            player.spectating = true;
            player.respawnAt = 0;
        } else if (resumed && !resumed.alive) {
            player.alive = false;
            player.spectating = false;
            // An expired wait remains eligible for the next authoritative respawn tick.
            player.respawnAt = Math.max(now, resumed.respawnAt);
        }
        this.players.set(id, player);
        this.emptySince = null;
        if (!this.round) this.startRound(this.matchNow(realNow), false);
        if (phase === 'playing') this.roundPeakPlayers = Math.max(this.roundPeakPlayers, this.playingPlayerCount());
        // Arriving after the lights went out: watch until the next round.
        if (phase === 'playing' && (player.spectating || this.blackout(now) || (account && this.executedAccounts.has(account.name)))) {
            player.alive = false;
            player.spectating = true;
            player.respawnAt = 0;
        }
        if (phase === 'playing' && this.round?.phase === 'playing' && !player.spectating && player.accountName)
            this.roundParticipants.add(player.accountName);
        this.saveStanding(player, realNow);
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
            momentCutscene: this.inMomentCutscene(now) ? structuredClone(this.momentCutscene) : null,
            gold: this.gold,
            ammo: player.ammo,
            discs: this.discs,
            items: [...this.items.values()],
            t: realNow,
            matchTime: this.matchNow(realNow),
            crouchV1: true,
            ownPose: player.pose ? structuredClone(player.pose) : undefined
        });
        this.out.all({ type: 'joined', player: summary(player) }, id);
    }

    private saveStanding(player: Player, realNow: number) {
        if (!player.accountName || !this.round) return;
        this.roundStanding.set(player.accountName, {
            roundId: this.roundId,
            phase: player.phase,
            alive: player.alive,
            spectating: player.spectating,
            finalOut: player.phase === 'playing' && player.spectating,
            respawnAt: player.respawnAt,
            hp: player.hp,
            score: player.score,
            kills: player.kills,
            deaths: player.deaths,
            ammo: player.ammo,
            ammoCapacity: player.ammoCapacity,
            coachGift: player.coachGift,
            reviveTaken: player.reviveTaken,
            fanPose: player.fanPose ? structuredClone(player.fanPose) : null,
            pose: player.pose ? structuredClone(player.pose) : null,
            lastSeen: realNow
        });
    }

    private clearEmptyRoom() {
        this.globalFinisher = null;
        this.matchClockOffset = 0;
        this.preparations.clear();
        this.round = null;
        this.roundStanding.clear();
        this.executedAccounts.clear();
        this.power = { pulledAt: null };
        this.roundParticipants.clear();
        this.discs = [];
        this.items.clear();
        this.officeAt = null;
        this.emptySince = null;
    }

    private settleDisconnectedExecutionTarget(target: Player, attackerId: string, now: number, realNow: number) {
        if (!target.alive || target.spectating || !target.pose) return;
        const attacker = this.players.get(attackerId);
        const revived = this.reviveOnLethal(target, now);
        if (!revived) {
            target.hp = 0;
            target.alive = false;
            target.spectating = true;
            target.respawnAt = 0;
            target.deaths++;
            if (target.accountName) this.executedAccounts.add(target.accountName);
            if (attacker?.alive) {
                attacker.kills++;
                attacker.score += POINTS.elimination;
            }
        }
        this.out.all({
            type: 'struck',
            target: target.id,
            by: attackerId,
            hp: revived ? MAX_HP : 0,
            out: !revived,
            head: false,
            sniper: false,
            gold: false,
            final: !revived,
            execution: true,
            revived,
            at: [...target.pose.p],
            scores: this.scores()
        });
        if (attacker) this.persist(attacker, target, !revived, now, false);
        else if (!revived && target.accountName && this.accounts) {
            const stats = this.accounts.record(target.accountName, { deaths: 1 });
            if (stats) this.out.to(target.id, { type: 'account', account: stats });
        }
        if (!revived) this.fallen(target, now);
        else this.out.all({ type: 'revived', id: target.id, at: [...target.pose.p] });
        this.saveStanding(target, realNow);
        if (attacker) this.saveStanding(attacker, realNow);
    }

    private validLobbyPose(p: Vec3Tuple) {
        if (inPlaza(p[0], p[2])) return true;
        const { x0, x1, line } = SOUTH_GATE;
        // Allow a narrow approach/crossing window so joinRound can be validated on the following message.
        return p[0] >= x0 - 0.35 && p[0] <= x1 + 0.35 && p[2] >= line - 0.9 && p[2] <= line + 1.8;
    }

    private joinRound(player: Player, realNow: number) {
        const now = this.matchNow(realNow);
        if (realNow - player.lastJoinAttemptAt < 500) return;
        player.lastJoinAttemptAt = realNow;
        if (player.phase !== 'lobby') {
            this.out.to(player.id, { type: 'joinRoundDenied', reason: '你已经加入本局' });
            return;
        }
        if (!player.pose || !this.validJoinGatePose(player.pose.p)) {
            this.out.to(player.id, { type: 'joinRoundDenied', reason: '请在闸机通道内完成加入' });
            return;
        }
        player.phase = 'playing';
        this.roundPeakPlayers = Math.max(this.roundPeakPlayers, this.playingPlayerCount());
        player.spawnedAt = now;
        player.hp = MAX_HP;
        player.alive = true;
        player.spectating = false;
        player.respawnAt = 0;
        const standing = player.accountName ? this.roundStanding.get(player.accountName) : undefined;
        if (
            (standing?.roundId === this.roundId && standing.finalOut) ||
            this.blackout(now) ||
            (player.accountName && this.executedAccounts.has(player.accountName))
        ) {
            player.alive = false;
            player.spectating = true;
            player.respawnAt = 0;
        }
        if (this.round?.phase === 'playing' && !player.spectating && player.accountName)
            this.roundParticipants.add(player.accountName);
        this.saveStanding(player, realNow);
        this.out.all({ type: 'phaseChanged', id: player.id, phase: 'playing' });
    }

    private validJoinGatePose(p: Vec3Tuple) {
        const { x0, x1, line, approach, through } = SOUTH_GATE;
        return (
            p[0] >= x0 - 0.35 &&
            p[0] <= x1 + 0.35 &&
            p[2] >= line - through - 0.45 &&
            p[2] < line &&
            p[2] <= line + approach
        );
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
            else
                this.out.to(attacker.id, { type: 'executionPrepareDenied', requestId, reason: '已有处决准备正在进行' });
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
            this.out.to(attacker.id, {
                type: 'executionPrepareDenied',
                requestId,
                reason: '处决准备已失效，请重新尝试'
            });
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
            .filter(
                ([, preparation]) =>
                    preparation.commitRequested &&
                    realNow >= preparation.preparedAt + GLOBAL_FINISHER_CONFIG.holdDurationMs
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
        if (
            attacker.phase !== 'playing' ||
            target.phase !== 'playing' ||
            !attacker.alive ||
            attacker.spectating ||
            !target.alive ||
            target.spectating
        )
            return '处决双方都必须处于存活状态';
        if (!attacker.pose || !target.pose || now - attacker.poseAt > 1000 || now - target.poseAt > 1000)
            return '玩家位置数据已过期';
        if (now - attacker.spawnedAt < SPAWN_PROTECTION * 1000 || now - target.spawnedAt < SPAWN_PROTECTION * 1000)
            return '出生保护期间不能处决';
        if (attacker.detainedUntil > now) return '罚站期间不能处决';
        if (target.stealthUntil > now) return '隐身期间无法处决';
        if (target.detainedUntil > now) return '目标正在罚站，无法发动全场处决';
        if (this.executionFor(attacker.id) || this.executionFor(target.id)) return '处决双方正在参与其他动作';
        if (
            (this.finisherUses.get(attacker.accountName ?? attacker.id) ?? 0) >=
            GLOBAL_FINISHER_CONFIG.maxPerPlayerPerRound
        )
            return '本局处决次数已用完';
        if (this.finisherRoundUses >= GLOBAL_FINISHER_CONFIG.maxPerRound) return '本局全场处决次数已达上限';
        if (now < this.finisherCooldownUntil) return '全场处决冷却中';
        if (this.gold.holder !== attacker.id && attacker.ammo <= 0) return '至少需要一张可用飞盘';
        if (!canStartGlobalFinisher(attacker.pose, target.pose)) return '需要位于目标身后、靠近目标且无遮挡';
        // Owner rule (2026-10-17): never inside 纪老师's watch circle.
        if (executionWatched(now, attacker.pose, target.pose)) return '纪老师正在看着：他的监视圈内禁止处决';
        return null;
    }

    private tryStartGlobalFinisher(
        attacker: Player,
        preparation: FinisherPreparation,
        realNow: number,
        matchNow: number
    ) {
        if (this.preparations.get(attacker.id) !== preparation || this.globalFinisher) return;
        const reason = this.finisherDenial(attacker, preparation.targetId, matchNow);
        if (reason) {
            this.preparations.delete(attacker.id);
            this.out.to(attacker.id, {
                type: 'executionPrepareDenied',
                requestId: preparation.requestId,
                reason
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
            const revived = this.reviveOnLethal(target, matchNow);
            const counter = !revived ? this.countSkinElimination(attacker) : null;
            if (!revived) {
                target.hp = 0;
                target.alive = false;
                target.spectating = true;
                target.respawnAt = 0;
                target.deaths++;
                if (target.accountName) this.executedAccounts.add(target.accountName);
                attacker.kills++;
                attacker.score += POINTS.elimination;
            }
            this.out.all({
                type: 'struck',
                target: target.id,
                by: attacker.id,
                hp: revived ? MAX_HP : 0,
                out: !revived,
                head: false,
                sniper: false,
                gold: false,
                final: !revived,
                execution: true,
                revived,
                ...(counter ?? {}),
                at: [...target.pose!.p],
                scores: this.scores()
            });
            this.persist(attacker, target, !revived, matchNow, false);
            if (!revived) this.fallen(target, matchNow);
            else this.out.all({ type: 'revived', id: target.id, at: [...target.pose!.p] });
            const key = attacker.accountName ?? attacker.id;
            this.finisherUses.set(key, (this.finisherUses.get(key) ?? 0) + 1);
            this.finisherRoundUses++;
            this.finisherCooldownUntil = matchNow + GLOBAL_FINISHER_CONFIG.globalCooldownMs;
        }
        this.out.all({
            type: 'globalFinisherCompleted',
            id: finisher.id,
            sequence: ++this.finisherSequence,
            target: finisher.target.id,
            by: finisher.attacker.id,
            resumedAt: now
        });
        this.broadcastResumedClock();
    }

    private cancelGlobalFinisher(reason: string, now: number) {
        const finisher = this.globalFinisher;
        if (!finisher) return;
        this.globalFinisher = null;
        this.matchClockOffset += Math.max(0, now - finisher.pauseAt);
        this.out.all({
            type: 'globalFinisherCancelled',
            id: finisher.id,
            sequence: ++this.finisherSequence,
            reason,
            resumedAt: now
        });
        this.broadcastResumedClock();
    }

    private broadcastResumedClock() {
        if (this.round) this.out.all({ type: 'round', round: this.round, scores: this.scores() });
        this.out.all({ type: 'power', power: this.power });
    }

    private startExecution(attacker: Player, targetId: string, now: number) {
        const target = this.players.get(targetId);
        if (target?.pose && attacker.pose && executionWatched(now, attacker.pose, target.pose)) {
            this.out.to(attacker.id, { type: 'executionDenied', reason: '纪老师正在看着：他的监视圈内禁止处决' });
            return;
        }
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
        if (
            !attacker ||
            !target ||
            attacker.phase !== 'playing' ||
            target.phase !== 'playing' ||
            !attacker.alive ||
            !target.alive ||
            this.round?.phase !== 'playing'
        ) {
            this.cancelExecutionFor(execution.attacker.id, '处决已中断');
            return;
        }
        this.executions.delete(execution.id);
        const revived = this.reviveOnLethal(target, now);
        const counter = !revived ? this.countSkinElimination(attacker) : null;
        if (!revived) {
            target.hp = 0;
            target.alive = false;
            target.spectating = true;
            target.respawnAt = 0;
            target.deaths++;
            if (target.accountName) this.executedAccounts.add(target.accountName);
            attacker.kills++;
            attacker.score += POINTS.elimination;
        }
        this.out.all({ type: 'executionEnded', id: execution.id, completed: true, reason: '处决完成' });
        this.out.all({
            type: 'struck',
            target: target.id,
            by: attacker.id,
            hp: revived ? MAX_HP : 0,
            out: !revived,
            head: false,
            sniper: false,
            gold: false,
            final: !revived,
            execution: true,
            revived,
            ...(counter ?? {}),
            at: [...target.pose!.p],
            scores: this.scores()
        });
        this.persist(attacker, target, !revived, now, false);
        if (!revived) this.fallen(target, now);
        else this.out.all({ type: 'revived', id: target.id, at: [...target.pose!.p] });
    }

    private throw(player: Player, record: ThrowRecord, now: number) {
        if (player.phase !== 'playing' || this.round?.phase !== 'playing' || this.executionFor(player.id)) return;
        if (!player.alive || now - player.lastThrowAt < THROW_COOLDOWN * 1000 * 0.8) return;
        const speed = Math.hypot(...record.v);
        if (speed > MAX_THROW_SPEED + 12 || player.throws.has(record.id)) return;
        // The disc must leave from near the thrower's last known position.
        if (player.pose && distance(player.pose.p, record.o) > 3) return;
        // A sniper flag only counts on a full-speed launch.
        if (record.sniper && speed < SNIPER.minSpeed) record.sniper = false;
        const usingFrc = record.frc === true;
        if (usingFrc && (!player.hasFrc || !player.frcSelected || now < player.frcCooldownUntil)) return;
        // Every regular throw spends a disc, except the golden one (it comes back) and the reusable FRC disc.
        const golden = this.gold.holder === player.id;
        if (usingFrc) {
            player.frcSelected = false;
            player.frcCooldownUntil = now + ITEM_RULES.frcCooldownMs;
            const frc = this.items.get('item-frc');
            if (frc) frc.cooldownUntil = player.frcCooldownUntil;
            this.broadcastAbility(player, frc ?? null);
        } else if (golden) {
            // Every ROUND.goldBurst golden throws, a cooldown (a little slack for latency).
            if (now < player.goldCooldownUntil) return;
            player.goldThrows++;
            if (player.goldThrows % ROUND.goldBurst === 0)
                player.goldCooldownUntil = now + ROUND.goldCooldown * 1000 * 0.85;
        } else {
            if (player.ammo <= 0) return;
            player.ammo--;
            this.sendAmmo(player);
        }
        player.lastThrowAt = now;
        if (player.stealthUntil) {
            player.stealthUntil = 0;
            this.broadcastAbility(player);
        }
        player.throws.set(record.id, { record, at: now, scored: false, golden, landed: false });
        this.out.all({ type: 'thrown', from: player.id, t: now, throw: record }, player.id);
    }

    private hit(
        player: Player,
        throwId: number,
        targetId: string,
        at: Vec3Tuple,
        now: number,
        realNow: number,
        seenAt?: number,
        bounces: Vec3Tuple[] = []
    ) {
        const entry = player.throws.get(throwId);
        const target = this.players.get(targetId);
        const reject = () => this.out.to(player.id, { type: 'hitRejected', throwId });
        if (
            this.round?.phase !== 'playing' ||
            this.inCeremony(now) ||
            inCutscene(now, this.blackoutAt(), this.power) ||
            player.phase !== 'playing' ||
            !entry ||
            entry.scored ||
            !target ||
            target.phase !== 'playing' ||
            target === player ||
            !target.alive ||
            !target.pose
        )
            return reject();
        if (now - target.spawnedAt < SPAWN_PROTECTION * 1000) return reject();
        const elapsed = (now - entry.at) / 1000;
        if (elapsed > THROW_CLAIM_WINDOW) return reject();
        // Judge against where the target was when the thrower saw it (capped rewind), along the reported flight.
        const verdict = judgeHit({
            history: target.history,
            now: realNow,
            claimedTime: seenAt,
            origin: entry.record.o,
            contact: at,
            bounces,
            reach: Math.hypot(...entry.record.v) * (elapsed + 0.35) + REACH_SLACK
        });
        if (!verdict.ok) return reject();
        entry.scored = true;
        this.cancelExecutionFor(target.id, '被飞盘命中');
        const head = verdict.head;
        const sniper = entry.record.sniper === true;
        // Every disc to the head is lethal outright; body hits take one point of health.
        target.hp = head || entry.record.frc ? 0 : Math.max(0, target.hp - 1);
        target.hurtAt = now;
        player.score += POINTS.hit;
        let out = target.hp === 0;
        const revived = out && this.reviveOnLethal(target, now);
        if (revived) out = false;
        if (out) {
            player.kills++;
            player.score += POINTS.elimination;
            target.deaths++;
            target.alive = false;
            target.respawnAt = now + RESPAWN_SECONDS * 1000;
            // The final-round blackout and a manual breaker outage both make eliminations final.
            if (this.blackout(now) || powerOut(now, this.power)) {
                target.spectating = true;
                target.respawnAt = 0;
                if (target.accountName) this.executedAccounts.add(target.accountName);
            }
        }
        const scores: Scores = {};
        for (const each of this.players.values()) scores[each.id] = [each.score, each.kills, each.deaths];
        // Skins dress ordinary discs only (the golden disc and the FRC disc keep their own look).
        const skinThrow = !entry.golden && entry.record.frc !== true && player.skin ? player.skin : null;
        const skinned: { skin?: string; counter?: number } = skinThrow ? { skin: skinThrow } : {};
        const counter = out ? this.countSkinElimination(player) : null;
        this.out.all({
            type: 'struck',
            throwId: entry.record.id,
            target: target.id,
            by: player.id,
            hp: target.hp,
            out,
            head,
            sniper,
            frc: entry.record.frc === true,
            gold: entry.golden,
            final: out && target.spectating,
            revived,
            ...(verdict.bank ? { bank: true } : {}),
            range: verdict.range,
            ...skinned,
            ...(counter ?? {}),
            at,
            scores
        });
        this.persist(player, target, out, now);
        if (out) this.fallen(target, now);
        if (revived) this.out.all({ type: 'revived', id: target.id, at: [...target.pose.p] });
    }

    /** Someone was eliminated: the golden disc (if theirs) and a spare disc drop where they fell. */
    private fallen(target: Player, now: number) {
        this.dropHeldItems(target, now);
        if (this.gold.holder === target.id) this.dropGold(target, now);
        if (target.pose) {
            // Poses are capsule centres (standing centre ~= floor + 0.9 m). Keep death drops on
            // the same vertical level instead of teleporting every spare disc to the ground floor.
            const centreToFoot = target.pose.crouched ? 0.6 : 0.9;
            this.discs.push({ id: ++this.discId, at: [target.pose.p[0], Math.max(0.02, target.pose.p[1] - centreToFoot), target.pose.p[2]] });
            this.out.all({ type: 'discs', discs: this.discs });
        }
        this.checkLastStanding(now);
    }

    /** A counter edition tracks every credited elimination in the round, regardless of the finishing move. */
    private countSkinElimination(player: Player): { counter: number } | null {
        if (!player.skin || !player.skinCounter || !player.accountName || !this.accounts) return null;
        const counted = this.accounts.countSkinKill(player.accountName, player.skin);
        if (counted === null) return null;
        player.skinKills = counted;
        return { counter: counted };
    }

    /** Room time when the lights go out this round (null: not playing). */
    blackoutAt(): number | null {
        return this.round?.phase === 'playing' ? this.round.endsAt - ROUND.blackoutSecondsLeft * 1000 : null;
    }

    private blackout(now: number) {
        const at = this.blackoutAt();
        return at !== null && now >= at;
    }

    /** The stands are open to players out for the round: from the final ceremony to the end of the round. */
    private standsOpen(now: number) {
        if (this.round?.phase !== 'playing') return false;
        return this.round.endsAt - this.matchNow(now) <= (ROUND.finalSecondsLeft + ROUND.ceremonySeconds) * 1000;
    }

    /** A spectator walking about in the upper bowl (accepted only up there, only while the stands are open). */
    private fanPose(player: Player, pose: PlayerPose, now: number) {
        if (!this.standsOpen(now) || !inBounds(pose) || pose.p[1] < 4.3 || pose.p[1] > 20) return;
        player.fanPose = pose;
        player.fanPoseAt = now;
    }

    /** The final entrance ceremony window (just before the final minute), when nobody can act. */
    private inCeremony(now: number) {
        if (this.round?.phase !== 'playing') return false;
        const left = this.round.endsAt - this.matchNow(now);
        return left <= (ROUND.finalSecondsLeft + ROUND.ceremonySeconds) * 1000 && left > ROUND.finalSecondsLeft * 1000;
    }

    /** The guard's flashlight caught a player (checked against walls on their client; the room checks reach). */
    private spotted(player: Player, now: number) {
        if (player.phase !== 'playing' || !player.alive || !player.pose || !this.blackout(now)) return;
        // Everyone is frozen for the final entrance ceremony and the event cutscenes.
        if (this.inCeremony(now) || inCutscene(now, this.blackoutAt(), this.power)) return;
        const guard = guardAt(now, this.blackoutAt(), this.power);
        if (Math.hypot(player.pose.p[0] - guard.x, player.pose.p[2] - guard.z) > GUARD.range + 4) return;
        this.cancelExecutionFor(player.id, '被保安淘汰');
        const revived = this.reviveOnLethal(player, now);
        if (!revived) {
            player.hp = 0;
            player.alive = false;
            player.deaths++;
            player.spectating = true;
            player.respawnAt = 0;
            if (player.accountName) this.executedAccounts.add(player.accountName);
        }
        this.out.all({
            type: 'struck',
            target: player.id,
            by: 'guard',
            hp: 0,
            out: true,
            head: false,
            sniper: false,
            gold: false,
            final: !revived,
            revived,
            at: [player.pose.p[0], player.pose.p[1] + 0.5, player.pose.p[2]],
            scores: this.scores()
        });
        if (!revived) this.fallen(player, now);
        else this.out.all({ type: 'revived', id: player.id, at: [...player.pose.p] });
    }

    private reviveOnLethal(player: Player, now: number) {
        if (!player.hasReviveArmor || player.reviveUsed) return false;
        player.hasReviveArmor = false;
        player.reviveUsed = true;
        player.reviveTaken = true;
        player.hp = MAX_HP;
        player.alive = true;
        player.spectating = false;
        player.respawnAt = 0;
        player.spawnedAt = now;
        player.hurtAt = now;
        const item = this.items.get('item-revive');
        if (item) {
            item.available = false;
            item.holder = null;
            item.returnAt = null;
        }
        this.broadcastItems();
        this.broadcastAbility(player, item ?? null);
        return true;
    }

    /** After the lights go out: when one player (or nobody) is left standing, the round ends at once. */
    private checkLastStanding(now: number) {
        if (this.round?.phase !== 'playing') return;
        const participants = [...this.players.values()].filter((each) => each.phase === 'playing');
        const standing = participants.filter((each) => !each.spectating);
        if (standing.length === 2 && this.roundPeakPlayers >= 3 && !this.lastTwoCutscenePlayed) {
            this.lastTwoCutscenePlayed = true;
            const [a, b] = standing;
            if (a.pose && b.pose)
                this.startMomentCutscene('last-two', now, a.pose.p, b.pose.p);
        }
        if (!this.blackout(now)) return;
        if (standing.length > 1 || participants.length < 2) return;
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
        this.roundStanding.clear();
        this.executedAccounts.clear();
        this.power = { pulledAt: null };
        this.roundParticipants.clear();
        this.roundId++;
        this.finisherRoundUses = 0;
        this.finisherUses.clear();
        this.preparations.clear();
        this.momentCutscene = null;
        this.goldCutscenePlayed = false;
        this.lastTwoCutscenePlayed = false;
        this.roundPeakPlayers = this.playingPlayerCount();
        for (const player of this.players.values()) {
            if (player.phase !== 'playing') continue;
            if (player.accountName) this.roundParticipants.add(player.accountName);
            player.score = 0;
            player.kills = 0;
            player.deaths = 0;
            player.hasReviveArmor = false;
            player.reviveUsed = false;
            player.reviveTaken = false;
            player.hasFrc = false;
            player.hasEye = false;
            player.hasStealth = false;
            player.hasCreation = false;
            player.hasFlashlight = false;
            player.coachGift = false;
            player.ammoCapacity = AMMO.max;
            player.frcSelected = false;
            player.frcCooldownUntil = 0;
            player.stealthUntil = 0;
            player.stealthCooldownUntil = 0;
            player.creationNextAt = now + ITEM_RULES.creationRefillMs;
            // Everyone watching from the last round's blackout plays again.
            if (player.spectating || !player.alive) {
                player.spectating = false;
                player.alive = false;
                player.respawnAt = now; // the next tick respawns them at full health with a full load
            }
        }
        this.officeAt = now;
        this.items = new Map(ITEM_SPAWNS.map((spawn) => [spawn.id, {
            id: spawn.id,
            kind: spawn.kind,
            name: spawn.name,
            at: [...spawn.at] as Vec3Tuple,
            holder: null,
            // Mark holds the one-time creation power; there is no free-floating pickup until it is dropped.
            available: spawn.kind !== 'creation',
            returnAt: null,
            cooldownUntil: 0
        }]));
        this.markGiven = false;
        this.round = { phase: 'playing', endsAt: now + ROUND.roundSeconds * 1000 };
        const [x, z] = SPAWN_POINTS[Math.floor(this.random() * SPAWN_POINTS.length) % SPAWN_POINTS.length];
        this.gold = { holder: null, at: [x, 0.92, z] };
        this.goldDroppedAt = now;
        if (!announce) return; // the first arrival learns both from its welcome
        this.out.all({ type: 'round', round: this.round, scores: this.scores() });
        this.out.all({ type: 'power', power: this.power });
        this.out.all({ type: 'gold', gold: this.gold, event: 'spawned' });
        this.broadcastItems();
    }

    private advanceRound(now: number) {
        if (!this.round) return;
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
            ![ROUND.roundSeconds, ROUND.blackoutSecondsLeft, ROUND.finalSecondsLeft, ROUND.finalSecondsLeft + ROUND.ceremonySeconds].some(
                (seconds) => seconds * 1000 === remainingMs
            )
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
                points: name === winner?.accountName ? SKIN_POINTS.win : 0,
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
        if (
            player.phase !== 'playing' ||
            this.gold.holder ||
            !player.alive ||
            !player.pose ||
            this.round?.phase !== 'playing'
        )
            return;
        if (now - this.goldDroppedAt < ROUND.pickupDelay * 1000) return;
        const [x, y, z] = player.pose.p;
        const [gx, gy, gz] = this.gold.at;
        if (Math.hypot(x - gx, z - gz) > ROUND.pickupRadius || Math.abs(y - gy) > 1.6) return;
        this.gold = { holder: player.id, at: [x, y, z] };
        // Each hold starts a fresh burst count, as the client counts it (a count carried over from an earlier hold
        // made the room refuse throws the holder's HUD allowed).
        player.goldThrows = 0;
        player.goldCooldownUntil = 0;
        this.out.all({ type: 'gold', gold: this.gold, event: 'taken' });
        if (!this.goldCutscenePlayed && player.pose) {
            this.goldCutscenePlayed = true;
            this.startMomentCutscene('gold-first', now, player.pose.p);
        }
    }

    private startMomentCutscene(kind: MomentCutscene['kind'], now: number, focus: Vec3Tuple, secondary?: Vec3Tuple) {
        const cutscene: MomentCutscene = {
            id: `moment-${this.roundId}-${++this.momentCutsceneSequence}`,
            kind,
            at: now,
            focus: [...focus],
            ...(secondary ? { secondary: [...secondary] } : {})
        };
        this.momentCutscene = cutscene;
        this.out.all({ type: 'momentCutsceneStarted', cutscene });
    }

    private inMomentCutscene(now: number) {
        const cutscene = this.momentCutscene;
        return !!cutscene && now >= cutscene.at && now < cutscene.at + CUTSCENE_SECONDS[cutscene.kind] * 1000;
    }

    private skipMomentCutscene(id: string, realNow: number) {
        const active = this.momentCutscene;
        if (!active || active.id !== id || !this.inMomentCutscene(this.matchNow(realNow))) return;
        this.momentCutscene = null;
        this.out.all({ type: 'momentCutsceneEnded', id, skipped: true });
    }

    private playingPlayerCount() {
        return [...this.players.values()].filter((player) => player.phase === 'playing').length;
    }

    private dropGold(holder: Player, now: number) {
        // Resolve against collision-derived support anchors: raw player Y is not necessarily a floor, and a
        // fixed ground-floor Y makes drops on stands/stairs unclaimable. GoldState.at remains a capsule-centre anchor.
        const at = resolveGoldDrop(holder.pose).at;
        this.gold = { holder: null, at };
        this.goldDroppedAt = now;
        this.out.all({ type: 'gold', gold: this.gold, event: 'dropped' });
    }

    /** The thrower reports where its (ordinary) disc came to rest: it lies there for anyone to pick up. */
    private landed(player: Player, throwId: number, at: Vec3Tuple) {
        if (player.phase !== 'playing') return;
        const entry = player.throws.get(throwId);
        // Golden throws count too: the golden disc flies home, but leaves an ordinary disc where it came down.
        if (!entry || entry.landed) return;
        entry.landed = true;
        // A golden-disc throw only sometimes leaves a disc behind.
        if (entry.golden && this.random() >= ROUND.goldDropChance) return;
        // Plausibility: within reach of the launch, inside the campus, and laid on the floor.
        const reach = Math.hypot(...entry.record.v) * DISC_REST_SECONDS + 5;
        if (distance(entry.record.o, at) > reach || !inBounds({ p: at, yaw: 0, pitch: 0 })) return;
        this.discs.push({ id: ++this.discId, at: [at[0], Math.max(0.02, Math.min(at[1], 16)), at[2]] });
        this.out.all({ type: 'discs', discs: this.discs });
    }

    private pickupDiscs(player: Player) {
        if (player.phase !== 'playing' || !player.alive || !player.pose || player.ammo >= player.ammoCapacity) return;
        const [x, y, z] = player.pose.p;
        const taken = this.discs.filter(
            (disc) =>
                Math.hypot(disc.at[0] - x, disc.at[2] - z) <= AMMO.pickupRadius &&
                Math.abs(disc.at[1] - (y - 0.9)) < 1.6
        );
        if (!taken.length) return;
        const room = player.ammoCapacity - player.ammo;
        const picked = taken.slice(0, room);
        player.ammo += picked.length;
        this.discs = this.discs.filter((disc) => !picked.includes(disc));
        this.sendAmmo(player);
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

    private interact(player: Player, targetId: string, now: number) {
        if (player.phase !== 'playing' || !player.alive || player.spectating || !player.pose || this.executionFor(player.id)) return;
        const previous = this.interactionTimes.get(player.id) ?? -Infinity;
        if (now - previous < ITEM_RULES.interactionIntervalMs) return;
        this.interactionTimes.set(player.id, now);
        const [x, y, z] = player.pose.p;
        if (targetId === 'mark') {
            const mark = NPC_SPAWNS.find((npc) => npc.id === 'mark')!;
            if (Math.hypot(x - mark.at[0], z - mark.at[2]) > ITEM_RULES.pickupRadius || Math.abs(y - mark.at[1]) > 1.6) return;
            if (this.markGiven || player.hasCreation) {
                this.out.to(player.id, { type: 'interactionDenied', reason: 'Mark：创造之力已经交给别人了' });
                return;
            }
            const item = this.items.get('item-creation');
            if (!item) return;
            this.dropHeldItems(player, now);
            this.markGiven = true;
            item.available = false;
            item.holder = player.id;
            item.at = [x, Math.max(0.02, y - 0.9), z];
            player.hasCreation = true;
            player.creationNextAt = now + ITEM_RULES.creationRefillMs;
            this.broadcastItems();
            this.broadcastAbility(player, item);
            this.system(`${player.name} 获得创造之力`, now);
            return;
        }
        if (targetId === 'coach-michael') {
            const coach = NPC_SPAWNS.find((npc) => npc.id === targetId)!;
            if (player.coachGift || Math.hypot(x - coach.at[0], z - coach.at[2]) > ITEM_RULES.pickupRadius || Math.abs(y - coach.at[1]) > 1.6) return;
            player.coachGift = true;
            player.ammoCapacity = 5;
            player.ammo = Math.min(5, player.ammo + 2);
            this.sendAmmo(player);
            this.broadcastAbility(player);
            this.system(`${player.name} 获得飞盘天赋：携带上限提升至 5`, now);
            return;
        }
        const item = this.items.get(targetId);
        if (!item || !item.available || Math.hypot(x - item.at[0], z - item.at[2]) > ITEM_RULES.pickupRadius || Math.abs(y - item.at[1]) > 1.8) return;
        if (item.kind === 'revive' && (player.hasReviveArmor || player.reviveTaken)) return;
        if ((item.kind === 'frc' && player.hasFrc) || (item.kind === 'eye' && player.hasEye) ||
            (item.kind === 'stealth' && player.hasStealth) || (item.kind === 'creation' && player.hasCreation) ||
            (item.kind === 'flashlight' && player.hasFlashlight)) return;
        this.dropHeldItems(player, now);
        item.holder = player.id;
        item.available = false;
        item.returnAt = null;
        item.at = [x, Math.max(0.02, y - 0.9), z];
        if (item.kind === 'revive') {
            player.hasReviveArmor = true;
            player.reviveTaken = true;
        }
        if (item.kind === 'frc') {
            player.hasFrc = true;
            player.frcCooldownUntil = Math.max(player.frcCooldownUntil, item.cooldownUntil);
        }
        if (item.kind === 'eye') player.hasEye = true;
        if (item.kind === 'stealth') player.hasStealth = true;
        if (item.kind === 'creation') player.hasCreation = true;
        if (item.kind === 'flashlight') player.hasFlashlight = true;
        player.creationNextAt = now + ITEM_RULES.creationRefillMs;
        this.broadcastItems();
        this.broadcastAbility(player, item);
        this.system(`${player.name} 拾取了${item.name}`, now);
    }

    private toggleFrc(player: Player, now: number) {
        const previous = this.interactionTimes.get(player.id) ?? -Infinity;
        if (now - previous < ITEM_RULES.interactionIntervalMs) return;
        this.interactionTimes.set(player.id, now);
        if (player.phase !== 'playing' || !player.alive || !player.hasFrc || now < player.frcCooldownUntil) return;
        player.frcSelected = !player.frcSelected;
        this.broadcastAbility(player);
    }

    private activateStealth(player: Player, now: number) {
        const previous = this.interactionTimes.get(player.id) ?? -Infinity;
        if (now - previous < ITEM_RULES.interactionIntervalMs) return;
        this.interactionTimes.set(player.id, now);
        if (player.phase !== 'playing' || !player.alive || !player.hasStealth || now < player.stealthCooldownUntil || this.executionFor(player.id)) {
            // Refused: resend the true cooldown so the presser's HUD matches the room.
            if (player.hasStealth) this.out.to(player.id, { type: 'ability', id: player.id, player: summary(player), item: null });
            return;
        }
        player.stealthUntil = now + ITEM_RULES.stealthDurationMs;
        player.stealthCooldownUntil = now + ITEM_RULES.stealthCooldownMs;
        this.broadcastAbility(player);
    }

    private dropHeldItems(player: Player, now: number) {
        for (const item of this.items.values()) {
            if (item.holder !== player.id) continue;
            item.holder = null;
            item.available = true;
            item.at = player.pose ? [player.pose.p[0], 0.02, player.pose.p[2]] : item.at;
            item.returnAt = now + ITEM_RULES.droppedReturnMs;
            if (item.kind === 'revive') player.hasReviveArmor = false;
            if (item.kind === 'frc') {
                item.cooldownUntil = Math.max(item.cooldownUntil, player.frcCooldownUntil);
                player.hasFrc = false;
            }
            if (item.kind === 'eye') player.hasEye = false;
            if (item.kind === 'stealth') player.hasStealth = false;
            if (item.kind === 'creation') player.hasCreation = false;
            if (item.kind === 'flashlight') player.hasFlashlight = false;
        }
        player.frcSelected = false;
        player.frcCooldownUntil = 0;
        player.stealthUntil = 0;
        this.broadcastItems();
        this.broadcastAbility(player);
    }

    private broadcastItems() {
        this.out.all({ type: 'items', items: [...this.items.values()] });
    }

    /** The player's disc count, with 创造之力's next refill time so their countdown stays true. */
    private sendAmmo(player: Player) {
        this.out.to(player.id, {
            type: 'ammo',
            ammo: player.ammo,
            ...(player.hasCreation ? { creationNextAt: player.creationNextAt } : {})
        });
    }

    private broadcastAbility(player: Player, item: WorldItem | null = null) {
        this.out.all({ type: 'ability', id: player.id, player: summary(player), item });
    }

    /** A player threw inside 纪老师's view (checked on the client against walls); the room checks he is near. */
    private caught(player: Player, now: number) {
        if (player.phase !== 'playing' || !player.alive || player.spectating) return;
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
                score: POINTS.hit + (out ? POINTS.elimination : 0),
                points: out ? SKIN_POINTS.kill : 0
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
        // Dead channel: while the round plays, the eliminated cannot tell the living where anyone is.
        if (this.round?.phase === 'playing' && player.spectating) {
            const line: ChatLine = {
                id: ++this.chatId,
                t: now,
                name: player.name,
                colour: player.colour,
                text,
                dead: true
            };
            for (const other of this.players.values())
                if (other.spectating) this.out.to(other.id, { type: 'chat', line });
            return;
        }
        this.pushChat({ id: ++this.chatId, t: now, name: player.name, colour: player.colour, text });
    }

    /**
     * Final-minute stands: only players out for the round may cheer, at most once per EMOTE_INTERVAL. Everyone
     * receives it (the living see and hear the crowd); it carries no gameplay effect.
     */
    private emote(player: Player, kind: 'cheer' | 'stick' | 'confetti', now: number) {
        if (!player.spectating || this.round?.phase !== 'playing') return;
        if (now < this.round.endsAt - ROUND.finalSecondsLeft * 1000) return;
        if (now - player.lastEmoteAt < EMOTE_INTERVAL) return;
        player.lastEmoteAt = now;
        this.out.all({ type: 'emote', id: player.id, kind });
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
    phase,
    accountName,
    colour,
    alive,
    spectating,
    respawnAt,
    hp,
    score,
    kills,
    deaths,
    avatarId,
    avatarVersion,
    hasReviveArmor,
    reviveTaken,
    hasFrc,
    hasEye,
    hasStealth,
    hasCreation,
    hasFlashlight,
    coachGift,
    ammoCapacity,
    stealthUntil,
    stealthCooldownUntil,
    frcSelected,
    frcCooldownUntil,
    creationNextAt,
    skin,
    skinCounter,
    skinKills
}: Player): PlayerSummary => ({
    id,
    name,
    phase,
    account: accountName !== null,
    colour,
    alive,
    spectating,
    respawnAt,
    hp,
    score,
    kills,
    deaths,
    avatarId,
    avatarVersion,
    hasReviveArmor,
    reviveTaken,
    hasFrc,
    hasEye,
    hasStealth,
    hasCreation,
    hasFlashlight,
    coachGift,
    ammoCapacity,
    stealthUntil,
    stealthCooldownUntil,
    frcSelected,
    frcCooldownUntil,
    creationNextAt,
    skin,
    skinCounter,
    skinKills
});
