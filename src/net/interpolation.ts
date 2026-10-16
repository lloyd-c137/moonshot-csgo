// Smooth remote-player motion (pure; tested in test/net-interpolation.test.js).
//
// Poses are stamped by the room when they arrive (server time), so duplicated or bunched snapshots do not cause
// jerks. Each client estimates the server clock from snapshot send times and draws everyone a fixed delay in the
// past, blending between the two stamped poses around that moment (briefly extrapolating if a pose is late).
import type { PlayerPose } from './protocol';

/** How far behind the estimated server clock remote players are drawn (ms): one pose + one snapshot interval + jitter. */
export const RENDER_DELAY = 130;
/** Longest extrapolation past the newest pose before holding still (ms). */
const MAX_EXTRAPOLATION = 120;

export class ServerClock {
    private samples: number[] = [];
    private estimate: number | null = null;

    /** Records a snapshot sent at `serverTime` and received at local `localTime`. */
    observe(serverTime: number, localTime: number) {
        // serverTime - localTime ≤ true offset (latency only makes it smaller): the recent maximum is the best guess.
        this.samples.push(serverTime - localTime);
        if (this.samples.length > 40) this.samples.shift();
        const best = Math.max(...this.samples);
        // Ease toward the new estimate so a single fast packet does not jolt everyone.
        this.estimate = this.estimate === null ? best : this.estimate + (best - this.estimate) * 0.1;
    }

    /** Estimated server time for a local time, or null before the first snapshot. */
    toServer(localTime: number) {
        return this.estimate === null ? null : localTime + this.estimate;
    }
}

type Stamped = { t: number; pose: PlayerPose };

export class PoseBuffer {
    private samples: Stamped[] = [];

    push(t: number, pose: PlayerPose) {
        const last = this.samples[this.samples.length - 1];
        if (last && t <= last.t) return; // duplicate or out-of-order
        this.samples.push({ t, pose });
        if (this.samples.length > 20) this.samples.shift();
    }

    get size() {
        return this.samples.length;
    }

    /** Pose at server time `t`. */
    sample(t: number): PlayerPose | null {
        const s = this.samples;
        if (!s.length) return null;
        if (s.length === 1 || t <= s[0].t) return s[t <= s[0].t ? 0 : s.length - 1].pose;
        let i = s.length - 1;
        while (i > 0 && s[i - 1].t > t) i--;
        let a = s[Math.max(0, i - 1)];
        let b = s[i];
        let u: number;
        if (t > s[s.length - 1].t) {
            // Late data: extrapolate along the last segment a little, then hold.
            a = s[s.length - 2];
            b = s[s.length - 1];
            u = 1 + Math.min(t - b.t, MAX_EXTRAPOLATION) / Math.max(1, b.t - a.t);
            u = Math.min(u, 1.5);
        } else {
            u = (t - a.t) / Math.max(1, b.t - a.t);
        }
        const lerp = (x: number, y: number) => x + (y - x) * u;
        let dyaw = b.pose.yaw - a.pose.yaw;
        dyaw -= Math.round(dyaw / 360) * 360;
        return {
            p: [lerp(a.pose.p[0], b.pose.p[0]), lerp(a.pose.p[1], b.pose.p[1]), lerp(a.pose.p[2], b.pose.p[2])],
            yaw: a.pose.yaw + dyaw * u,
            pitch: lerp(a.pose.pitch, b.pose.pitch)
        };
    }
}
