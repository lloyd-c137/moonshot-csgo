declare module 'playcanvas/scripts/esm/first-person-controller.mjs' {
    import { Script } from 'playcanvas';

    export class FirstPersonController extends Script {}
}

declare module 'playcanvas/scripts/esm/camera-frame.mjs' {
    import { Script } from 'playcanvas';

    export class CameraFrame extends Script {
        rendering: { toneMapping: string; samples: number; renderTargetScale: number; sharpness: number };
        ssao: { type: string; intensity: number; radius: number; samples: number; power: number; blurEnabled: boolean };
        bloom: { enabled: boolean; intensity: number; blurLevel: number };
        vignette: { enabled: boolean; intensity: number; inner: number; outer: number; curvature: number };
        grading: { enabled: boolean; brightness: number; contrast: number; saturation: number };
    }
}
