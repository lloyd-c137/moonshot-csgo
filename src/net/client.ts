// Browser side of the shared-world connection: one WebSocket to the room, typed events, pose interpolation.
// Without a configured or reachable server the game stays fully playable offline (frisbee practice).
import type { Execution } from '../gameplay/execution';
import type { GlobalFinisher } from '../gameplay/finisher/FinisherTypes';

import { PoseBuffer, RENDER_DELAY, ServerClock } from './interpolation';
import type {
    AccountStats,
    ChatLine,
    GoldState,
    GroundDisc,
    King,
    PlayerPose,
    PlayerSummary,
    PowerState,
    RoundState,
    Scores,
    ServerMessage,
    ThrowRecord,
    Vec3Tuple
} from './protocol';
import { POSE_HZ, PROTOCOL_VERSION } from './protocol';

export type NetState = 'offline' | 'connecting' | 'online' | 'rejected';

type Handlers = {
    state: (state: NetState, detail?: string) => void;
    welcome: (
        me: PlayerSummary,
        players: PlayerSummary[],
        extra: {
            account: AccountStats | null;
            king: King | null;
            chat: ChatLine[];
            round: RoundState;
            power: PowerState;
            executions: Execution[];
            globalFinisher: GlobalFinisher | null;
            gold: GoldState;
            ammo: number;
            discs: GroundDisc[];
            matchTime: number;
        }
    ) => void;
    joined: (player: PlayerSummary) => void;
    left: (id: string) => void;
    /** `ageMs`: how long ago (server clock) the throw happened, for latency compensation. */
    thrown: (from: string, record: ThrowRecord, ageMs: number) => void;
    struck: (
        throwId: number | undefined,
        target: string,
        by: string,
        hp: number,
        out: boolean,
        head: boolean,
        at: Vec3Tuple,
        scores: Scores,
        sniper: boolean,
        gold: boolean,
        final: boolean,
        execution: boolean
    ) => void;
    hitRejected: (throwId: number) => void;
    chat: (line: ChatLine) => void;
    king: (king: King, isNew: boolean) => void;
    account: (account: AccountStats) => void;
    profileUpdated: (playerId: string, avatarId: string | null, avatarVersion: string | null) => void;
    healed: (id: string, hp: number) => void;
    respawn: (id: string, spawn: number) => void;
    gold: (gold: GoldState, event: 'spawned' | 'taken' | 'dropped') => void;
    round: (round: RoundState, scores: Scores) => void;
    power: (power: PowerState) => void;
    executionStarted: (execution: Execution) => void;
    executionEnded: (id: string, completed: boolean, reason: string) => void;
    executionDenied: (reason: string) => void;
    executionPrepared: (requestId: string, intentId: string) => void;
    executionPrepareDenied: (requestId: string, reason: string) => void;
    globalFinisherStarted: (finisher: GlobalFinisher) => void;
    globalFinisherState: (finisher: GlobalFinisher) => void;
    globalFinisherCompleted: (id: string, resumedAt: number) => void;
    globalFinisherCancelled: (id: string, reason: string, resumedAt: number) => void;
    caught: (id: string) => void;
    ammo: (ammo: number) => void;
    discs: (discs: GroundDisc[], added?: { id: number; office: boolean }) => void;
    /** Round-trip time to the room (ms), smoothed; null when not connected. */
    latency: (ms: number | null) => void;
};

