// Detects a player who is trying to move but cannot (wedged on furniture, caught in geometry, sunk below the floor)
// so the game can offer a one-key escape back to the spawn. Pure; tested in test/stuck.test.js.

export const STUCK = {
    /** Seconds of continuous movement input with almost no progress before offering the escape. */
    seconds: 2,
    /** Metres of travel over that window that count as progress. */
    minTravel: 0.35,
    /** Capsule-centre height below which the player is considered sunk into the floor (normal is about 0.9 m). */
    sunkBelow: 0.45,
    sunkSeconds: 1
} as const;

type Sample = { t: number; x: number; z: number };

export class StuckDetector {
    private samples: Sample[] = [];
    private trying = 0;
    private sunk = 0;

    /** Feed one frame; returns whether the player looks stuck right now. */
    update(deltaTime: number, t: number, position: [number, number, number], tryingToMove: boolean, suppressed = false) {
        if (suppressed) {
            this.reset();
            return false;
        }
        const [x, y, z] = position;
        this.samples.push({ t, x, z });
        while (this.samples.length && t - this.samples[0].t > STUCK.seconds) this.samples.shift();
        this.trying = tryingToMove ? this.trying + deltaTime : 0;
        this.sunk = y < STUCK.sunkBelow ? this.sunk + deltaTime : 0;
        if (this.sunk >= STUCK.sunkSeconds) return true;
        if (this.trying < STUCK.seconds) return false;
        const first = this.samples[0];
        return Math.hypot(x - first.x, z - first.z) < STUCK.minTravel;
    }

    reset() {
        this.samples = [];
        this.trying = 0;
        this.sunk = 0;
    }
}
