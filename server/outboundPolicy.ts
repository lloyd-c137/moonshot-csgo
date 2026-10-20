import type { ServerMessage, StampedPose } from '../src/net/protocol.ts';
import { diffPoses, poseChangeCount } from '../src/net/snapshotDelta.ts';

export const OUTBOUND_LIMITS = { recoveryBytes: 64 * 1024, pauseSnapshotBytes: 256 * 1024, slowBytes: 512 * 1024, slowMs: 2000 } as const;
export const SNAPSHOT_WINDOW = { min: 3, max: 12, defaultRttMs: 50, tickHz: 20 } as const;
const REPLACEABLE = new Set(['snapshot']);
const CRITICAL = new Set([
    'welcome', 'rejected', 'joined', 'left', 'struck', 'revived', 'respawn', 'round', 'account',
    'gold', 'power', 'items', 'ability', 'ammo', 'discs', 'executionStarted', 'executionEnded',
    'globalFinisherStarted', 'globalFinisherState', 'globalFinisherCompleted', 'globalFinisherCancelled'
]);

export const isCriticalServerMessage = (message: ServerMessage) => CRITICAL.has(message.type);

/** Checks socket pressure before enqueueing; skipped poses are replaced by the next authoritative snapshot. */
export class OutboundPolicy {
    private readonly slowSince = new Map<string, number>();
    coalescedSnapshots = 0;
    slowConnections = 0;

    decide(id: string, message: ServerMessage, bufferedBytes: number, now: number): 'send' | 'coalesce' | 'close' {
        if (bufferedBytes <= OUTBOUND_LIMITS.recoveryBytes) this.slowSince.delete(id);
        if (bufferedBytes > OUTBOUND_LIMITS.slowBytes) {
            const since = this.slowSince.get(id) ?? now;
            this.slowSince.set(id, since);
            if (now - since >= OUTBOUND_LIMITS.slowMs) {
                this.slowSince.delete(id);
                this.slowConnections++;
                return 'close';
            }
        }
        if (REPLACEABLE.has(message.type) && bufferedBytes > OUTBOUND_LIMITS.pauseSnapshotBytes) {
            this.coalescedSnapshots++;
            return 'coalesce';
        }
        return 'send';
    }

    forget(id: string) { this.slowSince.delete(id); }
}

type InFlight = { sentAt: number };
type AckState = {
    enabled: boolean;
    epoch: number;
    sent: number;
    acked: number;
    rttMs: number;
    inFlight: Map<number, InFlight>;
    prepared: number | null;
};

/**
 * Bounded application-level delivery window for runtimes without a writable-buffer API.
 * ACKs are cumulative because WebSocket messages on a connection are ordered. The RTT estimate
 * controls a hard-bounded BDP window; it never expands without limit.
 */
export class SnapshotAcks {
    private readonly states = new Map<string, AckState>();
    private readonly hardMax: number;
    coalesced = 0;
    slow = 0;
    maxInFlightObserved = 0;

    constructor(hardMax = SNAPSHOT_WINDOW.max) {
        this.hardMax = Math.max(1, Math.min(SNAPSHOT_WINDOW.max, Math.floor(hardMax)));
    }

    register(id: string, enabled: boolean, epoch = 0) {
        this.states.set(id, { enabled, epoch, sent: 0, acked: 0, rttMs: SNAPSHOT_WINDOW.defaultRttMs, inFlight: new Map(), prepared: null });
    }

    acknowledge(id: string, seq: number, now: number, epoch?: number) {
        const state = this.states.get(id);
        if (!state?.enabled || state.prepared !== null || (epoch !== undefined && epoch !== state.epoch) || seq > state.sent || seq <= state.acked) return false;
        const acknowledged = state.inFlight.get(seq);
        if (!acknowledged) return false;
        const sample = Math.max(1, now - acknowledged.sentAt);
        state.rttMs = state.rttMs * 0.8 + sample * 0.2;
        for (const sentSeq of state.inFlight.keys()) if (sentSeq <= seq) state.inFlight.delete(sentSeq);
        state.acked = seq;
        return true;
    }

    /** Resets sequencing after a client asks for a new protocol baseline. */
    resync(id: string, epoch: number) {
        const state = this.states.get(id);
        if (!state) return false;
        state.epoch = epoch;
        state.sent = 0;
        state.acked = 0;
        state.inFlight.clear();
        state.prepared = null;
        return true;
    }

    next(id: string, now: number): { type: 'send'; seq: number; epoch: number } | { type: 'coalesce' } | { type: 'close' } {
        let state = this.states.get(id);
        if (!state) {
            this.register(id, false);
            state = this.states.get(id)!;
        }
        if (state.prepared !== null) {
            this.coalesced++;
            return { type: 'coalesce' };
        }
        if (state.enabled) {
            const oldest = state.inFlight.values().next().value as InFlight | undefined;
            if (oldest && now - oldest.sentAt >= OUTBOUND_LIMITS.slowMs) {
                this.states.delete(id);
                this.slow++;
                return { type: 'close' };
            }
            const window = Math.min(this.hardMax, SNAPSHOT_WINDOW.max, Math.max(SNAPSHOT_WINDOW.min,
                Math.ceil(state.rttMs * SNAPSHOT_WINDOW.tickHz / 1000) + 2));
            if (state.inFlight.size >= window) {
                this.coalesced++;
                return { type: 'coalesce' };
            }
        }
        state.prepared = state.sent + 1;
        return { type: 'send', seq: state.prepared, epoch: state.epoch };
    }

