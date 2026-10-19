import type { ServerMessage, StampedPose } from '../src/net/protocol.ts';
import { diffPoses, poseChangeCount } from '../src/net/snapshotDelta.ts';

export const OUTBOUND_LIMITS = { recoveryBytes: 64 * 1024, pauseSnapshotBytes: 256 * 1024, slowBytes: 512 * 1024, slowMs: 2000 } as const;
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

    forget(id: string) {
        this.slowSince.delete(id);
    }
}

type SnapshotState = { sent: number; acked: number; sentAt: number; capable: boolean };

/** Cloudflare does not expose bufferedAmount; this bounds snapshots to one unacknowledged application frame. */
export class SnapshotAcks {
    private readonly states = new Map<string, SnapshotState>();
    coalesced = 0;
    slow = 0;

    acknowledge(id: string, seq: number) {
        const state = this.states.get(id);
        if (!state || seq > state.sent || seq < state.acked) return false;
        state.capable = true;
        state.acked = seq;
        return true;
    }

    resync(id: string) {
        const state = this.states.get(id);
        if (!state) return false;
        state.acked = state.sent;
        state.capable = true;
        return true;
    }

    next(id: string, now: number): { type: 'send'; seq: number } | { type: 'coalesce' } | { type: 'close' } {
        let state = this.states.get(id);
        if (!state) {
            state = { sent: 0, acked: 0, sentAt: 0, capable: false };
            this.states.set(id, state);
        }
        if (state.capable && state.acked < state.sent) {
            if (now - state.sentAt >= OUTBOUND_LIMITS.slowMs) {
                this.states.delete(id);
                this.slow++;
                return { type: 'close' };
            }
            this.coalesced++;
            return { type: 'coalesce' };
        }
        state.sent++;
        state.sentAt = now;
        return { type: 'send', seq: state.sent };
    }

    forget(id: string) {
        this.states.delete(id);
    }
}

type PoseSet = { poses: Record<string, StampedPose>; fans: Record<string, StampedPose> };
type PublisherState = {
    epoch: number;
    enabled: boolean;
    baseSeq: number;
    base: PoseSet | null;
    pending: { seq: number; poses: PoseSet } | null;
    fullAt: number;
};

/** Keeps a recipient-only baseline and advances it only after that client acknowledges application. */
export class SnapshotDeltaPublisher {
    private readonly states = new Map<string, PublisherState>();
    private epoch = 0;

    register(id: string, enabled: boolean) {
        this.states.set(id, { epoch: ++this.epoch, enabled, baseSeq: 0, base: null, pending: null, fullAt: 0 });
    }

    encode(id: string, snapshot: Extract<ServerMessage, { type: 'snapshot' }>, seq: number, now: number): ServerMessage {
        const state = this.states.get(id);
        if (!state || !state.enabled) return { ...snapshot, seq };
        const current = { poses: snapshot.poses, fans: snapshot.fans ?? {} };
        const full = () => ({
            type: 'snapshotFull' as const, epoch: state.epoch, seq, t: snapshot.t,
            poses: current.poses, ...(Object.keys(current.fans).length ? { fans: current.fans } : {})
        });
        if (!state.base || now >= state.fullAt) {
            state.pending = { seq, poses: current };
            return full();
        }
        const total = Object.keys(current.poses).length + Object.keys(current.fans).length +
            Object.keys(state.base.poses).length + Object.keys(state.base.fans).length;
        const changeThreshold = Math.max(1, Math.ceil(total * 0.25));
        const changed = poseChangeCount(state.base.poses, current.poses, changeThreshold + 1) +
            poseChangeCount(state.base.fans, current.fans, changeThreshold + 1);
        if (changed > changeThreshold) {
            state.pending = { seq, poses: current };
            return full();
        }
        const poseDelta = diffPoses(state.base.poses, current.poses);
        const fanDelta = diffPoses(state.base.fans, current.fans);
        state.pending = { seq, poses: current };
        return {
            type: 'snapshotDelta', epoch: state.epoch, seq, baseSeq: state.baseSeq, t: snapshot.t,
            updates: poseDelta.updates, removed: poseDelta.removed,
            ...(Object.keys(fanDelta.updates).length ? { fanUpdates: fanDelta.updates } : {}),
            ...(fanDelta.removed.length ? { fanRemoved: fanDelta.removed } : {})
        };
    }

    acknowledge(id: string, seq: number, now: number) {
        const state = this.states.get(id);
        if (!state || state.pending?.seq !== seq) return false;
        state.baseSeq = seq;
        state.base = state.pending.poses;
        state.pending = null;
        state.fullAt = now + 10_000;
        return true;
    }

    resync(id: string) {
        const state = this.states.get(id);
        if (!state) return false;
        state.epoch = ++this.epoch;
        state.baseSeq = 0;
        state.base = null;
        state.pending = null;
        state.fullAt = 0;
        return true;
    }

    forget(id: string) {
        this.states.delete(id);
    }
}
