import type { MatchDebug } from '../gameplay/match';

// Development-only hooks used by the browser tests (installed when import.meta.env.DEV). Not in production builds.
export type DebugHooks = {
    /** Shader programs linked so far and total compile time (ms): a rise mid-game is a hitch. */
    perf: () => { shadersLinked: number; compileMs: number; shaders: string[] };
    position: () => number[];
    cameraAngles: () => number[];
    recover: () => void;
    collisionCount: number;
    barrierWalls: number;
    dressing: { doors: number; furniture: number; lights: number };
    teleport: (x: number, y: number, z: number) => void;
    recoveries: () => number;
    setLook: (pitch: number, yaw: number) => void;
    stuckShown: () => boolean;
    raycast: (from: number[], to: number[]) => string | null;
    spawn: number[];
    roomId: () => string | null;
    /** Browser tests drive a virtual clock; skipping draws keeps simulation cost independent of GPU speed. */
    match: MatchDebug;
    setRendering: (enabled: boolean) => void;
};

export const installDebugHooks = (hooks: DebugHooks) => {
    (window as Window & { __MOONSHOT__?: DebugHooks }).__MOONSHOT__ = hooks;
};