export const createNetClient = (url: string | null, handlers: Handlers) => {
    let socket: WebSocket | null = null;
    let state: NetState = 'offline';
    let me: string | null = null;
    let retry = 0;
    let wantName = '';
    let wantToken: string | null = null;
    let lastPoseAt = 0;
    const history = new Map<string, PoseBuffer>();
    const clock = new ServerClock();
    let latency: number | null = null;
    let simulatedRtt = 0;
    // Latency probe every 2 s while connected.
    window.setInterval(() => {
        if (state === 'online') send({ type: 'ping', c: Math.round(performance.now() * 10) / 10 });
    }, 2000);

    const setState = (next: NetState, detail?: string) => {
        state = next;
        handlers.state(next, detail);
    };
    const send = (message: object) => {
        const current = socket;
        if (current?.readyState !== WebSocket.OPEN) return;
        const payload = JSON.stringify(message);
        const delay = state === 'online' ? simulatedRtt / 2 : 0;
        if (!delay) {
            current.send(payload);
            return;
        }
        window.setTimeout(() => {
            if (socket === current && current.readyState === WebSocket.OPEN) current.send(payload);
        }, delay);
    };

    const onMessage = (message: ServerMessage) => {
        switch (message.type) {
            case 'welcome': {
                me = message.id;
                retry = 0;
                clock.observe(message.t, performance.now());
                setState('online');
                send({ type: 'ping', c: performance.now() });
                const self = message.players.find((player) => player.id === message.id)!;
                handlers.welcome(self, message.players, {
                    account: message.account,
                    king: message.king,
                    chat: message.chat,
                    round: message.round,
                    power: message.power,
                    executions: message.executions,
                    globalFinisher: message.globalFinisher,
                    gold: message.gold,
                    ammo: message.ammo,
                    discs: message.discs,
                    matchTime: message.matchTime
                });
                break;
            }
            case 'rejected':
                setState('rejected', message.reason);
                socket?.close();
                break;
            case 'joined':
                handlers.joined(message.player);
                break;
            case 'left':
                history.delete(message.id);
                handlers.left(message.id);
                break;
            case 'snapshot': {
                clock.observe(message.t, performance.now());
                for (const [id, pose] of Object.entries(message.poses)) {
                    if (id === me) continue;
                    let buffer = history.get(id);
                    if (!buffer) history.set(id, (buffer = new PoseBuffer()));
                    // A room still running the previous version sends no receive stamp: fall back to the snapshot time.
                    buffer.push(Number.isFinite(pose.t) ? pose.t : message.t, pose);
                }
                for (const id of history.keys()) if (!(id in message.poses)) history.delete(id);
                break;
            }
            case 'thrown':
                handlers.thrown(
                    message.from,
                    message.throw,
                    Number.isFinite(message.t)
                        ? Math.max(0, Math.min(250, (clock.toServer(performance.now()) ?? message.t) - message.t))
                        : 0
                );
                break;
            case 'struck':
                if (message.out) history.delete(message.target);
                handlers.struck(
                    message.throwId,
                    message.target,
                    message.by,
                    message.hp,
                    message.out,
                    message.head,
                    message.at,
                    message.scores,
                    message.sniper === true,
                    message.gold === true,
                    message.final === true,
                    message.execution === true
                );
                break;
            case 'hitRejected':
                handlers.hitRejected(message.throwId);
                break;
            case 'chat':
                handlers.chat(message.line);
                break;
            case 'king':
                handlers.king(message.king, message.isNew);
                break;
            case 'account':
                handlers.account(message.account);
                break;
            case 'profileUpdated':
                handlers.profileUpdated(message.playerId, message.avatarId, message.avatarVersion);
                break;
            case 'healed':
                handlers.healed(message.id, message.hp);
                break;
            case 'gold':
                handlers.gold(message.gold, message.event);
                break;
            case 'round':
                handlers.round(message.round, message.scores);
                break;
            case 'caught':
                handlers.caught(message.id);
                break;
            case 'ammo':
                handlers.ammo(message.ammo);
                break;
            case 'discs':
                handlers.discs(message.discs, message.added);
                break;
            case 'pong': {
                const rtt = performance.now() - message.c;
                latency = latency === null ? rtt : latency + (rtt - latency) * 0.3;
                handlers.latency(Math.round(latency));
                break;
            }
            case 'power':
                handlers.power(message.power);
                break;
            case 'executionStarted':
                handlers.executionStarted(message.execution);
                break;
            case 'executionEnded':
                handlers.executionEnded(message.id, message.completed, message.reason);
                break;
            case 'executionDenied':
                handlers.executionDenied(message.reason);
                break;
            case 'executionPrepared':
                handlers.executionPrepared(message.requestId, message.intentId);
                break;
            case 'executionPrepareDenied':
                handlers.executionPrepareDenied(message.requestId, message.reason);
                break;
            case 'globalFinisherStarted':
                handlers.globalFinisherStarted(message.finisher);
                break;
            case 'globalFinisherState':
                handlers.globalFinisherState(message.finisher);
                break;
            case 'globalFinisherCompleted':
                handlers.globalFinisherCompleted(message.id, message.resumedAt);
                break;
            case 'globalFinisherCancelled':
                handlers.globalFinisherCancelled(message.id, message.reason, message.resumedAt);
                break;
            case 'respawn':
                handlers.respawn(message.id, message.spawn);
                break;
        }
    };

    const open = () => {
        if (!url) return setState('offline');
        setState('connecting');
        try {
            socket = new WebSocket(url);
        } catch {
            return setState('offline', 'unreachable');
        }
        const current = socket;
        current.addEventListener('open', () =>
            current.send(
                JSON.stringify({
                    type: 'hello',
                    version: PROTOCOL_VERSION,
                    name: wantName,
                    ...(wantToken ? { token: wantToken } : {})
                })
            )
        );
        current.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(String(event.data)) as ServerMessage;
                const delay = state === 'online' ? simulatedRtt / 2 : 0;
                if (!delay) onMessage(message);
                else
                    window.setTimeout(() => {
                        if (socket === current && state === 'online') onMessage(message);
                    }, delay);
            } catch {
                /* ignore malformed */
            }
        });
        current.addEventListener('close', () => {
            if (socket !== current) return;
            socket = null;
            me = null;
            history.clear();
            latency = null;
            handlers.latency(null);
            if (state === 'rejected') return;
            setState('offline', 'disconnected');
            // Reconnect with backoff (1, 2, 4 … 30 s).
            const delay = Math.min(30_000, 1000 * 2 ** retry++);
            window.setTimeout(open, delay);
        });
    };

    return {
        get state() {
            return state;
        },
        get id() {
            return me;
        },
        /** Dev-only callers can use this to add an equal one-way delay to sends and receives. */
        setSimulatedRtt(milliseconds: number) {
            if (!import.meta.env.DEV) return;
            simulatedRtt = Math.max(0, Math.min(400, Math.round(milliseconds / 20) * 20));
        },
        get simulatedRtt() {
            return simulatedRtt;
        },
        connect(name: string, token: string | null = null) {
            wantName = name;
            wantToken = token;
            if (!socket && state !== 'online') open();
        },
        /** Re-joins with a new identity (after signing in or out). */
        rejoin(name: string, token: string | null) {
            wantName = name;
            wantToken = token;
            if (socket) socket.close();
            else open();
        },
        chat(text: string) {
            send({ type: 'chat', text });
        },
        /** Sends the local pose at most POSE_HZ times a second. */
        /** `teleport`: the game moved the player itself (recovery, return, relocation), not walking. */
        pose(pose: PlayerPose, force = false, teleport = false) {
            const now = performance.now();
            const interval = 1000 / POSE_HZ;
            if (!force && now - lastPoseAt < interval) return;
            // Keep an even cadence (frames rarely land exactly on the interval) without bursting after a stall.
            lastPoseAt = now - lastPoseAt < interval * 2 ? lastPoseAt + interval : now;
            send(
                teleport
                    ? { type: 'pose', pose, ct: Math.round(now), tp: true }
                    : { type: 'pose', pose, ct: Math.round(now) }
            );
        },
        respawned(pose: PlayerPose) {
            send({ type: 'respawned', pose });
        },
        throw(record: ThrowRecord) {
            send({ type: 'throw', throw: record });
        },
        /** Claims a hit; the room judges it where the target was drawn on this screen (server clock − render delay). */
        hit(throwId: number, target: string, at: Vec3Tuple, path: Vec3Tuple[] = []) {
            const serverNow = clock.toServer(performance.now());
            send({
                type: 'hit',
                throwId,
                target,
                at,
                ...(serverNow === null ? {} : { rt: Math.round(serverNow - RENDER_DELAY) }),
                ...(path.length ? { path: path.slice(0, 8) } : {})
            });
        },
        /** Reports where this player's thrown disc came to rest. */
        landed(throwId: number, at: Vec3Tuple) {
            send({ type: 'landed', throwId, at });
        },
        /** Tells the room 纪老师 caught this player throwing. */
        caught() {
            send({ type: 'caught' });
        },
        /** Tells the room the night guard's flashlight found this player. */
        spotted() {
            send({ type: 'spotted' });
        },
        pullBreaker() {
            send({ type: 'pullBreaker' });
        },
        prepareExecution(target: string) {
            const requestId = crypto.randomUUID();
            send({ type: 'executionPrepare', requestId, target });
            return requestId;
        },
        commitExecution(requestId: string) {
            send({ type: 'executionCommit', requestId });
        },
        cancelExecution(requestId: string) {
            send({ type: 'executionCancel', requestId });
        },
        /** Estimated room clock (ms), or null before the first message. */
        serverNow() {
            return clock.toServer(performance.now());
        },
        /** Interpolated remote poses for drawing, keyed by player id (call once per frame). */
        poses(): Map<string, PlayerPose> {
            const out = new Map<string, PlayerPose>();
            const serverNow = clock.toServer(performance.now());
            if (serverNow === null) return out;
            for (const [id, buffer] of history) {
                const pose = buffer.sample(serverNow - RENDER_DELAY);
                if (pose) out.set(id, pose);
            }
            return out;
        }
    };
};

export type NetClient = ReturnType<typeof createNetClient>;
