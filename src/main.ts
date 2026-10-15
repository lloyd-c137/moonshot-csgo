import {
    AppBase,
    AppOptions,
    CameraComponentSystem,
    CollisionComponentSystem,
    ContainerHandler,
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_LINEAR,
    TextureHandler,
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
import type { Entity, Texture } from 'playcanvas';

import { LABEL_ONLY_TRIGGER_RADIUS, PLAYER } from './config/gameplay';
import { CEILING_MASK_URL, DERIVED_WORLD_URL } from './config/presentation';
import { addCampusCollisions } from './physics/collisionWorld';
import { createPlayer, isOutOfWorld, recoverPlayer, SAFE_SPAWN, setLook } from './player/playerController';
import { createLightPool, setupAtmosphere } from './render/atmosphere';
import { createGameHud } from './ui/gameHud';
import { createMinimap } from './ui/minimap';
import { loadCampus } from './world/campusLoader';
import { arenaLocation, buildDressing, parseDerivedWorld } from './world/dressing';
import { applyWallHeightAdapter } from './world/presentation';
import type { Point2 } from './world/roomIndex';
import { createAnchorTriggers, parseCampusRooms, RoomTracker } from './world/roomIndex';
import './starter.css';

const ui = createGameHud();
type DebugWindow = Window & {
    __MOONSHOT__?: {
        position: () => number[];
        cameraAngles: () => number[];
        recover: () => void;
        collisionCount: number;
        barrierWalls: number;
        dressing: { doors: number; furniture: number; lights: number };
        teleport: (x: number, y: number, z: number) => void;
        recoveries: () => number;
        setLook: (pitch: number, yaw: number) => void;
        setEnabled: (name: string, enabled: boolean) => boolean;
        cameraFrame: (enabled: boolean) => void;
        cameraFrameSet: (group: string, key: string, value: unknown) => void;
        raycast: (from: number[], to: number[]) => string | null;
        spawn: number[];
        roomId: () => string | null;
        setRendering: (enabled: boolean) => void;
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

    const probe = PLAYER.radius * 0.8;
    const offsets = [
        [0, 0],
        [probe, 0],
        [-probe, 0],
        [0, probe],
        [0, -probe]
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

const loadTexture = (app: AppBase, url: string) =>
    new Promise<Texture>((resolve, reject) => {
        app.assets.loadFromUrl(url, 'texture', (error, asset) => {
            const texture = asset?.resource as Texture | undefined;
            if (error || !texture) {
                reject(new Error(`Derived texture failed to load: ${url} ${error ?? ''}`));
                return;
            }
            texture.mipmaps = false;
            texture.minFilter = FILTER_LINEAR;
            texture.addressU = ADDRESS_CLAMP_TO_EDGE;
            texture.addressV = ADDRESS_CLAMP_TO_EDGE;
            resolve(texture);
        });
    });

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
    options.resourceHandlers = [ContainerHandler, TextureHandler];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(RESOLUTION_AUTO);
    // AppBase installs the Ammo physics world during start; static bodies must be added afterward.
    app.start();

    ui.setStatus('正在加载 FF-01 校园场景…');
    const [campus, roomResponse, worldResponse, ceilingMask] = await Promise.all([
        loadCampus(app, ui.setProgress),
        fetch('/assets/campus/rooms.json'),
        fetch(DERIVED_WORLD_URL),
        loadTexture(app, CEILING_MASK_URL)
    ]);
    if (!roomResponse.ok) throw new Error(`Room data failed to load: HTTP ${roomResponse.status}`);
    if (!worldResponse.ok) throw new Error(`Derived world data failed to load: HTTP ${worldResponse.status}`);
    const rooms = parseCampusRooms(await roomResponse.json());
    const derivedWorld = parseDerivedWorld(await worldResponse.json());
    applyWallHeightAdapter(campus.root);
    app.root.addChild(campus.root);
    const collisions = addCampusCollisions(app, campus.root);
    ui.setStatus('正在布置门、家具与灯光…');
    const dressing = buildDressing(app, campus.root, derivedWorld, rooms.rooms, ceilingMask);
    const { player, camera } = createPlayer(app);
    setupAtmosphere(app, camera);
    const lightPool = createLightPool(app, derivedWorld.lights);
    const minimap = createMinimap();
    const rigidbodySystem = app.systems.rigidbody as RigidBodyComponentSystem;
    const anchorPositions = new Map<string, Point2>();
    for (const room of rooms.rooms) {
        const anchor = campus.root.findByName(`Label_${room.id}`);
        if (anchor) anchorPositions.set(room.id, [anchor.getPosition().x, anchor.getPosition().z]);
    }
    const anchors = createAnchorTriggers(rooms.rooms, anchorPositions, LABEL_ONLY_TRIGGER_RADIUS);
    const roomTracker = new RoomTracker(
        rooms.rooms,
        (room) => ui.setLocation(room ? `${room.name} · ${room.id}` : 'FF-01 · 区域未知'),
        0.35,
        0.2,
        anchors,
        [arenaLocation(derivedWorld)]
    );
    ui.setLocation('FF-01 · 区域未知');
    let recoveries = 0;
    app.on('update', (deltaTime: number) => {
        const position = player.getPosition();
        if (isOutOfWorld(position.y)) {
            recoveries++;
            recoverPlayer(player);
            ui.notify('已离开可探索范围，已返回东入口安全点');
            return;
        }
        roomTracker.update([position.x, position.z], deltaTime);
        lightPool.update(deltaTime, position);
        const forward = camera.forward;
        minimap.update(deltaTime, position.x, position.z, forward.x, forward.z);
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
            minimap.setActive(true);
        } else if (hasEntered) {
            clearVelocity();
            rigidbodySystem.timeScale = 0;
            ui.paused();
            minimap.setActive(false);
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
            collisionCount: collisions.sourceBodies,
            barrierWalls: collisions.barrierWalls,
            dressing,
            teleport: (x: number, y: number, z: number) => {
                player.rigidbody!.teleport(x, y, z, 0, 0, 0);
                clearVelocity();
            },
            recoveries: () => recoveries,
            setLook: (pitch: number, yaw: number) => setLook(player, pitch, yaw),
            setEnabled: (name: string, enabled: boolean) => {
                const entity = app.root.findByName(name) as Entity | null;
                if (entity) entity.enabled = enabled;
                return !!entity;
            },
            raycast: (from: number[], to: number[]) =>
                rigidbodySystem.raycastFirst(new Vec3(from[0], from[1], from[2]), new Vec3(to[0], to[1], to[2]))?.entity
                    .name ?? null,
            cameraFrameSet: (group: string, key: string, value: unknown) => {
                const frame = camera.script?.get('cameraFrame') as unknown as Record<
                    string,
                    Record<string, unknown>
                > | null;
                if (frame?.[group]) frame[group][key] = value;
            },
            cameraFrame: (enabled: boolean) => {
                const frame = camera.script?.get('cameraFrame');
                if (frame) frame.enabled = enabled;
            },
            spawn: [SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z],
            roomId: () => roomTracker.current?.id ?? null,
            // Browser tests drive a virtual clock; skipping draws keeps simulation cost independent of GPU speed.
            setRendering: (enabled: boolean) => {
                app.autoRender = enabled;
                app.renderNextFrame = true;
            }
        };
    }
    window.addEventListener('resize', () => app.resizeCanvas());
};

boot().catch((error: unknown) => {
    console.error(error);
    ui.showError(error instanceof Error ? error.message : String(error));
});
