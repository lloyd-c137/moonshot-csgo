import {
    AppBase,
    AppOptions,
    AnimComponentSystem,
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
import { CHARACTER_ASSET_URL, CharacterAssetLoader } from './characters/CharacterAssetLoader';
import { LABEL_ONLY_TRIGGER_RADIUS, PLAYER, SOUTH_GATE } from './config/gameplay';
import { multiplayerUrl } from './config/multiplayer';
import { CEILING_MASK_URL, DERIVED_WORLD_URL } from './config/presentation';
import { ROOM_NAMING } from './config/roomNaming';
import type { GateState } from './gameplay/gateLobby';
import { stepGate } from './gameplay/gateLobby';
import { createIntro } from './gameplay/intro';
import { createMatch } from './gameplay/match';
import { PickupAssetLoader } from './gameplay/pickupAssetLoader';
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
import { createStepAssist } from './player/stepAssist';
import { createLightPool, setupAtmosphere } from './render/atmosphere';
import { loadSettings, saveSettings } from './ui/settings';
import type { Ui } from './ui/shell';
import { createUi } from './ui/shell';
import { buildAuthoredRoom } from './world/authoredRoom';
import { CAMPUS_ASSET_URL, loadCampus } from './world/campusLoader';
import { cutDoorwaysInto } from './world/doorwayCutter';
import { arenaLocation, buildDressing, parseDerivedWorld } from './world/dressing';
import { buildExterior } from './world/exterior';
import { fetchGlb } from './world/glbBytes';
import { applyWallHeightAdapter } from './world/presentation';
import type { Point2 } from './world/roomIndex';
import { createAnchorTriggers, parseCampusRooms, RoomTracker } from './world/roomIndex';
import { applyRoomNaming } from './world/roomNaming';
import { AUTHORED_ROOM_IDS, authoredRoomScenes } from './world/rooms';
import { buildSigns } from './world/signage';
import { buildStadium } from './world/stadium';
import { buildTurnstiles } from './world/turnstiles';

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
    // Decide the starting phase before creating the player so the first rendered physics frame
    // already places lobby users on the south side of the turnstile.
    const query = new URLSearchParams(window.location.search);
    const useLobby =
        (import.meta.env.PROD || !query.has('noLobby') || query.has('server')) &&
        (!navigator.webdriver || query.has('lobby') || import.meta.env.PROD);

    // Every download starts now, side by side: the big models (gzip copies), physics and the scene data.
    const campusBytes = fetchGlb(CAMPUS_ASSET_URL);
    const characterBytes = fetchGlb(CHARACTER_ASSET_URL);
    const ammoReady = waitForAmmo();
    // A failure is reported where it is awaited; until then it must not surface as an unhandled rejection.
    ammoReady.catch(() => undefined);
    const roomsJson = fetchJson('/assets/campus/rooms.json', '房间数据');
    const worldJson = fetchJson(DERIVED_WORLD_URL, '场景布置数据');
    worldJson.catch(() => undefined);
    // Room data first: the location plate and room tracker need it.
    const rooms = parseCampusRooms(await roomsJson);
    // Names and division from the 2026-08-06 model over FF-01 geometry (geometry and dressing keep the FF-01 list).
    const namedRooms = applyRoomNaming(rooms.rooms, ROOM_NAMING);
    const derivedWorld = parseDerivedWorld(await worldJson);
    const arena = arenaLocation(derivedWorld);
    ui = createUi();
    const shell = ui;

    shell.stage('physics', 'active');
    await ammoReady;
    shell.stage('physics', 'done');

    const canvas = document.getElementById('application-canvas') as HTMLCanvasElement;
    const device = await createGraphicsDevice(canvas);
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [
        RenderComponentSystem,
        AnimComponentSystem,
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
        loadCampus(app, () => undefined, await campusBytes),
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
    const collisions = addCampusCollisions(app, campus.root, derivedWorld.arena);
    shell.stage('structure', 'done');

    shell.stage('dressing', 'active');
    const dressing = buildDressing(app, campus.root, derivedWorld, rooms.rooms, ceilingMask, AUTHORED_ROOM_IDS);
    const authoredScenes = authoredRoomScenes();
    for (const scene of authoredScenes) buildAuthoredRoom(app, campus.root, scene);
    buildSigns(app, campus.root, derivedWorld, namedRooms);
    // The rebuilt 莲花球场 (decoration only; colliders unchanged) and its spectator seats.
    const stadium = buildStadium(app, campus.root, campus.root, derivedWorld.arena);
    // The campus seen from outside (roof, south gate, street, lawn) for the entry flyover.
    buildExterior(app, campus.root, namedRooms);
    const turnstiles = buildTurnstiles(app, campus.root);
    const { player, camera } = createPlayer(app, useLobby ? SOUTH_GATE.spawn : SAFE_SPAWN);
    const stepAssist = createStepAssist(app, player, camera);
    const intro = createIntro(app, camera, shell);
    // South gate: players wait in the indoor vestibule outside the turnstiles, then join by walking through.
    // Automated browsers can explicitly bypass this with ?noLobby=1 for deterministic in-world fixtures.
    let gateState: GateState = useLobby ? 'lobby' : 'inside';
    /** Set on the first entry; the gate only runs once the player is in the world. */
    let gateLive = false;
    const safeSpot = () => (gateState === 'lobby' ? SOUTH_GATE.spawn : undefined);
    shell.stage('characters', 'active');
    const [characters, pickupAssets] = await Promise.all([
        characterBytes.then((bytes) => CharacterAssetLoader.load(app, bytes)),
        PickupAssetLoader.load(app)
    ]);
    shell.stage('characters', 'done');
    const atmosphere = setupAtmosphere(app, camera);
    const { sun, setNight } = atmosphere;
    let night = false;
    const audioLab = import.meta.env.DEV && new URLSearchParams(window.location.search).get('audioLab') === '1';
    const serverUrl =
        audioLab && !new URLSearchParams(window.location.search).has('server')
            ? null
            : multiplayerUrl(window.location.search, import.meta.env.PROD, window.location.hostname);
    const auth = createAuth(apiBase(serverUrl));
    const audioLabEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('audioLab') === '1';
    shell.accountsAvailable(auth.available, audioLabEnabled);
    const match = createMatch({
        app,
        player,
        camera,
        canvas,
        ui: shell,
        url: serverUrl,
        auth,
        pickupAssets,
        arenaCenter: derivedWorld.arena.center as [number, number],
        arenaOutline: derivedWorld.arena.outline,
        characters,
        mirrors: dressing.mirrors,
        mirrorLayer: dressing.mirrorLayer,
        stadiumSeats: stadium.seats
    });
    // Title data: saved session, the standing 淘汰王 and the online count (when a server is configured).
    if (auth.available) {
        void auth
            .restore()
            .then((account) => shell.account(account))
            .catch((error: Error) =>
                shell.authError(`暂时无法恢复登录状态：${error.message}。已保留本地会话，请稍后刷新。`)
            );
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
    match.setFeedbackSettings(settings);

    // The exploration log was removed; drop what older versions saved.
    storage?.removeItem('moonshot-open-world.discovered.v1');

    const rigidbodySystem = app.systems.rigidbody as RigidBodyComponentSystem;
    const anchorPositions = new Map<string, Point2>();
    for (const room of namedRooms) {
        if (room.hasRegion) continue;
        const anchor = campus.root.findByName(`Label_${room.id}`);
        if (anchor) anchorPositions.set(room.id, [anchor.getPosition().x, anchor.getPosition().z]);
    }
    const anchors = createAnchorTriggers(namedRooms, anchorPositions, LABEL_ONLY_TRIGGER_RADIUS);
    const roomTracker = new RoomTracker(
        namedRooms.filter((room) => room.hasRegion),
        (location) => {
            shell.setLocation(location);
            match.enteredRoom(location?.id ?? null, location?.kind ?? null);
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
    let previousFinisherLocked = false;
    let closeChat: (() => void) | null = null;
    let stuckAt: [number, number] = [0, 0];
    const escapeStuck = () => {
        if (match.executing || match.detained) return;
        stuck.reset();
        stuckShown = false;
        shell.stuck(false);
        recoverPlayer(player, safeSpot());
        match.teleported();
        shell.notify(gateState === 'lobby' ? '已脱离卡死，回到南门门厅' : '已脱离卡死，回到南入口');
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
            recoverPlayer(player, safeSpot());
            match.teleported();
            shell.notify('已离开可探索范围，已回到南入口');
            return;
        }
        if (gateLive) {
            const gate = stepGate(gateState, position.x, position.z);
            turnstiles.set(gate.open, gate.light);
            if (gate.joined) {
                match.joinRound();
                if (!match.online) {
                    gateState = 'inside';
                    shell.notify('已通过闸机 · 加入本局');
                }
            }
            if (match.phase === 'playing') gateState = 'inside';
        }
        stepAssist.update(deltaTime);
        roomTracker.update([position.x, position.z], deltaTime);
        if (document.pointerLockElement === canvas && match.alive) {
            const isStuck = stuck.update(
                deltaTime,
                performance.now() / 1000,
                [position.x, position.y, position.z],
                moveKeys.size > 0,
                match.detained
            );
            if (match.detained && stuckShown) {
                stuckShown = false;
                shell.stuck(false);
            } else if (isStuck && !stuckShown) {
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
            setNight(night);
        }
        atmosphere.update(deltaTime);
        sun.light!.intensity += ((night ? 0.04 : 0.55) - sun.light!.intensity) * Math.min(1, deltaTime * 6);
        lightPool.update(deltaTime, position);
        match.update(deltaTime);
        if (match.finisherLocked !== previousFinisherLocked) {
            previousFinisherLocked = match.finisherLocked;
            moveKeys.clear();
            if (previousFinisherLocked) clearVelocity();
        }
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
        // Resume synchronously from the button gesture before auth or pointer-lock flows.
        void match.unlockAudio().catch((error: Error) => shell.notify(`音频未能开启：${error.message}。请再点击进入校园`));
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
        if (gateState === 'lobby') {
            shell.notify('先穿过南门闸机加入本局');
            return;
        }
        if (match.executing) {
            shell.notify('处决动画期间无法传送');
            return;
        }
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
        match.teleported();
        shell.notify('已传送到莲花球场');
    };
    let hasEntered = false;
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === canvas) {
            match.homepageMusic(false);
            if (!hasEntered) {
                if (gateState === 'lobby') {
                    // Wait in the vestibule; the multiplayer room tracks lobby poses and chat before round entry.
                    recoverPlayer(player, SOUTH_GATE.spawn);
                    shell.notify('南门待机：穿过闸机即加入正在进行的这一局');
                }
                match.start('', gateState === 'lobby' ? 'lobby' : 'playing');
                gateLive = true;
                // First entry: the flyover over the campus and through the south gate, input held until it ends.
                // Automated browsers skip it (tests drive input at once) unless ?intro=1 asks for it.
                const query = new URLSearchParams(window.location.search);
                if (!query.has('noIntro') && (!navigator.webdriver || query.has('intro'))) {
                    match.setInputPaused(true);
                    match.setIntroPlaying(true);
                    intro.play(() => {
                        match.setIntroPlaying(false);
                        match.setInputPaused(false);
                    });
                }
            }
            hasEntered = true;
            rigidbodySystem.timeScale = 1;
            shell.playing();
        } else if (hasEntered) {
            clearVelocity();
            rigidbodySystem.timeScale = 0;
            if (match.finisherLocked) return;
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
        if (match.finisherLocked) return;
        if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pause();
    });
    window.addEventListener(
        'keydown',
        (event) => {
            if (match.finisherLocked) {
                if (event.code !== 'Escape') {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
                return;
            }
            if (shell.chatOpen()) return; // typing in the chat box
            if (
                event.code === 'Enter' &&
                !event.repeat &&
                document.pointerLockElement === canvas &&
                match.activateActiveSkill()
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
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
    shell.stage('audio', 'active');
    await Promise.all([
        match.prewarm(),
        match.preloadAudio((completed, total) =>
            shell.stage('audio', 'active', { completed, total })
        )
    ]);
    shell.stage('audio', 'done');
    shell.ready(
        {
            activateHome: async () => {
                await match.unlockAudio();
                match.homepageMusic(true);
            },
            enter,
            settingsChanged: (next) => {
                applySettings(player, camera, next);
                match.setView(next.fieldOfView, next.lookSensitivity);
                match.setFeedbackSettings(next);
                saveSettings(storage, next);
            },
            logout: async () => {
                await auth.logout();
                shell.account(null);
            },
            uploadAvatar: (image) => auth.uploadAvatar(image),
            deleteAvatar: () => auth.deleteAvatar(),
            avatarUrl: (id, version) => auth.avatarUrl(id, version),
            setLocalTestAvatar: (image) => match.setTrainingDummyAvatar(image),
            loadBoard: async () => {
                const board = await auth.board();
                shell.king(board.king);
                return board;
            }
        },
        settings
    );
    // Music downloads in the background once the title screen is up (it never holds up loading).
    void match.prefetchMusic();

    if (import.meta.env.PROD) watchForUpdates(__BUILD_ID__, () => shell.updateAvailable());

    if (import.meta.env.DEV) {
        installDebugHooks({
            ui: shell,
            perf: () => {
                const stats = (
                    app.graphicsDevice as unknown as { _shaderStats: { linked: number; compileTime: number } }
                )._shaderStats;
                const shaders = (app.graphicsDevice as unknown as { shaders: { name: string }[] }).shaders;
                const drawCallsPerFrame = (app.graphicsDevice as unknown as { _drawCallsPerFrame: number })
                    ._drawCallsPerFrame;
                return {
                    shadersLinked: stats.linked,
                    compileMs: stats.compileTime,
                    shaders: shaders.map((shader) => shader.name),
                    drawCallsPerFrame
                };
            },
            position: () => player.getPosition().toArray(),
            fov: () => camera.camera!.fov,
            cameraAngles: () => camera.getEulerAngles().toArray(),
            recover: () => {
                recoverPlayer(player, safeSpot());
                match.teleported();
            },
            collisionCount: collisions.sourceBodies,
            barrierWalls: collisions.barrierWalls,
            dressing: {
                doors: dressing.doors,
                furniture: dressing.furniture,
                lights: dressing.lights,
                mirrors: dressing.mirrors.map(({ roomId, position, yaw, normal }) => ({
                    roomId,
                    position,
                    yaw,
                    normal
                }))
            },
            teleport: (x: number, y: number, z: number) => {
                player.rigidbody!.teleport(x, y, z, 0, 0, 0);
                clearVelocity();
                match.teleported();
            },
            recoveries: () => recoveries,
            setLook: (pitch: number, yaw: number) => setLook(player, pitch, yaw),
            stuckShown: () => stuckShown,
            raycast: (from: number[], to: number[]) =>
                rigidbodySystem.raycastFirst(new Vec3(from[0], from[1], from[2]), new Vec3(to[0], to[1], to[2]))?.entity
                    .name ?? null,
            spawn: [
                useLobby ? SOUTH_GATE.spawn.x : SAFE_SPAWN.x,
                useLobby ? SOUTH_GATE.spawn.y : SAFE_SPAWN.y,
                useLobby ? SOUTH_GATE.spawn.z : SAFE_SPAWN.z
            ],
            roomId: () => roomTracker.current?.id ?? null,
            match: match.debug,
            sceneTransition: (relocate) => shell.arenaTransition(relocate),
            showRoundResult: (outcome, mine) =>
                shell.roundEnd({
                    outcome,
                    mine,
                    winner: mine ? '视觉验证玩家' : outcome === 'draw' ? null : '视觉验证玩家',
                    nextIn: 12
                }),
            lighting: () => ({
                skyNight: atmosphere.nightAmount(),
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
