// Browser side of the shared-world connection: one WebSocket to the room, typed events, pose interpolation.
// Without a configured or reachable server the game stays fully playable offline (frisbee practice).
import type { PlayerPose, PlayerSummary, Scores, ServerMessage, ThrowRecord, Vec3Tuple } from './protocol';
import { POSE_HZ, PROTOCOL_VERSION } from './protocol';

export type NetState = 'offline' | 'connecting' | 'online' | 'rejected';

type Handlers = {
    state: (state: NetState, detail?: string) => void;
    welcome: (me: PlayerSummary, players: PlayerSummary[]) => void;
    joined: (player: PlayerSummary) => void;
    left: (id: string) => void;
    thrown: (from: string, record: ThrowRecord) => void;
    struck: (target: string, by: string, hp: number, out: boolean, at: Vec3Tuple, scores: Scores) => void;
    healed: (id: string, hp: number) => void;
    respawn: (id: string, spawn: number) => void;
};

type Sample = { at: number; pose: PlayerPose };
/** Remote poses are drawn this far in the past so there are always two samples to blend between. */
const INTERPOLATION_DELAY = 140;

export const createNetClient = (url: string | null, handlers: Handlers) => {
    let socket: WebSocket | null = null;
    let state: NetState = 'offline';
    let me: string | null = null;
    let retry = 0;
    let wantName = '';
    let lastPoseAt = 0;
    const history = new Map<string, Sample[]>();

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
                setState('online');
                const self = message.players.find((player) => player.id === message.id)!;
                handlers.welcome(self, message.players);
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
                const now = performance.now();
                for (const [id, pose] of Object.entries(message.poses)) {
                    if (id === me) continue;
                    const samples = history.get(id) ?? [];
                    samples.push({ at: now, pose });
                    while (samples.length > 8) samples.shift();
                    history.set(id, samples);
                }
                for (const id of history.keys()) if (!(id in message.poses)) history.delete(id);
                break;
            }
            case 'thrown':
                handlers.thrown(message.from, message.throw);
                break;
            case 'struck':
                if (message.out) history.delete(message.target);
                handlers.struck(message.target, message.by, message.hp, message.out, message.at, message.scores);
                break;
            case 'healed':
                handlers.healed(message.id, message.hp);
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
            current.send(JSON.stringify({ type: 'hello', version: PROTOCOL_VERSION, name: wantName }))
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
        connect(name: string) {
            wantName = name;
            if (!socket && state !== 'online') open();
        },
        /** Sends the local pose at most POSE_HZ times a second. */
        pose(pose: PlayerPose, force = false) {
            const now = performance.now();
            if (!force && now - lastPoseAt < 1000 / POSE_HZ) return;
            lastPoseAt = now;
            send({ type: 'pose', pose });
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
        /** Interpolated remote poses for drawing, keyed by player id. */
        poses(): Map<string, PlayerPose> {
            const renderAt = performance.now() - INTERPOLATION_DELAY;
            const out = new Map<string, PlayerPose>();
            for (const [id, samples] of history) {
                if (!samples.length) continue;
                let i = samples.length - 1;
                while (i > 0 && samples[i - 1].at > renderAt) i--;
                const b = samples[i];
                const a = samples[Math.max(0, i - 1)];
                const span = b.at - a.at;
                const t = span > 0 ? Math.min(1, Math.max(0, (renderAt - a.at) / span)) : 1;
                const lerp = (x: number, y: number) => x + (y - x) * t;
                let dyaw = b.pose.yaw - a.pose.yaw;
                dyaw -= Math.round(dyaw / 360) * 360;
                out.set(id, {
                    p: [lerp(a.pose.p[0], b.pose.p[0]), lerp(a.pose.p[1], b.pose.p[1]), lerp(a.pose.p[2], b.pose.p[2])],
                    yaw: a.pose.yaw + dyaw * t,
                    pitch: lerp(a.pose.pitch, b.pose.pitch)
                });
            }
            return out;
        }
    };
};

export type NetClient = ReturnType<typeof createNetClient>;
