import type { MatchDebug } from '../gameplay/match';
import type { Ui } from '../ui/shell';

// Development-only hooks used by the browser tests (installed when import.meta.env.DEV). Not in production builds.
export type DebugHooks = {
    /** The interface, for visual checks of feeds, medals and skill cards. */
    ui: Ui;
    /** Shader programs linked so far and total compile time (ms): a rise mid-game is a hitch. */
    perf: () => { shadersLinked: number; compileMs: number; shaders: string[]; drawCallsPerFrame: number };
    position: () => number[];
    cameraAngles: () => number[];
    recover: () => void;
    collisionCount: number;
    barrierWalls: number;
    dressing: {
        doors: number;
        furniture: number;
        lights: number;
        mirrors: { roomId: string; position: number[]; yaw: number; normal: number[] }[];
    };
    teleport: (x: number, y: number, z: number) => void;
    recoveries: () => number;
    setLook: (pitch: number, yaw: number) => void;
    stuckShown: () => boolean;
    raycast: (from: number[], to: number[]) => string | null;
    spawn: number[];
    roomId: () => string | null;
    /** Browser tests drive a virtual clock; skipping draws keeps simulation cost independent of GPU speed. */
    match: MatchDebug;
    /** Exercise the same masked relocation UI used by the final-arena round transition. */
    sceneTransition: (relocate: () => void) => void;
    /** Render an authoritative round-result card for development visual checks. */
    showRoundResult: (outcome: 'golden-disc' | 'last-survivor' | 'draw' | 'george-reboot', mine: boolean) => void;
    lighting: () => { pooled: number[]; panels: number[] };
    setRendering: (enabled: boolean) => void;
    /** Current camera field of view (degrees). */
    fov: () => number;
};

export const installDebugHooks = (hooks: DebugHooks) => {
    (window as Window & { __MOONSHOT__?: DebugHooks }).__MOONSHOT__ = hooks;
};
