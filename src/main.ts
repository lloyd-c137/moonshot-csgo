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
import type { Entity, StandardMaterial, Texture } from 'playcanvas';

import { installDebugHooks } from './app/debugHooks';
import { browserStorage } from './app/storage';
import { watchForUpdates } from './app/updates';
import { LABEL_ONLY_TRIGGER_RADIUS, PLAYER } from './config/gameplay';
import { multiplayerUrl } from './config/multiplayer';
import { CEILING_MASK_URL, DERIVED_WORLD_URL } from './config/presentation';
import { createMatch } from './gameplay/match';
import { StuckDetector } from './gameplay/stuck';
import { apiBase, createAuth } from './net/auth';
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

const createFpsMeter = () => {
    const readout = document.createElement('div');
    readout.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:50;padding:2px 8px;font:12px/1.6 ui-monospace,monospace;' +
        'color:#eef2f4;background:rgb(15 24 34 / 0.7);pointer-events:none';
    document.body.append(readout);
    let frames = 0;
    let elapsed = 0;
    let worst = 0;
    let last = performance.now();
    // Measured with the wall clock: the engine clamps its own frame delta, which would hide long stalls.
    return () => {
        const now = performance.now();
        const frame = (now - last) / 1000;
        last = now;
        frames++;
        elapsed += frame;
        worst = Math.max(worst, frame);
        if (elapsed < 2) return;
        readout.textContent = `${Math.round(frames / elapsed)} fps · 最慢一帧 ${Math.round(worst * 1000)} ms`;
        frames = 0;
        elapsed = 0;
        worst = 0;
    };
};