    /** Commit only after the runtime accepted socket.send(), so skipped/failed frames never consume a sequence. */
    commit(id: string, seq: number, now: number) {
        const state = this.states.get(id);
        if (!state || state.prepared !== seq) return false;
        state.prepared = null;
        state.sent = seq;
        if (state.enabled) {
            state.inFlight.set(seq, { sentAt: now });
            this.maxInFlightObserved = Math.max(this.maxInFlightObserved, state.inFlight.size);
        }
        return true;
    }

    abort(id: string, seq: number) {
        const state = this.states.get(id);
        if (!state || state.prepared !== seq) return false;
        state.prepared = null;
        return true;
    }

    windowSize(id: string) {
        const state = this.states.get(id);
        if (!state?.enabled) return 0;
        return Math.min(this.hardMax, SNAPSHOT_WINDOW.max, Math.max(SNAPSHOT_WINDOW.min,
            Math.ceil(state.rttMs * SNAPSHOT_WINDOW.tickHz / 1000) + 2));
    }

    inFlightCount(id: string) { return this.states.get(id)?.inFlight.size ?? 0; }
    rttEstimate(id: string) { return this.states.get(id)?.rttMs ?? null; }
    epoch(id: string) { return this.states.get(id)?.epoch ?? null; }
    forget(id: string) { this.states.delete(id); }
}

type PoseSet = { poses: Record<string, StampedPose>; fans: Record<string, StampedPose> };
type PublisherState = {
    epoch: number;
    enabled: boolean;
    sentSeq: number;
    sentBase: PoseSet | null;
    prepared: { seq: number; poses: PoseSet; full: boolean } | null;
    fullSeq: number | null;
    nextFullAt: number;
};

/** Per-recipient encoder. Delta bases advance on successful enqueue, never on ACK, preserving ordered frames. */
export class SnapshotDeltaPublisher {
    private readonly states = new Map<string, PublisherState>();
    private epoch = 0;
    private static readonly FULL_INTERVAL_MS = 10_000;

    register(id: string, enabled: boolean) {
        const epoch = ++this.epoch;
        this.states.set(id, { epoch, enabled, sentSeq: 0, sentBase: null, prepared: null, fullSeq: null, nextFullAt: 0 });
        return epoch;
    }

    encode(id: string, snapshot: Extract<ServerMessage, { type: 'snapshot' }>, seq: number, now: number, encoding: 'auto' | 'delta' = 'auto'): ServerMessage {
        const state = this.states.get(id);
        if (!state || !state.enabled) return { ...snapshot, seq };
        const current = { poses: snapshot.poses, fans: snapshot.fans ?? {} };
        const fullDue = !state.sentBase || (state.fullSeq === null && now >= state.nextFullAt);
        const full = () => ({
            type: 'snapshotFull' as const, epoch: state.epoch, seq, t: snapshot.t,
            poses: current.poses, ...(Object.keys(current.fans).length ? { fans: current.fans } : {})
        });
        if (fullDue) {
            state.prepared = { seq, poses: current, full: true };
            return full();
        }
        const base = state.sentBase!;
        const total = Object.keys(current.poses).length + Object.keys(current.fans).length +
            Object.keys(base.poses).length + Object.keys(base.fans).length;
        const threshold = Math.max(1, Math.ceil(total * 0.25));
        if (encoding === 'auto') {
            const changed = poseChangeCount(base.poses, current.poses, threshold + 1) +
                poseChangeCount(base.fans, current.fans, threshold + 1);
            if (changed > threshold) {
                state.prepared = { seq, poses: current, full: true };
                return full();
            }
        }
        const poseDelta = diffPoses(base.poses, current.poses);
        const fanDelta = diffPoses(base.fans, current.fans);
        state.prepared = { seq, poses: current, full: false };
        return {
            type: 'snapshotDelta', epoch: state.epoch, seq, baseSeq: state.sentSeq, t: snapshot.t,
            updates: poseDelta.updates, removed: poseDelta.removed,
            ...(Object.keys(fanDelta.updates).length ? { fanUpdates: fanDelta.updates } : {}),
            ...(fanDelta.removed.length ? { fanRemoved: fanDelta.removed } : {})
        };
    }

    /** Called after socket.send succeeds. Failed or coalesced frames must call abort instead. */
    commit(id: string, seq: number) {
        const state = this.states.get(id);
        const prepared = state?.prepared;
        if (!state || !prepared || prepared.seq !== seq) return false;
        state.sentSeq = seq;
        state.sentBase = prepared.poses;
        if (prepared.full) state.fullSeq = seq;
        state.prepared = null;
        return true;
    }

    abort(id: string, seq: number) {
        const state = this.states.get(id);
        if (!state?.prepared || state.prepared.seq !== seq) return false;
        state.prepared = null;
        return true;
    }

    acknowledge(id: string, epoch: number | undefined, seq: number, now: number) {
        const state = this.states.get(id);
        if (!state || (epoch !== undefined && epoch !== state.epoch) || seq > state.sentSeq || seq < 1) return false;
        if (state.fullSeq !== null && seq >= state.fullSeq) {
            state.fullSeq = null;
            state.nextFullAt = now + SnapshotDeltaPublisher.FULL_INTERVAL_MS;
        }
        return true;
    }

    resync(id: string) {
        const state = this.states.get(id);
        if (!state) return null;
        state.epoch = ++this.epoch;
        state.sentSeq = 0;
        state.sentBase = null;
        state.prepared = null;
        state.fullSeq = null;
        state.nextFullAt = 0;
        return state.epoch;
    }

    epochFor(id: string) { return this.states.get(id)?.epoch ?? null; }
    forget(id: string) { this.states.delete(id); }
}
