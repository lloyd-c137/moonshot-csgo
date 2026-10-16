// Browser side of the shared-world connection: one WebSocket to the room, typed events, pose interpolation.
// Without a configured or reachable server the game stays fully playable offline (frisbee practice).
import { PoseBuffer, RENDER_DELAY, ServerClock } from './interpolation';
import type {
    AccountStats,
    ChatLine,
    GoldState,
    GroundDisc,
    King,
    PlayerPose,
    PlayerSummary,
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
            gold: GoldState;
            ammo: number;
            discs: GroundDisc[];
        }
    ) => void;
    joined: (player: PlayerSummary) => void;
    left: (id: string) => void;
    /** `ageMs`: how long ago (server clock) the throw happened, for latency compensation. */
    thrown: (from: string, record: ThrowRecord, ageMs: number) => void;
    struck: (
        target: string,
        by: string,
        hp: number,
        out: boolean,
        head: boolean,
        at: Vec3Tuple,
        scores: Scores,
        sniper: boolean,
        gold: boolean
    ) => void;
    chat: (line: ChatLine) => void;
    king: (king: King, isNew: boolean) => void;
    account: (account: AccountStats) => void;
    healed: (id: string, hp: number) => void;
    respawn: (id: string, spawn: number) => void;
    gold: (gold: GoldState, event: 'spawned' | 'taken' | 'dropped') => void;
    round: (round: RoundState, scores: Scores) => void;
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
    // Latency probe every 2 s while connected.
    window.setInterval(() => {
        if (state === 'online') send({ type: 'ping', c: Math.round(performance.now() * 10) / 10 });
    }, 2000);

    const setState = (next: NetState, detail?: string) => {
        state = next;
        handlers.state(next, detail);
    };
    const send = (message: object) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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
                    gold: message.gold,
                    ammo: message.ammo,
                    discs: message.discs
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
                    message.target,
                    message.by,
                    message.hp,
                    message.out,
                    message.head,
                    message.at,
                    message.scores,
                    message.sniper === true,
                    message.gold === true
                );
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
                onMessage(JSON.parse(String(event.data)) as ServerMessage);
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
        pose(pose: PlayerPose, force = false) {
            const now = performance.now();
            const interval = 1000 / POSE_HZ;
            if (!force && now - lastPoseAt < interval) return;
            // Keep an even cadence (frames rarely land exactly on the interval) without bursting after a stall.
            lastPoseAt = now - lastPoseAt < interval * 2 ? lastPoseAt + interval : now;
            send({ type: 'pose', pose, ct: Math.round(now) });
        },
        respawned(pose: PlayerPose) {
            send({ type: 'respawned', pose });
        },
        throw(record: ThrowRecord) {
            send({ type: 'throw', throw: record });
        },
        hit(throwId: number, target: string, at: Vec3Tuple) {
            send({ type: 'hit', throwId, target, at });
        },
        /** Reports where this player's thrown disc came to rest. */
        landed(throwId: number, at: Vec3Tuple) {
            send({ type: 'landed', throwId, at });
        },
        /** Tells the room 纪老师 caught this player throwing. */
        caught() {
            send({ type: 'caught' });
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
