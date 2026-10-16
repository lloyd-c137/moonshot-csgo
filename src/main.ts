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

import { installDebugHooks } from './app/debugHooks';
import { watchForUpdates } from './app/updates';
import { LABEL_ONLY_TRIGGER_RADIUS, PLAYER } from './config/gameplay';
import { multiplayerUrl } from './config/multiplayer';
import { CEILING_MASK_URL, DERIVED_WORLD_URL } from './config/presentation';
import { browserStorage, DiscoveryLog } from './gameplay/discovery';
import { createMatch } from './gameplay/match';
import { StuckDetector } from './gameplay/stuck';
import { addCampusCollisions } from './physics/collisionWorld';
import {
    applySettings,
    createPlayer,
    isOutOfWorld,
    recoverPlayer,
    SAFE_SPAWN,
    setLook
} from './player/playerController';
import { createLightPool, setupAtmosphere } from './render/atmosphere';
import { loadSettings, saveSettings } from './ui/settings';
import type { Ui } from './ui/shell';
import { createUi } from './ui/shell';
import { buildAuthoredRoom } from './world/authoredRoom';
import { loadCampus } from './world/campusLoader';
import { cutDoorwaysInto } from './world/doorwayCutter';
import { arenaLocation, buildDressing, parseDerivedWorld } from './world/dressing';
import { applyWallHeightAdapter } from './world/presentation';
import type { Point2 } from './world/roomIndex';
import { createAnchorTriggers, parseCampusRooms, RoomTracker } from './world/roomIndex';
import { AUTHORED_ROOM_IDS, authoredRoomScenes } from './world/rooms';
import { buildSigns } from './world/signage';

let ui: Ui | null = null;

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

