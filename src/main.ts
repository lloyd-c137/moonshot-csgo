import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_FILL_WINDOW,
    LightComponentSystem,
    RenderComponentSystem,
    RESOLUTION_AUTO,
    WasmModule,
    createGraphicsDevice
} from 'playcanvas';

import { createLoadingScreen } from './ui/loadingScreen';
import { loadCampus } from './world/campusLoader';

import './starter.css';

const ui = createLoadingScreen();

const boot = async () => {
    ui.setStatus('正在初始化物理运行时…');
    await new Promise<void>((resolve, reject) => {
        WasmModule.setConfig('Ammo', {
            glueUrl: '/ammo/ammo.wasm.js',
            wasmUrl: '/ammo/ammo.wasm.wasm',
            fallbackUrl: '/ammo/ammo.js',
            errorHandler: reject
        });
        WasmModule.getInstance('Ammo', (module) => (module ? resolve() : reject(new Error('Ammo module did not initialize'))));
    });

    const canvas = document.getElementById('application-canvas') as HTMLCanvasElement;
    const device = await createGraphicsDevice(canvas);
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];
    options.resourceHandlers = [ContainerHandler];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.scene.ambientLight = new Color(0.58, 0.61, 0.66);

    const camera = new Entity('showcase-camera');
    camera.addComponent('camera', { clearColor: new Color(0.08, 0.12, 0.17), fov: 55, farClip: 500 });
    camera.setPosition(0, 95, 155);
    camera.setEulerAngles(-30, 0, 0);
    app.root.addChild(camera);

    const sun = new Entity('campus-key-light');
    sun.addComponent('light', { type: 'directional', intensity: 1.5 });
    sun.setEulerAngles(48, 35, 0);
    app.root.addChild(sun);

    const fill = new Entity('campus-fill-light');
    fill.addComponent('light', { type: 'directional', intensity: 0.7 });
    fill.setEulerAngles(-25, -145, 0);
    app.root.addChild(fill);

    const campus = await loadCampus(app, ui.setProgress);
    app.root.addChild(campus.root);
    app.start();
    window.addEventListener('resize', () => app.resizeCanvas());
    ui.ready();
};

boot().catch((error: unknown) => {
    console.error(error);
    ui.showError(error instanceof Error ? error.message : String(error));
});
