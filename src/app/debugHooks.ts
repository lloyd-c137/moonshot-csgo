// Development-only hooks used by the browser tests (installed when import.meta.env.DEV). Not in production builds.
export type DebugHooks = {
    position: () => number[];
    cameraAngles: () => number[];
    recover: () => void;
    collisionCount: number;
    barrierWalls: number;
    dressing: { doors: number; furniture: number; lights: number };
    teleport: (x: number, y: number, z: number) => void;
    recoveries: () => number;
    setLook: (pitch: number, yaw: number) => void;
    raycast: (from: number[], to: number[]) => string | null;
    spawn: number[];
    roomId: () => string | null;
    discovered: () => string[];
    /** Browser tests drive a virtual clock; skipping draws keeps simulation cost independent of GPU speed. */
    setRendering: (enabled: boolean) => void;
};

export const installDebugHooks = (hooks: DebugHooks) => {
    (window as Window & { __MOONSHOT__?: DebugHooks }).__MOONSHOT__ = hooks;
};