const fetchJson = async (url: string, label: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${label}加载失败（HTTP ${response.status}）`);
    return response.json() as Promise<unknown>;
};

const boot = async () => {
    // Room data first: the UI needs the location list for the discovery map.
    const rooms = parseCampusRooms(await fetchJson('/assets/campus/rooms.json', '房间数据'));
    const derivedWorld = parseDerivedWorld(await fetchJson(DERIVED_WORLD_URL, '场景布置数据'));
    const arena = arenaLocation(derivedWorld);
    const locations = [...rooms.rooms, arena];
    ui = createUi(locations);
    const shell = ui;

    shell.stage('physics', 'active');
    await waitForAmmo();
    shell.stage('physics', 'done');

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

    shell.stage('campus', 'active');
    const [campus, ceilingMask] = await Promise.all([
        loadCampus(app, () => undefined),
        loadTexture(app, CEILING_MASK_URL)
    ]);
    shell.stage('campus', 'done');

    shell.stage('structure', 'active');
    applyWallHeightAdapter(campus.root);
    // GAMEPLAY_AUTHORED doorways for rooms the source walls seal off; cut before colliders are built.
    for (const [name, reveals] of [
        ['Walls', true],
        ['Glazing', false]
    ] as const) {
        cutDoorwaysInto(app, campus.root.findByName(name) as Entity, derivedWorld.doorways, reveals);
    }
    app.root.addChild(campus.root);
    const collisions = addCampusCollisions(app, campus.root);
    shell.stage('structure', 'done');

    shell.stage('dressing', 'active');
    const dressing = buildDressing(app, campus.root, derivedWorld, rooms.rooms, ceilingMask, AUTHORED_ROOM_IDS);
    const authoredScenes = authoredRoomScenes();
    for (const scene of authoredScenes) buildAuthoredRoom(app, campus.root, scene);
    buildSigns(app, campus.root, derivedWorld, rooms.rooms);
    const { player, camera } = createPlayer(app);
    setupAtmosphere(app, camera);
    const match = createMatch({
        app,
        player,
        camera,
        canvas,
        ui: shell,
        url: multiplayerUrl(window.location.search, import.meta.env.PROD, window.location.hostname)
    });
    const lightPool = createLightPool(app, [
        ...derivedWorld.lights,
        ...authoredScenes.flatMap((scene) => scene.lights)
    ]);
    const storage = browserStorage();
    const settings = loadSettings(storage);
    applySettings(player, camera, settings);

    const discovery = new DiscoveryLog(
        locations.map((location) => location.id),
        storage
    );
    shell.setDiscovered(discovery.list, discovery.total);
    discovery.onChange(() => shell.setDiscovered(discovery.list, discovery.total));

    const rigidbodySystem = app.systems.rigidbody as RigidBodyComponentSystem;
    const anchorPositions = new Map<string, Point2>();
    for (const room of rooms.rooms) {
        const anchor = campus.root.findByName(`Label_${room.id}`);
        if (anchor) anchorPositions.set(room.id, [anchor.getPosition().x, anchor.getPosition().z]);
    }
    const anchors = createAnchorTriggers(rooms.rooms, anchorPositions, LABEL_ONLY_TRIGGER_RADIUS);
    const roomTracker = new RoomTracker(
        rooms.rooms,
        (location) => {
            const isNew = location ? discovery.visit(location.id) : false;
            shell.setLocation(location, isNew);
            if (location && isNew) shell.discovered(location, discovery.count, discovery.total);
        },
        0.35,
        0.2,
        anchors,
        [arena]
    );
    shell.setLocation(undefined, false);
    let recoveries = 0;
    // Stuck detection: movement keys held with no progress (or sunk into the floor) offers a one-key escape.
    const stuck = new StuckDetector();
    const moveKeys = new Set<string>();
    let stuckShown = false;
    let stuckAt: [number, number] = [0, 0];
    const escapeStuck = () => {
        stuck.reset();
        stuckShown = false;
        shell.stuck(false);
        recoverPlayer(player);
        shell.notify('已脱离卡死，回到南入口');
    };
    shell.stuck(false, () => {
        escapeStuck();
        canvas.requestPointerLock()?.catch?.(() => undefined);
    });
    for (const type of ['keydown', 'keyup'] as const) {
        window.addEventListener(type, (event) => {
            if (
                !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
                    event.code
                )
            )
                return;
            if (type === 'keydown') moveKeys.add(event.code);
            else moveKeys.delete(event.code);
        });
    }
    window.addEventListener('blur', () => moveKeys.clear());
    app.on('update', (deltaTime: number) => {
        const position = player.getPosition();
        if (isOutOfWorld(position.y)) {
            recoveries++;
            recoverPlayer(player);
            shell.notify('已离开可探索范围，已回到南入口');
            return;
        }
        roomTracker.update([position.x, position.z], deltaTime);
        if (document.pointerLockElement === canvas && match.alive) {
            const isStuck = stuck.update(
                deltaTime,
                performance.now() / 1000,
                [position.x, position.y, position.z],
                moveKeys.size > 0
            );
            if (isStuck && !stuckShown) {
                stuckShown = true;
                stuckAt = [position.x, position.z];
                shell.stuck(true);
            } else if (stuckShown && Math.hypot(position.x - stuckAt[0], position.z - stuckAt[1]) > 1) {
                // Got free on their own.
                stuckShown = false;
                shell.stuck(false);
            }
        }
        lightPool.update(deltaTime, position);
        match.update(deltaTime);
        const forward = camera.forward;
        shell.drawMaps(position.x, position.z, forward.x, forward.z);
    });

    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const spawnCheck = inspectSpawn(app);
    if (!spawnCheck.supported || !spawnCheck.clear) {
        throw new Error(`南入口出生点未通过楼板支撑与头顶净空检查：${JSON.stringify(spawnCheck)}`);
    }
    shell.stage('dressing', 'done');

    const clearVelocity = () => {
        if (player.rigidbody) {
            player.rigidbody.linearVelocity = Vec3.ZERO;
            player.rigidbody.angularVelocity = Vec3.ZERO;
        }
    };
    const enter = () => {
        void canvas.requestPointerLock().catch(() => {
            shell.notify('浏览器没有允许锁定鼠标，请再点一次“进入校园”');
        });
    };
    const recover = () => {
        recoverPlayer(player);
        shell.notify('已回到南入口');
    };
    let hasEntered = false;
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            if (!hasEntered) match.start(shell.nickname());
            hasEntered = true;
            rigidbodySystem.timeScale = 1;
            shell.playing();
        } else if (hasEntered) {
            clearVelocity();
            rigidbodySystem.timeScale = 0;
            shell.paused();
        }
    });
    document.addEventListener('pointerlockerror', () => shell.notify('浏览器没有允许锁定鼠标，请再点一次'));
    const pause = () => {
        clearVelocity();
        rigidbodySystem.timeScale = 0;
        if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pause();
    });
    window.addEventListener(
        'keydown',
        (event) => {
            if (event.code === 'Escape' && document.pointerLockElement === canvas) {
                event.preventDefault();
                document.exitPointerLock();
            } else if (event.code === 'KeyR' && hasEntered && document.pointerLockElement === canvas) {
                event.preventDefault();
                recover();
            } else if (event.code === 'KeyG' && stuckShown && document.pointerLockElement === canvas) {
                event.preventDefault();
                escapeStuck();
            } else if (event.code === 'KeyM' && document.pointerLockElement === canvas) {
                event.preventDefault();
                shell.toggleMap();
            }
        },
        true
    );
    rigidbodySystem.timeScale = 0;
    shell.ready(
        {
            enter,
            recover: () => {
                recover();
                enter();
            },
            settingsChanged: (next) => {
                applySettings(player, camera, next);
                saveSettings(storage, next);
            }
        },
        settings
    );

    if (import.meta.env.PROD) watchForUpdates(__BUILD_ID__, () => shell.updateAvailable());

    if (import.meta.env.DEV) {
        installDebugHooks({
            position: () => player.getPosition().toArray(),
            cameraAngles: () => camera.getEulerAngles().toArray(),
            recover: () => recoverPlayer(player),
            collisionCount: collisions.sourceBodies,
            barrierWalls: collisions.barrierWalls,
            dressing,
            teleport: (x: number, y: number, z: number) => {
                player.rigidbody!.teleport(x, y, z, 0, 0, 0);
                clearVelocity();
            },
            recoveries: () => recoveries,
            setLook: (pitch: number, yaw: number) => setLook(player, pitch, yaw),
            stuckShown: () => stuckShown,
            raycast: (from: number[], to: number[]) =>
                rigidbodySystem.raycastFirst(new Vec3(from[0], from[1], from[2]), new Vec3(to[0], to[1], to[2]))?.entity
                    .name ?? null,
            spawn: [SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z],
            roomId: () => roomTracker.current?.id ?? null,
            discovered: () => [...discovery.list],
            match: match.debug,
            setRendering: (enabled: boolean) => {
                app.autoRender = enabled;
                app.renderNextFrame = true;
            }
        });
    }
    window.addEventListener('resize', () => app.resizeCanvas());
};

boot().catch((error: unknown) => {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (!ui) ui = createUi([]);
    ui.showError(message);
});
