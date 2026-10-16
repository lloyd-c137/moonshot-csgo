// Sniper aim (pure; tested in test/scope.test.js). Holding the throw button past a quick flick starts aiming: the
// view zooms in gradually, mouse sensitivity and walking speed drop with it, and once fully aimed the next release
// is a sniper throw (see SNIPER in the protocol: dead-straight, and lethal to the head).

export const SCOPE = {
    /** Held this long (s) before aiming starts, so quick flicks never zoom. */
    delay: 0.18,
    /** Seconds from the start of aiming to fully aimed. */
    zoomSeconds: 0.85,
    /** Field of view at full aim, as a fraction of the normal one. */
    fovScale: 0.36,
    /** Walking speed at full aim, as a fraction of normal. */
    moveScale: 0.45
} as const;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Aim progress 0–1 for a button held `heldSeconds` (eased, so the zoom starts and settles gently). */
export const aimProgress = (heldSeconds: number) =>
    smooth(Math.min(1, Math.max(0, (heldSeconds - SCOPE.delay) / SCOPE.zoomSeconds)));

/** Fully aimed: the release will be a sniper throw. */
export const aimReady = (heldSeconds: number) => heldSeconds >= SCOPE.delay + SCOPE.zoomSeconds;

/** Field-of-view multiplier at aim progress `aim`. */
export const fovFactor = (aim: number) => 1 - (1 - SCOPE.fovScale) * aim;

/**
 * Mouse sensitivity multiplier: proportional to the zoom so the crosshair sweeps the same on-screen distance per
 * mouse movement at any zoom (tan of half-angles), which keeps fine aim controllable.
 */
export const sensitivityFactor = (baseFovDegrees: number, aim: number) => {
    const half = (degrees: number) => Math.tan((degrees * Math.PI) / 360);
    return half(baseFovDegrees * fovFactor(aim)) / half(baseFovDegrees);
};
