import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    CollisionComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_FILL_WINDOW,
    LightComponentSystem,
    RenderComponentSystem,
    RigidBodyComponentSystem,
    RESOLUTION_AUTO,
    ScriptComponentSystem,
    Vec3,
    WasmModule,
    createGraphicsDevice
} from 'playcanvas';

import { addCampusCollisions } from './physics/collisionWorld';
import { createPlayer, recoverPlayer, SAFE_SPAWN } from './player/playerController';
import { createGameHud } from './ui/gameHud';
import { loadCampus } from './world/campusLoader';
import { parseCampusRooms, RoomTracker } from './world/roomIndex';
import './starter.css';

const ui = createGameHud();
type DebugWindow = Window & {
    __MOONSHOT__?: {
        position: () => number[];
        cameraAngles: () => number[];
        recover: () => void;
        collisionCount: number;
        spawn: number[];
        roomId: () => string | null;
    };
};

const waitForAmmo = () =>
    new Promise<void>((resolve, reject) => {
        WasmModule.setConfig('Ammo', {
            glueUrl: '/ammo/ammo.wasm.js',
            wasmUrl: '/ammo/ammo.wasm.wasm',
            fallbackUrl: '/ammo/ammo.js',
            errorHandler: reject
        });
        WasmModule.getInstance('Ammo', (module) =>
            module ? resolve() : reject(new Error('Ammo module did not initialize'))
        );
    });

const inspectSpawn = (app: AppBase) => {
    const physics = app.systems.rigidbody as RigidBodyComponentSystem;
    const start = new Vec3(SAFE_SPAWN.x, 5, SAFE_SPAWN.z);
    const end = new Vec3(SAFE_SPAWN.x, -0.5, SAFE_SPAWN.z);
    const floorNames = new Set(['Floor_Slab', 'Arena_Court']);
    const groundHits = physics.raycastAll(start, end).map((hit) => hit.entity.name);

    const offsets = [
        [0, 0],
        [0.23, 0],
        [-0.23, 0],
        [0, 0.23],
        [0, -0.23]
    ];
    const overheadHits = offsets.map(([x, z]) => {
        const ceiling = physics.raycastAll(
            new Vec3(SAFE_SPAWN.x + x, 0.1, SAFE_SPAWN.z + z),
            new Vec3(SAFE_SPAWN.x + x, 2.15, SAFE_SPAWN.z + z)
        );
        return ceiling.map((hit) => hit.entity.name).filter((name) => !floorNames.has(name) && name !== 'player');
    });
    return {
        supported: groundHits.some((name) => floorNames.has(name)),
        groundHits,
        clear: overheadHits.every((hits) => hits.length === 0),
        overheadHits
    };
};

const boot = async () => {
    ui.setStatus('正在初始化物理运行时…');
    await waitForAmmo();

    const canvas = document.getElementById('application-canvas') as HTMLCanvasElement;
    const device = await createGraphicsDevice(canvas);
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [
        RenderComponentSystem,
        CameraComponentSystem,
        LightComponentSystem,
        ScriptComponentSystem,
        CollisionComponentSystem,
        RigidBodyComponentSystem
    ];
    options.resourceHandlers = [ContainerHandler];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);
    app.scene.ambientLight = new Color(0.48, 0.52, 0.58);
    const keyLight = new Entity('campus-key-light');
    keyLight.addComponent('light', { type: 'directional', intensity: 1.5 });
    keyLight.setEulerAngles(48, 35, 0);
    app.root.addChild(keyLight);
    const fillLight = new Entity('campus-fill-light');
    fillLight.addComponent('light', { type: 'directional', intensity: 0.65 });
    fillLight.setEulerAngles(-25, -145, 0);
    app.root.addChild(fillLight);
    // AppBase installs the Ammo physics world during start; static bodies must be added afterward.
    app.start();

    ui.setStatus('正在加载 FF-01 校园场景…');
    const [campus, roomResponse] = await Promise.all([
        loadCampus(app, ui.setProgress),
        fetch('/assets/campus/rooms.json')
    ]);
    if (!roomResponse.ok) throw new Error(`Room data failed to load: HTTP ${roomResponse.status}`);
    const rooms = parseCampusRooms(await roomResponse.json());
    app.root.addChild(campus.root);
    const collisionCount = addCampusCollisions(campus.root);
    const { player, camera } = createPlayer(app);
    const rigidbodySystem = app.systems.rigidbody as RigidBodyComponentSystem;
    const roomTracker = new RoomTracker(rooms.rooms, (room) => {
        ui.setLocation(room ? `${room.name} · ${room.id}` : 'FF-01 · 区域未知');
    });
    ui.setLocation('FF-01 · 区域未知');
    app.on('update', (deltaTime: number) => {
        const position = player.getPosition();
        roomTracker.update([position.x, position.z], deltaTime);
    });

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const spawnCheck = inspectSpawn(app);
    if (!spawnCheck.supported || !spawnCheck.clear) {
        throw new Error(`东入口候选出生点未通过楼板支撑与头顶净空检查：${JSON.stringify(spawnCheck)}`);
    }

    const clearVelocity = () => {
        if (player.rigidbody) {
            player.rigidbody.linearVelocity = Vec3.ZERO;
            player.rigidbody.angularVelocity = Vec3.ZERO;
        }
    };
    const enter = () => {
        void canvas.requestPointerLock().catch((error: unknown) => {
            ui.showError(`无法捕获鼠标：${error instanceof Error ? error.message : String(error)}`);
        });
    };
    const recover = () => recoverPlayer(player);
    let hasEntered = false;
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            hasEntered = true;
            rigidbodySystem.timeScale = 1;
            ui.playing();
        } else if (hasEntered) {
            clearVelocity();
            rigidbodySystem.timeScale = 0;
            ui.paused();
        }
    });
    document.addEventListener('pointerlockerror', () => ui.showError('浏览器拒绝了鼠标锁定'));
    window.addEventListener('blur', () => {
        clearVelocity();
        rigidbodySystem.timeScale = 0;
        if (document.pointerLockElement === canvas) document.exitPointerLock();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearVelocity();
            rigidbodySystem.timeScale = 0;
            if (document.pointerLockElement === canvas) document.exitPointerLock();
        }
    });
    window.addEventListener(
        'keydown',
        (event) => {
            if (event.code === 'Escape' && document.pointerLockElement === canvas) {
                event.preventDefault();
                document.exitPointerLock();
            } else if (event.code === 'KeyR' && hasEntered) {
                event.preventDefault();
                recover();
            }
        },
        true
    );
    rigidbodySystem.timeScale = 0;
    ui.ready({ enter: () => enter(), recover });

    if (import.meta.env.DEV) {
        (window as DebugWindow).__MOONSHOT__ = {
            position: () => player.getPosition().toArray(),
            cameraAngles: () => camera.getEulerAngles().toArray(),
            recover,
            collisionCount,
            spawn: [SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z],
            roomId: () => roomTracker.current?.id ?? null
        };
    }
    window.addEventListener('resize', () => app.resizeCanvas());
};

boot().catch((error: unknown) => {
    console.error(error);
    ui.showError(error instanceof Error ? error.message : String(error));
});