const boot = async () => {
    // Room data first: the location plate and room tracker need it.
    const rooms = parseCampusRooms(await fetchJson('/assets/campus/rooms.json', '房间数据'));
    const derivedWorld = parseDerivedWorld(await fetchJson(DERIVED_WORLD_URL, '场景布置数据'));
    const arena = arenaLocation(derivedWorld);
    ui = createUi();
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
    const { sun, setNight } = setupAtmosphere(app, camera);
    let night = false;
    const audioLab = import.meta.env.DEV && new URLSearchParams(window.location.search).get('audioLab') === '1';
    const serverUrl = audioLab
        ? null
        : multiplayerUrl(window.location.search, import.meta.env.PROD, window.location.hostname);
    const auth = createAuth(apiBase(serverUrl));
    shell.accountsAvailable(auth.available);
    const match = createMatch({
        app,
        player,
        camera,
        canvas,
        ui: shell,
        url: serverUrl,
        auth,
        arenaCenter: derivedWorld.arena.center as [number, number]
    });
    // Title data: saved session, the standing 淘汰王 and the online count (when a server is configured).
    if (auth.available) {
        void auth.restore().then((account) => shell.account(account));
        void auth
            .board()
            .then((board) => {
                shell.king(board.king);
                shell.titleStatus(board.online);
            })
            .catch(() => shell.titleStatus(null));
    } else {
        shell.titleStatus(null);
    }
    const lightPool = createLightPool(app, [
        ...derivedWorld.lights,
        ...authoredScenes.flatMap((scene) => scene.lights)
    ]);
    const storage = browserStorage();
    const settings = loadSettings(storage);
    applySettings(player, camera, settings);
    match.setView(settings.fieldOfView, settings.lookSensitivity);

    // The exploration log was removed; drop what older versions saved.
    storage?.removeItem('moonshot-open-world.discovered.v1');

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
            shell.setLocation(location);
            match.enteredRoom(location?.id ?? null);
        },
        0.35,
        0.2,
        anchors,
        [arena]
    );
    shell.setLocation(undefined);
    let recoveries = 0;
    // Stuck detection: movement keys held with no progress (or sunk into the floor) offers a one-key escape.
    const stuck = new StuckDetector();
    const moveKeys = new Set<string>();
    let stuckShown = false;
    let closeChat: (() => void) | null = null;
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
            if (shell.chatOpen()) return;
            if (type === 'keydown') moveKeys.add(event.code);
            else moveKeys.delete(event.code);
        });
    }
    window.addEventListener('blur', () => moveKeys.clear());
    // ?fps=1: a small frame-time readout (average fps and the worst frame of the last two seconds), to diagnose hitches.
    const fpsMeter = new URLSearchParams(window.location.search).get('fps') === '1' ? createFpsMeter() : null;
    app.on('update', (deltaTime: number) => {
        fpsMeter?.();
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
        lightPool.setDark(match.dark);
        if (match.dark !== night) {
            night = match.dark;
            sun.light!.intensity = night ? 0.04 : 0.55;
            setNight(night);
        }
        lightPool.update(deltaTime, position);
        match.update(deltaTime);
        const forward = camera.forward;
        shell.drawMaps(position.x, position.z, forward.x, forward.z, match.markers());
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
    const lockPointer = () =>
        void canvas.requestPointerLock().catch(() => {
            shell.notify('浏览器没有允许锁定鼠标，请再点一次“进入校园”');
        });
    let signingIn = false;
    const enter = () => {
        match.unlockAudio();
        // Every player has an account (no guests): sign in first; an unknown username is registered on the spot.
        if (hasEntered || !auth.available || auth.account) return lockPointer();
        if (signingIn) return;
        const { name, password } = shell.credentials();
        if (!name || !password) return shell.authError('请输入用户名和密码');
        signingIn = true;
        shell.signingIn(true);
        shell.authError(null);
        auth.signIn(name, password)
            .then(({ account, created }) => {
                shell.account(account);
                if (created) shell.notify(`已为你注册新账号：${account.name}`);
                lockPointer();
            })
            .catch((error: Error) => shell.authError(error.message))
            .finally(() => {
                signingIn = false;
                shell.signingIn(false);
            });
    };
    // R: straight to the middle of the 莲花球场 (the open-air arena).
    let recoverAt = -Infinity;
    const RECOVER_COOLDOWN = 180_000;
    const recover = () => {
        const wait = recoverAt + RECOVER_COOLDOWN - performance.now();
        if (wait > 0) {
            const seconds = Math.ceil(wait / 1000);
            shell.notify(`传送冷却中：还需 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
            return;
        }
        recoverAt = performance.now();
        const [x, z] = derivedWorld.arena.center;
        player.rigidbody!.teleport(x, 0.92, z, 0, 0, 0);
        player.rigidbody!.linearVelocity = Vec3.ZERO;
        shell.notify('已传送到莲花球场');
    };
    let hasEntered = false;
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            if (!hasEntered) match.start('');
            hasEntered = true;
            rigidbodySystem.timeScale = 1;
            shell.playing();
        } else if (hasEntered) {
            clearVelocity();
            rigidbodySystem.timeScale = 0;
            shell.paused();
        }
    });
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement !== canvas) closeChat?.();
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
            if (shell.chatOpen()) return; // typing in the chat box
            if (
                (event.code === 'Enter' || event.code === 'KeyT') &&
                document.pointerLockElement === canvas &&
                match.online
            ) {
                event.preventDefault();
                moveKeys.clear();
                match.setInputPaused(true);
                closeChat = shell.openChat(
                    (text) => match.chat(text),
                    () => {
                        closeChat = null;
                        match.setInputPaused(false);
                    }
                );
            } else if (event.code === 'Escape' && document.pointerLockElement === canvas) {
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
    await match.prewarm();
    shell.ready(
        {
            enter,
            recover: () => {
                recover();
                enter();
            },
            settingsChanged: (next) => {
                applySettings(player, camera, next);
                match.setView(next.fieldOfView, next.lookSensitivity);
                saveSettings(storage, next);
            },
            logout: async () => {
                await auth.logout();
                shell.account(null);
            },
            loadBoard: async () => {
                const board = await auth.board();
                shell.king(board.king);
                return board;
            }
        },
        settings
    );

    if (import.meta.env.PROD) watchForUpdates(__BUILD_ID__, () => shell.updateAvailable());

    if (import.meta.env.DEV) {
        installDebugHooks({
            perf: () => {
                const stats = (
                    app.graphicsDevice as unknown as { _shaderStats: { linked: number; compileTime: number } }
                )._shaderStats;
                const shaders = (app.graphicsDevice as unknown as { shaders: { name: string }[] }).shaders;
                return {
                    shadersLinked: stats.linked,
                    compileMs: stats.compileTime,
                    shaders: shaders.map((shader) => shader.name)
                };
            },
            position: () => player.getPosition().toArray(),
            fov: () => camera.camera!.fov,
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
            match: match.debug,
            lighting: () => ({
                pooled: lightPool.pool.map((light) => light.light!.intensity),
                panels: app.root
                    .findComponents('render')
                    .flatMap((render) => render.meshInstances)
                    .map((instance) => instance.material as StandardMaterial)
                    .filter((material) => material.name === 'light-panel' || /^M104-(led|rgb)/.test(material.name))
                    .map((material) => material.emissiveIntensity)
            }),
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
    if (!ui) ui = createUi();
    ui.showError(message);
});
