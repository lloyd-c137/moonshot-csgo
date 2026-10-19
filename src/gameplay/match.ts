// The shared-world frisbee game: throwing input, the network session, other players, eliminations and respawns.
// Works offline as frisbee practice when no server is configured or reachable.
import type { AppBase, RigidBodyComponentSystem, Layer } from 'playcanvas';
import { BLEND_NORMAL, Color, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { CHARACTER_SOURCE_HEIGHT } from '../characters/CharacterAssetLoader';
import { PLAYER, SAFE_SPAWN } from '../config/gameplay';
import { ITEM_RULES, ITEM_SPAWNS, NPC_SPAWNS } from '../config/gameplayItems';
import type { ItemKind } from '../config/gameplayItems';
import { skinById } from '../config/skins';
import { SPAWN_POINTS } from '../config/spawns';
import { BREAKER_CABINET, SPECIAL_LOCATIONS } from '../config/specialLocations';
import { apiBase } from '../net/auth';
import type { Auth } from '../net/auth';
import { createNetClient } from '../net/client';
import type { NetState } from '../net/client';
import type { King, PlayerPose, PlayerSummary, RoundOutcome, RoundState, ThrowRecord, WorldItem } from '../net/protocol';
import {
    colourFor,
    AMMO,
    DETENTION_SECONDS,
    isHeadHit,
    MAX_HP,
    RESPAWN_SECONDS,
    ROUND,
    SNIPER,
    SPAWN_PROTECTION,
    THROW_COOLDOWN
} from '../net/protocol';
import { PARAPET_BARRIER_ENTITY_NAME } from '../physics/collisionWorld';
import { setLook } from '../player/playerController';
import { box, merge, place, torus } from '../render/shapes';
import { createSkinLibrary } from '../render/skinDisc';
import type { AudioLabUi } from '../ui/audioLab';
import { killIcons } from '../ui/killFeed';
import type { EventIcon, Ui } from '../ui/shell';
import type { RestroomMirrorMount } from '../world/dressing';
import type { SeatSlot } from '../world/stadiumLayout';
import { fanSectionFocus, ringRadii } from '../world/stadiumLayout';

import { createAvatars } from './avatars';
import { createBreakerView } from './breakerView';
import { CEREMONY, featuredEntrantAt, planCeremony } from './ceremony/ceremonyPlan';
import type { CeremonyPlan, Entrant } from './ceremony/ceremonyPlan';
import { createCeremonyView } from './ceremony/ceremonyView';
import {
    aimTarget,
    endsRound,
    FINAL_SLOW_MOTION,
    HIT_STOP_MS
} from './combatFeel';
import { activeCutscene, CUTSCENE_CAPTIONS, cutsceneShot } from './cutscenes/cutscenes';
import type { CutsceneKind, MomentCutscene } from './cutscenes/cutscenes';
import { createCutsceneView } from './cutscenes/cutsceneView';
import { createDiscs, hueColour } from './discs';
import { createEffects } from './effects';
import { canStartGlobalFinisher, executionProgress, executionWatched } from './execution';
import type { Execution } from './execution';
import { createExecutionView } from './executionView';
import { CameraImpulseController } from './feedback/CameraImpulseController';
import type { CameraMotion } from './feedback/CameraImpulseController';
import { CombatFeedbackDirector } from './feedback/CombatFeedbackDirector';
import type { GlobalFinisher } from './finisher/FinisherTypes';
import { GLOBAL_FINISHER_CONFIG } from './finisher/FinisherTypes';
import type { DiscContact, V3 } from './frisbee';
import { chargeSpeed, DISC, launchNormal, THROW } from './frisbee';
import { createGold, GOLD_COLOUR } from './gold';
import { createGroundDiscs } from './groundDiscs';
import { guardAt } from './guard';
import { createGuard } from './guardView';
import {
    airborne,
    CATCH_AT,
    GOLD_CATCH_AT,
    GOLD_INSPECT_SECONDS,
    GOLD_TOSS_AT,
    goldAirborne,
    goldInspectPose,
    INSPECT_SECONDS,
    inspectPose,
    TOSS_AT
} from './inspect';
import { createMedalTracker } from './medals';
import { createMvpView, MVP } from './mvp/mvpView';
import type { PickupAssetLoader } from './pickupAssetLoader';
import { createPickupVisual } from './pickupVisuals';
import { nearBreaker, powerOut, powerPhase } from './power';
import type { PowerState } from './power';
import { createRestroomMirrors } from './restroomMirrors';
import { aimProgress, aimReady, fovFactor, SCOPE, sensitivityFactor } from './scope';
import { createSkinEffects } from './skinEffects';
import { createSound } from './sound';
import { createStands } from './stands';
import type { Emote } from './stands';
import { TEACHER } from './teacher';
import { createTeacher } from './teacherView';

type Options = {
    app: AppBase;
    player: Entity;
    camera: Entity;
    canvas: HTMLCanvasElement;
    ui: Ui;
    url: string | null;
    auth: Auth;
    pickupAssets: PickupAssetLoader;
    /** Middle of the 莲花球场 (X/Z): the final showdown is fought there. */
    arenaCenter: [number, number];
    /** The arena's derived outline (X/Z), for the final ceremony's entrances. */
    arenaOutline: readonly (readonly [number, number])[];
    characters: CharacterAssetLoader;
    mirrors: RestroomMirrorMount[];
    mirrorLayer: Layer;
    /** Spectator seats in the rebuilt 莲花球场's upper bowl (world/stadium.ts). */
    stadiumSeats: readonly SeatSlot[];
};

const globalExecution = (finisher: GlobalFinisher): Execution => ({
    id: finisher.id,
    attacker: finisher.attacker,
    target: finisher.target,
    startsAt: finisher.startsAt,
    endsAt: finisher.endsAt,
    cameraPlanId: finisher.cameraPlanId,
    variant: finisher.variant
});


type SkillKind = 'revive' | 'frc' | 'eye' | 'stealth' | 'creation' | 'flashlight' | 'coach';
const SKILL_KINDS = ['revive', 'frc', 'eye', 'stealth', 'creation', 'flashlight', 'coach'] as const;
/** How each skill looks and reads when someone gets it. */
const SKILL_META: Record<SkillKind, { name: string; detail: string; colour: string; rgb: [number, number, number]; icon: EventIcon; has: (p: PlayerSummary) => boolean }> = {
    revive: { name: '复活甲', detail: '被淘汰时满血复活一次', colour: '#3ee69c', rgb: [0.24, 0.9, 0.61], icon: 'revive', has: (p) => p.hasReviveArmor === true },
    frc: { name: 'FRC 飞盘', detail: 'Enter 切换红色科技盘', colour: '#ff4d5e', rgb: [1, 0.3, 0.37], icon: 'frc', has: (p) => p.hasFrc === true },
    eye: { name: '监控室之眼', detail: '全场玩家位置已标记', colour: '#2ee6d6', rgb: [0.18, 0.9, 0.84], icon: 'eye', has: (p) => p.hasEye === true },
    stealth: { name: '请假条', detail: 'Enter 发动 · 隐身 3 秒', colour: '#55c9ff', rgb: [0.25, 0.72, 1], icon: 'stealth', has: (p) => p.hasStealth === true },
    creation: { name: '创造之力', detail: '每 30 秒自动补充一张飞盘', colour: '#ffc21a', rgb: [1, 0.76, 0.1], icon: 'creation', has: (p) => p.hasCreation === true },
    flashlight: { name: '手电筒', detail: '照亮视线前方区域', colour: '#ffe19a', rgb: [1, 0.86, 0.55], icon: 'flashlight', has: (p) => p.hasFlashlight === true },
    coach: { name: '飞盘天赋', detail: '携带上限提升至 5', colour: '#ffc21a', rgb: [1, 0.76, 0.1], icon: 'coach', has: (p) => p.coachGift === true }
};
export const createMatch = ({
    app,
    player,
    camera,
    canvas,
    ui,
    url,
    auth,
    pickupAssets,
    arenaCenter,
    arenaOutline,
    characters,
    mirrors,
    mirrorLayer,
    stadiumSeats
}: Options) => {
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const discs = createDiscs(app, PLAYER.gravity);
    const skinLibrary = createSkinLibrary(app);
    discs.skins = skinLibrary;
    const avatars = createAvatars(app, camera, ui.nameTagLayer(), characters, (id, version) =>
        auth.avatarUrl(id, version)
    );
    for (const npc of NPC_SPAWNS) avatars.add(npc.id, npc.name, npc.hue);
    const roster = new Map<string, PlayerSummary>();
    const stands = createStands(app, characters, stadiumSeats);
    const restroomMirrors = createRestroomMirrors(
        app,
        camera,
        mirrors,
        mirrorLayer,
        characters,
        auth,
        () => roster.get('local')?.colour ?? colourFor('local')
    );
    let netState: NetState = 'offline';
    let alive = true;
    let deadUntil = 0;
    let chargingSince: number | null = null;
    /** Current sniper aim (0–1): follows the held charge, falls back quickly on release or cancel. */
    let aim = 0;
    let aimSoundPlayed = false;
    let aimReadyPlayed = false;
    /** Normal view settings (the scope scales these), set from the player's settings. */
    let viewFov = camera.camera!.fov;
    let stealthViewBlend = 0;
    let viewSens = 0.08;
    let walkSpeed: number | null = null;
    /** When the current weapon inspect started (performance.now ms), or null. */
    let inspectSince: number | null = null;
    /** Debug only: holds the inspect at a fixed progress (0–1) for screenshots. */
    let inspectHold: number | null = null;
    /** Debug only: holds the sniper aim at a fixed level for screenshots. */
    let aimHold: number | null = null;
    let lastThrowAt = -Infinity;
    let throwCounter = 0;
    const localFrcThrows = new Set<number>();
    let started = false;
    /** A welcome snapshot seeks audio and visuals to authoritative room time instead of replaying opening cues. */
    let welcomeSyncPending = false;
    let playerPhase: 'lobby' | 'playing' = 'playing';
    let worldItems: WorldItem[] = ITEM_SPAWNS.map((spawn) => ({
        id: spawn.id,
        kind: spawn.kind,
        name: spawn.name,
        at: [...spawn.at],
        holder: null,
        available: spawn.kind !== 'creation',
        returnAt: null,
        cooldownUntil: 0
    }));
    const localAbilities = { revive: false, reviveUsed: false, reviveTaken: false, frc: false, eye: false, stealth: false, creation: false, flashlight: false, coach: false };
    let localMarkGiven = false;
    let localFrcSelected = false;
    let localFrcCooldownUntil = 0;
    let localStealthUntil = 0;
    let localStealthCooldownUntil = 0;
    let localAmmoCapacity: number = AMMO.max;
    let creationNextAt = 0;
    const pickupMeshes = new Map<string, Entity>();
    for (const spawn of ITEM_SPAWNS) {
        const entity = createPickupVisual(app, spawn.kind, pickupAssets);
        entity.setPosition(...spawn.at);
        pickupMeshes.set(spawn.id, entity);
    }
    const applyWorldItems = (next: WorldItem[]) => {
        worldItems = next;
        for (const spawn of ITEM_SPAWNS) {
            const item = worldItems.find((candidate) => candidate.id === spawn.id);
            const mesh = pickupMeshes.get(spawn.id);
            if (!item || !mesh) continue;
            mesh.enabled = item.available;
            mesh.setPosition(...item.at);
        }
    };
    let lastJoinRoundRequestAt = -Infinity;
    let throws = 0;
    let hitsClaimed = 0;
    let hitsPredicted = 0;
    const pendingHitClaims = new Map<number, number>();
    let killer = '';
    let hp = MAX_HP;
    const sound = createSound();
    const effects = createEffects(app);
    const skinFx = createSkinEffects(effects);
    /** Developer preview of a skin offline (?skin=magma&skinKills=12, dev builds only). */
    const previewSkin = (() => {
        if (!import.meta.env.DEV) return null;
        const params = new URLSearchParams(window.location.search);
        const id = params.get('skin');
        return skinById(id) ? { skin: id!, skinCounter: params.get('skinCounter') !== '0', skinKills: Number(params.get('skinKills') ?? 0) || 0 } : null;
    })();
    /** The local player's equipped skin (from the room's summary of us; the dev preview offline). */
    const localSkin = (): { skin: string; counter: boolean; kills: number } | null => {
        const me = roster.get(selfId());
        const source = me?.skin ? me : net.state === 'online' ? null : previewSkin;
        return source?.skin ? { skin: source.skin, counter: source.skinCounter === true, kills: source.skinKills ?? 0 } : null;
    };
    let shownSkinKey = '';
    /** Refreshes the viewmodel and the 计数器 HUD when our skin (or its count) changed. */
    const refreshLocalSkin = () => {
        const mine = localSkin();
        const key = mine ? `${mine.skin}:${mine.counter}` : '';
        ui.skinCounter(mine?.counter ? { skin: mine.skin, kills: mine.kills } : null);
        if (mine?.counter) skinLibrary.setLocalKills(mine.kills);
        if (key === shownSkinKey) return;
        shownSkinKey = key;
        if (viewmodelSkin === 'normal') setViewmodelSkin('normal', true);
    };
    const feedback = new CombatFeedbackDirector();
    const cameraImpulses = new CameraImpulseController();
    let executionFrozen = false;
    let globalFinisher: GlobalFinisher | null = null;
    let finisherRequestId: string | null = null;
    let finisherHoldTarget: string | null = null;
    let finisherHoldStartedAt: number | null = null;
    let finisherCommitSent = false;
    const executionView = createExecutionView(
        app,
        camera,
        characters,
        discs.mesh,
        (active) => {
            executionFrozen = active;
            const script = controller();
            if (script) script.enabled = alive && !inputPaused && !spectating && !active;
            if (!globalFinisher) {
                player.rigidbody!.linearVelocity = Vec3.ZERO;
                player.rigidbody!.angularVelocity = Vec3.ZERO;
            }
            player.rigidbody!.enabled = !spectating && (!active || !!globalFinisher);
            rigidbody.timeScale = active ? 0 : document.pointerLockElement === canvas ? 1 : 0;
            if (active) {
                cancelCharge();
                inspectSince = null;
            }
        },
        {
            // The strike: a full elimination burst, a wide shock ring, the impact boom and the screen flash.
            impact: (at, record) => {
                const gold = record.variant === 'THE_BOOMERANG_GOLD';
                effects.burst(at, gold ? 45 : record.attacker.colour, 'out');
                effects.ring(at, gold ? GOLD_COLOUR : [1, 1, 1], 0.25, 0.55, 3.2);
                sound.impact(at);
                sound.hitConfirm(true, true);
                ui.finisherImpact();
            },
            // The disc's glowing trail through its pattern.
            trail: (at, gold) => effects.tracer(at, gold ? -1 : 200, 20)
        }
    );
    // GAMEPLAY_AUTHORED fixed local dummy four metres north of the south-entrance spawn.
    const audioLab = import.meta.env.DEV && new URLSearchParams(window.location.search).get('audioLab') === '1';
    let labNightOverride = false;
    /** Room time the test panel turned the night on (the guard and the cutscene run from it). */
    let labNightAt: number | null = null;
    let labFinalOverride = false;
    let labFinalAfterCeremony = false;
    let labPowerOverride: PowerState | null = null;
    let labMomentCutscene: MomentCutscene | null = null;
    const labTargetId = 'audio-lab-target';
    const labTargetPose: PlayerPose = { p: [SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z - 4], yaw: 0, pitch: 0 };
    let labHp: number = MAX_HP;
    let labAvatarImage: HTMLImageElement | null = null;
    let labDummyHeight = 2.1;
    let labRespawnAt = 0;
    let labExecution: Execution | null = null;
    let labGolden = false;
    let labUi: AudioLabUi | undefined;
    let simulateDummyHit: (scenario: 'body' | 'head' | 'elimination' | 'golden' | 'execution' | 'frc') => void = () =>
        undefined;
    const setRoundTestClock = async (remainingSeconds: number) => {
        const base = import.meta.env.DEV ? apiBase(url) : null;
        if (!base || !auth.token) return false;
        try {
            const response = await fetch(`${base}/api/__test/round-clock`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
                body: JSON.stringify({ remainingSeconds })
            });
            return response.ok;
        } catch {
            return false;
        }
    };
    if (audioLab) {
        void import('../ui/audioLab').then(async ({ mountAudioLab }) => {
            labUi = await mountAudioLab({
                sound,
                canvas,
                setGolden: (value) => {
                    labGolden = value;
                },
                setDummyScale: (scale) => {
                    labDummyHeight = CHARACTER_SOURCE_HEIGHT * scale;
                    avatars.setScale(labTargetId, scale);
                },
                setCameraKick: (scale) => cameraImpulses.setLabScale(scale),
                setEffectIntensity: (intensity) => effects.setLabIntensity(intensity),
                setTrailDensity: (density) => discs.setLabTrailDensity(density),
                setTrailLength: (seconds) => effects.setLabTrailLength(seconds),
                setHudDuration: (scale) => ui.combatHudDuration(scale),
                setSimulatedRtt: (milliseconds) => net.setSimulatedRtt(milliseconds),
                getCameraKick: () => cameraImpulses.scale,
                getEffectIntensity: () => effects.intensity(),
                getTrailDensity: () => discs.trailDensity,
                getTrailLength: () => effects.trailLength(),
                getHudDuration: () => ui.combatHudDuration(),
                getSimulatedRtt: () => net.simulatedRtt,
                simulateDummyHit: (scenario) => simulateDummyHit(scenario),
                simulateBlackout: async () => {
                    if (await setRoundTestClock(ROUND.blackoutSecondsLeft)) return 'server';
                    labNightOverride = true;
                    labNightAt = roomNow();
                    return 'local';
                },
                simulateFinalShowdown: async () => {
                    if (await setRoundTestClock(ROUND.finalSecondsLeft + CEREMONY.seconds)) {
                        labFinalOverride = false;
                        labFinalAfterCeremony = false;
                        return 'server';
                    }
                    labFinalAfterCeremony = true;
                    playLabCeremony(4);
                    return 'local';
                },
                /** The final ceremony seen as a spectator: you are out, roaming the sealed stands with the crowd. */
                simulateFanCeremony: () => {
                    labFan = true;
                    if (!spectating) startSpectating('测试：看台观众');
                    playLabCeremony(4, true);
                },
                simulateBreaker: () => {
                    labPowerOverride = { pulledAt: roomNow() };
                },
                simulateMomentCutscene: (kind) => {
                    const p = pose().p;
                    const target = labTargetPose.p;
                    labMomentCutscene = {
                        id: `lab-${kind}-${performance.now()}`,
                        kind,
                        at: roomNow(),
                        focus: [p[0], p[1], p[2]],
                        secondary: [target[0], target[1], target[2]]
                    };
                },
                resetTestMechanics: () => {
                    labNightOverride = false;
                    labNightAt = null;
                    labFinalOverride = false;
                    labFinalAfterCeremony = false;
                    labPowerOverride = null;
                    labMomentCutscene = null;
                    finalRelocationResult = 'idle';
                },
                simulateRoundResult: (outcome, mine) => {
                    const now = performance.now();
                    const presentation = feedback.submit(
                        { id: `lab-round:${outcome}:${now}`, kind: 'round-result' },
                        now
                    );
                    if (!presentation.accepted) return;
                    sound.roundEnd(mine, outcome);
                    labMvp = {
                        at: roomNow(),
                        outcome,
                        entry: {
                            id: mine ? selfId() : 'mvp-stand-in',
                            name: mine ? nickname || '你' : '测试对手',
                            phase: 'playing',
                            account: false,
                            colour: mine ? colourFor('local') : 200,
                            alive: true,
                            hp: MAX_HP,
                            score: 12,
                            kills: 7,
                            deaths: 2,
                            hasReviveArmor: true
                        }
                    };
                    ui.roundEnd({
                        winner: outcome === 'draw' ? null : mine ? nickname || '你' : '测试对手',
                        mine,
                        outcome,
                        nextIn: 8
                    });
                },
                position: () => {
                    const p = camera.getPosition();
                    return [p.x, p.y, p.z];
                },
                range: () => {
                    player.rigidbody!.teleport(labTargetPose.p[0], labTargetPose.p[1], labTargetPose.p[2] + 1.1);
                    player.rigidbody!.linearVelocity = Vec3.ZERO;
                    player.rigidbody!.angularVelocity = Vec3.ZERO;
                    setLook(player, 0, 0);
                    ui.notify('固定人偶在你正前方；靠近背后按 V 可处决。飞盘命中测试和 P 音效面板也可用。');
                }
            });
        });
    }
    let king: King | null = null;
    // The round, the golden disc and 纪老师.
    const goldView = createGold(app, effects);
    discs.goldMaterial = goldView.material;
    discs.goldMesh = goldView.mesh;
    avatars.goldMesh = goldView.mesh;
    avatars.goldMaterial = goldView.material;
    const teacher = createTeacher(app, camera, ui.nameTagLayer(), characters);
    let roundState: RoundState | null = null;
    // Disc ammunition (online): discs in hand; thrown ones lie where they land until someone picks them up.
    const ground = createGroundDiscs(app, discs.mesh);
    let ammo: number = AMMO.start;
    let inWatch = false;
    const hasDisc = () => net.state !== 'online' || holdingGold() || localFrcSelected || ammo > 0;
    /** performance.now() when the local player may move again after being caught by 纪老师. */
    let detainedUntil = 0;
    let detentionShown = false;
    let speeds: { ground: number; air: number; jump: number } | null = null;
    let warming = false;
    /** Whether the current inspect is the golden disc's (it has its own, longer routine). */
    let goldInspect = false;
    let goldSparkAt = 0;
    let viewmodelSkin: 'normal' | 'frc' | 'gold' = 'normal';
    const guard = createGuard(app, camera, ui.nameTagLayer(), characters);
    const breakerView = createBreakerView(app);
    let power: PowerState = { pulledAt: null };
    let wasPowerOut = false;
    let teacherGraceUntil = 0;
    // Final showdown floodlights over the 莲花球场, and a light that follows the golden disc in the dark.
    const floodlights = [0, 1, 2, 3, 4, 5].map((i) => {
        const light = new Entity('arena-floodlight');
        light.addComponent('light', {
            type: 'omni',
            color: new Color(1, 0.97, 0.9),
            intensity: 0,
            range: 22,
            castShadows: false
        });
        const a = (i / 6) * Math.PI * 2;
        light.setPosition(arenaCenter[0] + Math.cos(a) * 9, 9, arenaCenter[1] + Math.sin(a) * 9);
        app.root.addChild(light);
        return light;
    });
    const goldLight = new Entity('gold-light');
    goldLight.addComponent('light', {
        type: 'omni',
        color: new Color(1, 0.8, 0.35),
        intensity: 0,
        range: 9,
        castShadows: false
    });
    app.root.addChild(goldLight);
    let finalDone = false;
    /** Set while the opening flyover plays (main.ts). */
    let introBeamHidden = false;
    // ---------- final-minute entrance ceremony ----------
    const ceremony = createCeremonyView(
        app,
        camera,
        characters,
        { outline: arenaOutline, center: arenaCenter },
        (at, colour, velocity, size, life, gravity) => effects.mote(at, colour, velocity, size, life, gravity)
    );
    // ---------- fans: players out for the round walk the upper bowl (final ceremony and minute) ----------
    let fanMode = false;
    const NO_IDS: readonly string[] = [];
    /** Every roster id (hidden while the ceremony or MVP film owns the stage); one set reused across frames. */
    const everyoneHiddenSet = new Set<string>();
    const everyoneHidden = () => {
        everyoneHiddenSet.clear();
        for (const id of roster.keys()) everyoneHiddenSet.add(id);
        return everyoneHiddenSet;
    };
    /** Middle of the fans' section in the stands (the ceremony films the crowd there). */
    const fanFocus = fanSectionFocus(ringRadii(arenaOutline, arenaCenter), arenaCenter);
    // Looked up once (a scene-graph search every frame is wasteful); retried until the arena has loaded.
    let parapetEntity: Entity | null = null;
    const parapetSeal = () =>
        parapetEntity ?? (parapetEntity = app.root.findByName(PARAPET_BARRIER_ENTITY_NAME) as Entity | null);
    /** From the start of the final ceremony to the end of the round. */
    const standsOpenNow = () =>
        !!ceremonyRun ||
        labCeremony !== null ||
        inFinalMinute() ||
        (roundState?.phase === 'playing' &&
            roomNow() >= roundState.endsAt - (ROUND.finalSecondsLeft + CEREMONY.seconds) * 1000);
    const enterFanMode = () => {
        fanMode = true;
        const seat = stands.seatOf(selfId()) ?? stadiumSeats[0];
        player.rigidbody!.enabled = true;
        player.rigidbody!.teleport(seat.x, seat.y + 0.95, seat.z, 0, 0, 0);
        player.rigidbody!.linearVelocity = Vec3.ZERO;
        setLook(player, 0, (Math.atan2(-(arenaCenter[0] - seat.x), -(arenaCenter[1] - seat.z)) * 180) / Math.PI);
        teleportPending = true;
        const script = controller();
        if (script) script.enabled = !inputPaused;
        ui.spectate({ reason: '看台自由活动 · 1 欢呼 · 2 挥应援棒 · 3 撒彩带', watching: null });
    };
    const leaveFanMode = () => {
        fanMode = false;
        if (!spectating) return;
        const script = controller();
        if (script) script.enabled = false;
        if (player.rigidbody) player.rigidbody.enabled = false;
    };
    let ceremonyRun: { at: number; plan: CeremonyPlan; moved: boolean; lastPerf: number; t: number } | null = null;
    let ceremonyCardId: string | null = null;
    /** Test hook: a ceremony starting at this room time with these entrants (offline). */
    let labCeremony: { at: number; entrants: Entrant[] } | null = null;
    let shuttersShut = false;
    // ---------- end-of-round MVP ----------
    const mvpView = createMvpView(app, camera, characters, arenaCenter);
    let mvpRun: { at: number } | null = null;
    /** Test hook: an MVP sequence starting now for a stand-in result. */
    let labMvp: { at: number; entry: PlayerSummary; outcome: RoundOutcome } | null = null;
    const mvpResultLabel = (outcome: RoundOutcome) =>
        outcome === 'golden-disc' ? '金飞盘胜利' : outcome === 'last-survivor' ? '最后的幸存者' : '本局最高分';
    const startMvp = (at: number, entry: PlayerSummary, outcome: RoundOutcome) => {
        mvpRun = { at };
        const url = entry.avatarId && entry.avatarVersion ? auth.avatarUrl(entry.avatarId, entry.avatarVersion) : null;
        mvpView.start(hueColour(entry.colour), avatars.headImage(entry.id));
        if (url && !avatars.headImage(entry.id)) {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.src = url;
            void image.decode().then(() => mvpView.setHead(image), () => undefined);
        }
        const skill = SKILL_KINDS.map((kind) => SKILL_META[kind]).find((meta) => meta.has(entry))?.name ?? '—';
        ui.mvp({
            name: entry.id === selfId() ? `${entry.name}（你）` : entry.name,
            colour: `hsl(${entry.colour} 75% 52%)`,
            result: mvpResultLabel(outcome),
            avatar: url,
            stats: [
                { label: '淘汰', value: String(entry.kills) },
                { label: '被淘汰', value: String(entry.deaths) },
                { label: '得分', value: String(entry.score) },
                { label: '技能', value: skill }
            ],
            others: [...roster.values()]
                .filter((other) => other.id !== entry.id && other.phase === 'playing')
                .sort((a, b) => b.score - a.score)
                .slice(0, 3)
                .map((other) => ({ name: other.name, value: `${other.kills} 淘汰 · ${other.score} 分` }))
        });
        sound.ceremonyRing(2);
        inputPaused = true;
        chargingSince = null;
        ui.charge(null);
        const script = controller();
        if (script) script.enabled = false;
    };
    const stopMvp = () => {
        mvpRun = null;
        mvpView.stop();
        ui.mvp(null);
        ui.ceremony.fade(0);
        inputPaused = false;
        const script = controller();
        if (script) script.enabled = alive && !executionFrozen && !spectating;
    };
    // ---------- event cutscenes (lights out, breaker pulled) ----------
    const cutsceneView = createCutsceneView(app, camera);
    let currentMomentCutscene: MomentCutscene | null = null;
    let cutsceneRun: {
        kind: CutsceneKind;
        at: number;
        moment: MomentCutscene | null;
        skipped: boolean;
        lastPerf: number;
        beats: Set<string>;
    } | null = null;
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && cutsceneRun && !cutsceneRun.skipped) {
            cutsceneRun.skipped = true;
            if (cutsceneRun.moment) {
                if (net.state === 'online') net.skipMomentCutscene(cutsceneRun.moment.id);
                else if (labMomentCutscene?.id === cutsceneRun.moment.id) labMomentCutscene = null;
            }
            event.preventDefault();
        }
    });
    /** Test hook: watching the lab ceremony as a spectator in the stands (local only). */
    let labFan = false;
    const playLabCeremony = (others = 4, asFan = false) => {
        const names = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO'];
        labCeremony = {
            at: realRoomNow(),
            entrants: [
                ...(asFan ? [] : [{
                    id: selfId(), name: '你', kills: 2, deaths: 1, score: 240,
                    colour: hueColour(colourFor('local')), skill: '复活甲', equipment: '普通飞盘'
                }]),
                ...names.slice(0, others).map((name, i) => ({
                    id: `ceremony-${name}`,
                    name,
                    kills: [5, 3, 1, 0, 4, 2][i % 6],
                    deaths: i % 3,
                    score: [420, 310, 180, 90][i % 4],
                    colour: hueColour((i * 67 + 20) % 360),
                    skill: i % 3 === 0 ? '复活甲' : undefined,
                    equipment: i % 3 === 0 ? '普通飞盘 · FRC 飞盘' : '普通飞盘'
                }))
            ]
        };
    };

    let finalShown = false;
    let finalRelocationResult = 'idle';
    let floodlightTransitionAt = performance.now();
    let floodlightFrom = 0;
    let groundCap = 0;
    let goldThrowCount = 0;
    let goldCooldownUntil = 0;
    let dark = false;
    let wasNight = false;
    let spottedSent = false;
    /** Out for the rest of the round (after the lights went out): watching someone else. */
    let spectating = false;
    let watchIndex = 0;
    /** Room time when this round's lights go out, or null (no round / offline). */
    const blackoutAt = () =>
        audioLab && labNightOverride
            ? (labNightAt ?? roomNow())
            : roundState?.phase === 'playing'
              ? roundState.endsAt - ROUND.blackoutSecondsLeft * 1000
              : null;
    const currentPower = () => labPowerOverride ?? power;
    const goldHolder = () => goldView.state?.holder ?? null;
    const holdingGold = () => goldHolder() === selfId();
    const ceremonyLoadout = (entry: PlayerSummary) =>
        [goldHolder() === entry.id ? '金飞盘' : '普通飞盘', ...(entry.hasFrc ? ['FRC 飞盘'] : [])].join(' · ');
    const ceremonySkills = (entry: PlayerSummary) =>
        SKILL_KINDS.filter((kind) => kind !== 'frc' && SKILL_META[kind].has(entry))
            .map((kind) => SKILL_META[kind].name)
            .join(' · ');
    /** The game moved the local player itself since the last pose sent (recovery, return to the arena…). */
    let teleportPending = false;
    /** Real server clock drives networking and cinematic seeking; match clock stops during a global finisher. */
    let matchPausedAt: number | null = null;
    let matchClockOffset = 0;
    const realRoomNow = () => (net.state === 'online' ? (net.serverNow() ?? Date.now()) : Date.now());
    const roomNow = () => {
        const realNow = realRoomNow();
        return (matchPausedAt ?? realNow) - matchClockOffset;
    };
    let nickname = '';
    let inputPaused = false;
    let poses = new Map<string, PlayerPose>();
    const targets = new Map<string, V3>();
    /** Recent eliminations per killer, for streak announcements. */
    const streaks = new Map<string, { count: number; at: number }>();
    // Feel: FOV punch on release, damped local camera impulses, in-hand disc that winds up and snaps forward.
    let punch = 0;
    /** Combat feel 3.0: presentation-only hit-stop, final-kill slow motion and elimination marks. */
    let hitStopUntil = 0;
    let feelMotion: CameraMotion = 'low';
    const killMarks: { at: V3; until: number }[] = [];
    let slowMotionUntil = 0;
    let chargeFullPlayed = false;
    let aimCheckAt = 0;
    const eyeOffset = camera.getLocalPosition().clone();
    const viewmodel = new Entity('viewmodel-disc');
    viewmodel.addComponent('render', { meshInstances: discs.meshInstances(colourFor('local')), castShadows: false });
    viewmodel.enabled = false;
    viewmodel.setLocalScale(0.85, 0.85, 0.85);
    camera.addChild(viewmodel);
    const flashlightView = new Entity('viewmodel-flashlight');
    const flashlightBodyMaterial = new StandardMaterial();
    flashlightBodyMaterial.diffuse = new Color(0.08, 0.1, 0.13);
    flashlightBodyMaterial.update();
    flashlightView.addComponent('render', { type: 'cylinder', material: flashlightBodyMaterial, castShadows: false });
    flashlightView.setLocalScale(0.055, 0.18, 0.055);
    flashlightView.setLocalPosition(0.24, -0.2, -0.46);
    flashlightView.setLocalEulerAngles(90, 0, 0);
    flashlightView.enabled = false;
    camera.addChild(flashlightView);
    const flashlightLens = new Entity('viewmodel-flashlight-lens');
    const flashlightLensMaterial = new StandardMaterial();
    flashlightLensMaterial.useLighting = false;
    flashlightLensMaterial.diffuse = new Color(1, 0.94, 0.72);
    flashlightLensMaterial.emissive = new Color(1, 0.86, 0.5);
    flashlightLensMaterial.emissiveIntensity = 1.2;
    flashlightLensMaterial.update();
    flashlightLens.addComponent('render', { type: 'sphere', material: flashlightLensMaterial, castShadows: false });
    flashlightLens.setLocalScale(0.08, 0.04, 0.08);
    flashlightLens.setLocalPosition(0, 0.09, -0.02);
    flashlightView.addChild(flashlightLens);
    const flashlightBeam = new Entity('player-flashlight-beam');
    flashlightBeam.addComponent('light', {
        type: 'spot', color: new Color(1, 0.94, 0.76), intensity: 3.2, range: 17,
        innerConeAngle: 20, outerConeAngle: 38, castShadows: false
    });
    flashlightBeam.setLocalPosition(0.16, -0.1, -0.48);
    flashlightBeam.setLocalEulerAngles(90, 0, 0);
    flashlightBeam.enabled = false;
    camera.addChild(flashlightBeam);
    let viewmodelHue = -1;
    // A white racing stripe across the top (and a crossing one underneath) so the spin reads during an inspect.
    const stripeMesh = new Mesh(app.graphicsDevice);
    {
        const length = 2 * (DISC.radius - 0.03);
        const top = place(box(length, 0.002, 0.02), { y: 0.0145 });
        const under = place(box(0.02, 0.002, length * 0.8), { y: -0.0035 });
        stripeMesh.setPositions([...top.positions, ...under.positions]);
        stripeMesh.setNormals([...top.normals, ...under.normals]);
        stripeMesh.setIndices([...top.indices, ...under.indices.map((index) => index + top.positions.length / 3)]);
        stripeMesh.update();
    }
    const stripeMaterial = new StandardMaterial();
    stripeMaterial.diffuse = new Color(0.95, 0.96, 0.97);
    stripeMaterial.gloss = 0.6;
    stripeMaterial.update();
    const stripe = new Entity('viewmodel-stripe');
    stripe.addComponent('render', {
        meshInstances: [new MeshInstance(stripeMesh, stripeMaterial)],
        castShadows: false
    });
    viewmodel.addChild(stripe);
    const frcAuraShape = merge([
        place(torus(DISC.radius * 1.3, 0.006, 28, 6), { y: 0.024 }),
        ...Array.from({ length: 4 }, (_, index) => {
            const angle = index * Math.PI / 2;
            return place(box(0.075, 0.008, 0.014), {
                x: Math.cos(angle) * DISC.radius * 1.08,
                y: 0.025,
                z: Math.sin(angle) * DISC.radius * 1.08,
                yaw: -angle
            });
        })
    ]);
    const frcAuraMesh = new Mesh(app.graphicsDevice);
    frcAuraMesh.setPositions(frcAuraShape.positions);
    frcAuraMesh.setNormals(frcAuraShape.normals);
    frcAuraMesh.setIndices(frcAuraShape.indices);
    frcAuraMesh.update();
    const frcAuraMaterial = new StandardMaterial();
    frcAuraMaterial.useLighting = false;
    frcAuraMaterial.diffuse = new Color(0.08, 0.82, 1);
    frcAuraMaterial.emissive = new Color(0.08, 0.82, 1);
    frcAuraMaterial.emissiveIntensity = 1.5;
    frcAuraMaterial.update();
    const frcAura = new Entity('viewmodel-frc-aura');
    frcAura.addComponent('render', { meshInstances: [new MeshInstance(frcAuraMesh, frcAuraMaterial)], castShadows: false });
    frcAura.enabled = false;
    viewmodel.addChild(frcAura);
    // Afterimages trailing the disc while it is airborne during an inspect.
    const ghosts = [0.42, 0.26, 0.14].map((opacity) => {
        const material = new StandardMaterial();
        material.blendType = BLEND_NORMAL;
        material.opacity = opacity;
        material.depthWrite = false;
        material.update();
        const entity = new Entity('viewmodel-ghost');
        entity.addComponent('render', { meshInstances: [], castShadows: false });
        entity.enabled = false;
        entity.setLocalScale(0.85, 0.85, 0.85);
        camera.addChild(entity);
        return { entity, material };
    });
    const tintGhosts = (hue: number) => {
        const mesh = discs.meshInstances(hue)[0].mesh!;
        const colour = discs.meshInstances(hue)[0].material as StandardMaterial;
        for (const ghost of ghosts) {
            ghost.material.diffuse = colour.diffuse.clone();
            ghost.material.emissive = colour.diffuse.clone();
            ghost.material.emissiveIntensity = 0.35;
            ghost.material.update();
            ghost.entity.render!.meshInstances = [new MeshInstance(mesh, ghost.material)];
        }
    };
    const tintGhostsGold = () => {
        for (const ghost of ghosts) {
            ghost.material.diffuse.set(1, 0.74, 0.2);
            ghost.material.emissive.set(1, 0.62, 0.12);
            ghost.material.emissiveIntensity = 0.9;
            ghost.material.update();
            ghost.entity.render!.meshInstances = [new MeshInstance(goldView.mesh, ghost.material)];
        }
    };
    const viewmodelWorld = (): V3 => {
        const p = viewmodel.getPosition();
        return [p.x, p.y, p.z];
    };
    const setViewmodelSkin = (skin: 'normal' | 'frc' | 'gold', force = false) => {
        if (skin === viewmodelSkin && !force) return;
        viewmodelSkin = skin;
        if (skin === 'gold') {
            viewmodel.render!.meshInstances = [new MeshInstance(goldView.mesh, goldView.material)];
            stripeMaterial.diffuse.set(0.95, 0.96, 0.97);
            stripeMaterial.emissive.set(0, 0, 0);
            stripeMaterial.emissiveIntensity = 0;
            stripeMaterial.update();
            tintGhostsGold();
            return;
        }
        const hue = skin === 'frc' ? 0 : viewmodelHue < 0 ? colourFor('local') : viewmodelHue;
        const mine = skin === 'normal' ? localSkin() : null;
        const skinned = mine ? skinLibrary.localInstances(mine.skin, mine.counter, mine.kills) : null;
        viewmodel.render!.meshInstances = skinned ?? discs.meshInstances(hue);
        // The racing stripe belongs to the plain disc; a skin carries its own art.
        stripe.enabled = !skinned;
        if (skin === 'frc') {
            stripeMaterial.diffuse.set(0.18, 0.9, 1);
            stripeMaterial.emissive.set(0.05, 0.65, 1);
            stripeMaterial.emissiveIntensity = 1.2;
        } else {
            stripeMaterial.diffuse.set(0.95, 0.96, 0.97);
            stripeMaterial.emissive.set(0, 0, 0);
            stripeMaterial.emissiveIntensity = 0;
        }
        stripeMaterial.update();
        tintGhosts(hue);
    };
    const skillActivationFeedback = (label: string, colour: [number, number, number], kind: 'pulse' | 'stealth' | 'still' | 'power' = 'power') => {
        ui.popup(label, 'gold');
        sound.skillUse(kind);
        ui.skillCast(`rgb(${colour.map((c) => Math.round(c * 255)).join(' ')})`);
        const p = player.getPosition();
        const at: V3 = [p.x, p.y - PLAYER.height * 0.45, p.z];
        effects.ring(at, colour, 0.24, 0.5, 2.2);
        for (let i = 0; i < 12; i++) {
            const angle = i * Math.PI / 6;
            effects.mote(at, colour, [Math.cos(angle) * 1.2, 0.7 + (i % 3) * 0.25, Math.sin(angle) * 1.2], 0.025, 0.42);
        }
    };
    /** Whether the catch kick of the current inspect has fired. */
    let caught = false;

    const selfId = () => net.id ?? 'local';
    const medalTracker = createMedalTracker(selfId);
    ui.uiSounds({ hover: sound.uiHover, click: sound.uiClick, tab: sound.uiTab, medal: sound.medal });
    /** A skill landing in your hands: a card, a rising sound and a coloured burst at your feet. */
    const skillGained = (kind: SkillKind) => {
        const meta = SKILL_META[kind];
        ui.skillAcquired({ name: meta.name, detail: meta.detail, colour: meta.colour, icon: meta.icon });
        sound.skillPickup();
        const p = player.getPosition();
        const at: V3 = [p.x, p.y - PLAYER.height * 0.45, p.z];
        effects.ring(at, meta.rgb, 0.2, 0.45, 1.8);
        for (let i = 0; i < 16; i++) {
            const angle = (i * Math.PI) / 8;
            effects.mote(at, meta.rgb, [Math.cos(angle) * 0.5, 1.4 + (i % 4) * 0.3, Math.sin(angle) * 0.5], 0.02, 0.7);
        }
    };
    const nameOf = (id: string) =>
        id === 'guard' ? '保安' : id === labTargetId ? '固定测试人偶' : (roster.get(id)?.name ?? '某人');
    simulateDummyHit = (scenario) => {
        if (!audioLab || labHp === 0) return;
        const head = scenario === 'head';
        const golden = scenario === 'golden' || labGolden;
        const execution = scenario === 'execution';
        const frc = scenario === 'frc';
        const out = head || execution || frc || scenario === 'elimination' || scenario === 'golden' || labHp <= 1;
        labHp = out ? 0 : labHp - 1;
        const now = performance.now();
        const at: V3 = [labTargetPose.p[0], labTargetPose.p[1] + (head ? 1.55 : 0.9), labTargetPose.p[2]];
        if (out) {
            labRespawnAt = now + RESPAWN_SECONDS * 1000;
            poses.delete(labTargetId);
            targets.delete(labTargetId);
        }
        if (out && golden) sound.snipeConfirm(head, true);
        else sound.hitConfirm(out, head);
        effects.burst(at, colourFor(labTargetId), out ? 'out' : 'hit');
        // The equipped skin's elimination effect (and the dev preview's 计数器) on the dummy too.
        const mine = golden || frc || execution ? null : localSkin();
        if (out && mine) {
            skinFx.kill(mine.skin, at);
            if (mine.counter && previewSkin && net.state !== 'online') {
                previewSkin.skinKills++;
                ui.skinCounterTick(previewSkin.skinKills);
            }
        }
        avatars.flash(labTargetId, now);
        avatars.react(labTargetId, head, out, labTargetPose, now);
        cameraImpulses.trigger(out ? 0.4 : 0.16);
        ui.hitMarker(out ? 'kill' : head ? 'head' : 'hit');
        ui.popup(
            frc
                ? '人偶 · FRC 飞盘淘汰'
                : out && golden
                ? '人偶 · 金飞盘击杀'
                : head
                  ? '人偶 · 爆头淘汰'
                  : out
                    ? execution
                        ? '人偶 · 处决淘汰'
                        : '人偶 · 击杀'
                    : `人偶 · 身体命中（${MAX_HP - labHp}/${MAX_HP}）`,
            out ? 'kill' : head ? 'head' : 'hit'
        );
        labUi?.hit(head, out, golden);
        hitsClaimed++;
    };
    const refreshBoard = () => {
        ui.net(netState, roster.size);
        const me = selfId();
        ui.leaderboard(
            roster.size
                ? [...roster.values()].map((entry) => ({
                      name: entry.name,
                      kills: entry.kills,
                      hp: entry.hp,
                      alive: entry.alive,
                      colour: entry.colour,
                      me: entry.id === me,
                      king: !!king && entry.account && entry.name === king.name
                  }))
                : [{ name: '你（离线练习）', kills: 0, hp, alive, colour: colourFor('local'), me: true, king: false }]
        );
        ui.health(hp, MAX_HP);
        // The standing 淘汰王 (lifetime record holder) wears the title whenever they are online.
        const holder = king
            ? [...roster.values()].find((entry) => entry.account && entry.name === king!.name)
            : undefined;
        avatars.setLeader(holder?.id ?? null);
        const myHue = roster.get(me)?.colour ?? colourFor('local');
        if (myHue !== viewmodelHue) {
            viewmodelHue = myHue;
            if (viewmodelSkin === 'normal') setViewmodelSkin('normal', true);
        }
    };
    const refreshCount = refreshBoard;
    const positionOf = (id: string): V3 | undefined => poses.get(id)?.p;
    /** Clockwise angle (degrees) from the camera's heading to a world point, for the damage indicator. */
    const bearingTo = (point: V3 | undefined) => {
        if (!point) return null;
        const p = player.getPosition();
        const f = camera.forward;
        const toward = Math.atan2(point[0] - p.x, -(point[2] - p.z));
        const heading = Math.atan2(f.x, -f.z);
        return (((((toward - heading) * 180) / Math.PI) % 360) + 360) % 360;
    };

    const controller = () => player.script?.get(FirstPersonController) as unknown as { enabled: boolean } | null;

    const pose = (): PlayerPose => {
        const p = player.getPosition();
        const f = camera.forward;
        const result: PlayerPose = {
            p: [round(p.x), round(p.y), round(p.z)],
            yaw: round((Math.atan2(-f.x, -f.z) * 180) / Math.PI),
            pitch: round((Math.asin(Math.max(-1, Math.min(1, f.y))) * 180) / Math.PI)
        };
        if (aim > 0.01) result.aim = Math.round(aim * 100) / 100;
        return result;
    };

    const respawnAt = (index: number) => {
        const [x, z] = SPAWN_POINTS[index % SPAWN_POINTS.length];
        player.rigidbody!.teleport(x, 0.92, z, 0, 0, 0);
        player.rigidbody!.linearVelocity = Vec3.ZERO;
        setLook(player, 0, Math.random() * 360);
    };

    const setAlive = (value: boolean) => {
        alive = value;
        const script = controller();
        if (script) script.enabled = value && !inputPaused && !executionFrozen;
        if (value) hp = MAX_HP;
        if (!value) {
            player.rigidbody!.linearVelocity = Vec3.ZERO;
            chargingSince = null;
            ui.charge(null);
        }
    };

    // ---------- watching (out for the rest of the round) ----------
    const lookAt = new Vec3();
    const startSpectating = (reason: string) => {
        if (spectating) return;
        spectating = true;
        const script = controller();
        if (script) script.enabled = false;
        if (player.rigidbody) player.rigidbody.enabled = false;
        ui.eliminated(null);
        ui.spectate({ reason, watching: null });
    };
    const stopSpectating = () => {
        if (!spectating) return;
        spectating = false;
        if (player.rigidbody) player.rigidbody.enabled = true;
        const script = controller();
        if (script) script.enabled = alive && !inputPaused && !executionFrozen;
        ui.spectate(null);
    };
    /** Places the camera behind and above the watched player, looking at them; click switches who. */
    const spectate = (now: number) => {
        // Final minute: everyone out for the round watches from their seat in the 莲花球场 stands.
        const seat = inFinalMinute() ? stands.seatOf(selfId()) : null;
        if (seat) {
            player.setPosition(seat.x, seat.y + 1.25 + Math.sin(now / 1800) * 0.03, seat.z);
            lookAt.set(arenaCenter[0], 1.2, arenaCenter[1]);
            camera.lookAt(lookAt);
            ui.spectate({ reason: '看台观战 · 1 欢呼 · 2 挥应援棒 · 3 撒彩带', watching: null });
            return;
        }
        const candidates = [...roster.values()].filter(
            (entry) => entry.id !== selfId() && entry.alive && poses.has(entry.id)
        );
        if (!candidates.length) {
            ui.spectate({ reason: '没有可以观看的玩家', watching: null });
            return;
        }
        const target = candidates[watchIndex % candidates.length];
        const p = poses.get(target.id)!;
        const yaw = (p.yaw * Math.PI) / 180;
        const bob = Math.sin(now / 1500) * 0.1;
        player.setPosition(p.p[0] + Math.sin(yaw) * 3.2, p.p[1] + 1.1 + bob, p.p[2] + Math.cos(yaw) * 3.2);
        lookAt.set(p.p[0], p.p[1] + 0.6, p.p[2]);
        camera.lookAt(lookAt);
        ui.spectate({ reason: null, watching: target.name });
    };
    window.addEventListener('mousedown', (event) => {
        if (!globalFinisher && spectating && event.button === 0) watchIndex++;
    });
    /** The last minute of a round (or the lab's final-arena override). */
    const inFinalMinute = () =>
        labFinalOverride ||
        (roundState?.phase === 'playing' && roomNow() >= roundState.endsAt - ROUND.finalSecondsLeft * 1000);
    const playEmote = (id: string, kind: Emote) => {
        const at = stands.emote(id, kind, performance.now());
        if (!at) return;
        sound.crowd(at, kind);
        if (kind === 'confetti') {
            const hue = roster.get(id)?.colour ?? 0;
            effects.burst(at, hue, 'out');
            effects.burst(at, (hue + 120) % 360, 'head');
            effects.burst(at, (hue + 240) % 360, 'hit');
        }
    };
    let lastEmoteAt = -Infinity;
    const activateActiveSkill = () => {
        if (
            !locked() ||
            !alive ||
            inputPaused ||
            spectating ||
            executionFrozen ||
            globalFinisher ||
            performance.now() < detainedUntil
        ) return false;

        if (localAbilities.frc) {
            if (roomNow() < localFrcCooldownUntil) ui.notify('FRC 飞盘仍在冷却');
            else if (net.state === 'online') net.toggleFrc();
            else {
                localFrcSelected = !localFrcSelected;
                setViewmodelSkin(holdingGold() ? 'gold' : localFrcSelected ? 'frc' : 'normal');
                if (localFrcSelected) skillActivationFeedback('FRC 飞盘启动 · 红色科技盘', [1, 0.2, 0.12]);
                else ui.notify('已切回普通飞盘');
            }
            return true;
        }

        if (localAbilities.stealth) {
            if (roomNow() < localStealthCooldownUntil) ui.notify('请假条仍在冷却');
            else if (net.state === 'online') net.activateStealth();
            else {
                localStealthUntil = roomNow() + ITEM_RULES.stealthDurationMs;
                localStealthCooldownUntil = roomNow() + ITEM_RULES.stealthCooldownMs;
                skillActivationFeedback('请假条发动 · 隐身 3 秒', [0.25, 0.72, 1], 'still');
            }
            return true;
        }

        return false;
    };

    window.addEventListener('keydown', (event) => {
        if (!spectating || !inFinalMinute() || event.repeat) return;
        const kind = ({ Digit1: 'cheer', Digit2: 'stick', Digit3: 'confetti' } as const)[
            event.code as 'Digit1' | 'Digit2' | 'Digit3'
        ];
        if (!kind || performance.now() - lastEmoteAt < 1000) return;
        lastEmoteAt = performance.now();
        if (net.state === 'online') net.emote(kind);
        else playEmote(selfId(), kind);
    });

    const pauseMatchClock = (at: number) => {
        if (matchPausedAt === null) matchPausedAt = at;
    };
    const resumeMatchClock = (resumedAt: number) => {
        if (matchPausedAt === null) return;
        const delta = Math.max(0, resumedAt - matchPausedAt);
        matchClockOffset += delta;
        matchPausedAt = null;
        detainedUntil += delta;
        teacherGraceUntil += delta;
        if (Number.isFinite(lastThrowAt)) lastThrowAt += delta;
        if (deadUntil > 0) deadUntil += delta;
        if (goldCooldownUntil > 0) goldCooldownUntil += delta;
        for (const [id, expiry] of pendingHitClaims) pendingHitClaims.set(id, expiry + delta);
    };

    const net = createNetClient(url, {
        state: (state, detail) => {
            netState = state;
            if (state === 'rejected' && detail === 'version') {
                ui.updateAvailable('联机服务器已经升级，刷新页面后才能继续多人对战。');
            }
            if (state === 'rejected' && detail === 'auth') {
                // The saved session expired or was revoked: back to signing in.
                auth.account = null;
                ui.account(null);
                ui.notify('登录已失效，刷新页面后重新登录即可继续联机');
            }
            if (state !== 'online') {
                currentMomentCutscene = null;
                if (matchPausedAt !== null) resumeMatchClock(Date.now());
                globalFinisher = null;
                ui.finisherMode(false);
                finisherRequestId = null;
                finisherHoldTarget = null;
                finisherHoldStartedAt = null;
                finisherCommitSent = false;
                executionView.clear();
                power = { pulledAt: null };
                roster.clear();
                avatars.clear();
                for (const npc of NPC_SPAWNS) avatars.add(npc.id, npc.name, npc.hue);
                // Back to offline practice: no round, and a local golden disc will be laid out again.
                if (!audioLab) roundState = null;
                goldView.set(null);
                avatars.setGold(null);
                ground.set([]);
                ui.ammo(null, AMMO.max);
                if (!alive) {
                    setAlive(true);
                    ui.eliminated(null);
                }
            }
            refreshCount();
        },
        welcome: (me, players, extra) => {
            matchClockOffset = Math.max(0, realRoomNow() - extra.matchTime);
            matchPausedAt = null;
            welcomeSyncPending = true;
            globalFinisher = null;
            executionView.clear();
            for (const record of extra.executions) executionView.start(record);
            if (extra.globalFinisher) {
                globalFinisher = extra.globalFinisher;
                pauseMatchClock(extra.globalFinisher.pauseAt);
                ui.finisherMode(true);
                executionView.start(globalExecution(extra.globalFinisher), true);
            }
            power = extra.power;
            currentMomentCutscene = extra.momentCutscene;
            applyWorldItems(extra.items);
            Object.assign(localAbilities, {
                revive: me.hasReviveArmor === true, frc: me.hasFrc === true, eye: me.hasEye === true,
                reviveTaken: me.reviveTaken === true, reviveUsed: me.reviveTaken === true,
                stealth: me.hasStealth === true, creation: me.hasCreation === true,
                flashlight: me.hasFlashlight === true, coach: me.coachGift === true
            });
            localAmmoCapacity = me.ammoCapacity ?? AMMO.max;
            localFrcSelected = me.frcSelected === true;
            localFrcCooldownUntil = me.frcCooldownUntil ?? 0;
            localStealthUntil = me.stealthUntil ?? 0;
            localStealthCooldownUntil = me.stealthCooldownUntil ?? 0;
            creationNextAt = me.creationNextAt ?? 0;
            roster.clear();
            if (me.spectating) {
                setAlive(false);
                startSpectating('本局已出局：观战，下一局开始时加入');
            } else {
                stopSpectating();
                setAlive(me.alive);
            }
            king = extra.king;
            ui.king(king);
            ui.chatHistory(extra.chat);
            if (extra.account) {
                auth.account = extra.account;
                ui.account(extra.account);
                restroomMirrors.setAvatar(extra.account.avatarId, extra.account.avatarVersion);
            }
            roundState = extra.round;
            wasPowerOut = powerOut(extra.matchTime, extra.power);
            wasNight =
                extra.round.phase === 'playing' &&
                extra.matchTime >= extra.round.endsAt - ROUND.blackoutSecondsLeft * 1000;
            dark = wasPowerOut || wasNight;
            finalShown =
                extra.round.phase === 'playing' &&
                extra.matchTime >= extra.round.endsAt - ROUND.finalSecondsLeft * 1000;
            ammo = extra.ammo;
            ui.ammo(ammo, localAmmoCapacity);
            ground.set(extra.discs);
            goldView.set(extra.gold);
            avatars.setGold(extra.gold.holder);
            for (const each of players) {
                roster.set(each.id, each);
                if (each.id !== me.id) {
                    avatars.add(each.id, each.name, each.colour, each.avatarId, each.avatarVersion);
                    avatars.setReviveArmor(each.id, each.hasReviveArmor === true);
                    avatars.setFlashlight(each.id, each.hasFlashlight === true);
                }
            }
            const ownSummary = players.find((each) => each.id === me.id);
            if (ownSummary) restroomMirrors.setColour(ownSummary.colour);
            refreshCount();
            hp = me.hp;
            refreshBoard();
            ui.notify(`已加入共享校园，你是「${me.name}」，当前 ${players.length} 人`);
        },
        joined: (summary) => {
            roster.set(summary.id, summary);
            avatars.add(summary.id, summary.name, summary.colour, summary.avatarId, summary.avatarVersion);
            avatars.setReviveArmor(summary.id, summary.hasReviveArmor === true);
            avatars.setFlashlight(summary.id, summary.hasFlashlight === true);
            refreshCount();
            ui.notify(`${summary.name} 进入了校园`);
            sound.join();
        },
        phaseChanged: (id, phase) => {
            const entry = roster.get(id);
            if (entry) entry.phase = phase;
            if (id === selfId()) {
                playerPhase = phase;
                if (phase === 'playing') ui.notify('已通过闸机 · 加入本局');
            }
        },
        joinRoundDenied: (reason) => {
            playerPhase = 'lobby';
            ui.notify(reason);
        },
        interactionDenied: (reason) => ui.notify(reason),
        positionCorrected: (next) => {
            player.rigidbody!.teleport(...next.p, 0, next.yaw, 0);
            player.rigidbody!.linearVelocity = Vec3.ZERO;
            player.rigidbody!.angularVelocity = Vec3.ZERO;
            setLook(player, next.pitch, next.yaw);
            teleportPending = true;
        },
        items: applyWorldItems,
        ability: (id, next, item) => {
            const before = roster.get(id);
            for (const kind of SKILL_KINDS) {
                if (!SKILL_META[kind].has(next) || (before && SKILL_META[kind].has(before))) continue;
                if (!before && id !== selfId()) continue; // a fresh roster entry is not a pickup
                if (id === selfId()) skillGained(kind);
                else {
                    const meta = SKILL_META[kind];
                    ui.event({ icon: meta.icon, who: next.name, text: ` 获得了 ${meta.name}`, colour: meta.colour });
                    sound.feedTick();
                }
            }
            roster.set(id, next);
            avatars.setReviveArmor(id, next.hasReviveArmor === true);
            avatars.setFlashlight(id, next.hasFlashlight === true);
            if (id === selfId()) {
                const wasFrcSelected = localFrcSelected;
                const previousStealthUntil = localStealthUntil;
                localAbilities.revive = next.hasReviveArmor === true;
                localAbilities.reviveTaken = next.reviveTaken === true;
                localAbilities.reviveUsed = next.reviveTaken === true;
                localAbilities.frc = next.hasFrc === true;
                localAbilities.eye = next.hasEye === true;
                localAbilities.stealth = next.hasStealth === true;
                localAbilities.creation = next.hasCreation === true;
                localAbilities.flashlight = next.hasFlashlight === true;
                localAbilities.coach = next.coachGift === true;
                localAmmoCapacity = next.ammoCapacity ?? AMMO.max;
                localFrcSelected = next.frcSelected === true;
                localFrcCooldownUntil = next.frcCooldownUntil ?? item?.cooldownUntil ?? localFrcCooldownUntil;
                localStealthUntil = next.stealthUntil ?? 0;
                // An older room omits it; an activation it accepted then still starts the cooldown here.
                localStealthCooldownUntil =
                    next.stealthCooldownUntil ??
                    (localStealthUntil > previousStealthUntil
                        ? localStealthUntil - ITEM_RULES.stealthDurationMs + ITEM_RULES.stealthCooldownMs
                        : localStealthCooldownUntil);
                creationNextAt = next.creationNextAt ?? creationNextAt;
                if (!wasFrcSelected && localFrcSelected) {
                    setViewmodelSkin(holdingGold() ? 'gold' : 'frc');
                    skillActivationFeedback('FRC 飞盘启动 · 红色科技盘', [1, 0.2, 0.12]);
                } else if (wasFrcSelected && !localFrcSelected && next.hasFrc) {
                    setViewmodelSkin(holdingGold() ? 'gold' : 'normal');
                    ui.notify('已切回普通飞盘');
                }
                if (localStealthUntil > previousStealthUntil && localStealthUntil > roomNow())
                    skillActivationFeedback('请假条发动 · 隐身 3 秒', [0.25, 0.72, 1], 'still');
            }
            refreshBoard();
        },
        revived: (id, at) => {
            if (id === selfId()) {
                hp = MAX_HP;
                alive = true;
                setAlive(true);
                ui.eliminated(null);
                ui.popup('复活甲生效', 'gold');
                ui.feed('复活甲生效 · 满血复活，短暂无敌', 'mine');
                sound.respawn();
                sound.skillUse('heal');
                ui.skillCast(SKILL_META.revive.colour);
                effects.ring(at, [0.3, 0.95, 0.85], 0.3, 1.5, 1.3);
                localAbilities.revive = false;
                localAbilities.reviveUsed = true;
                localAbilities.reviveTaken = true;
            }
            const entry = roster.get(id);
            if (id !== selfId() && entry) {
                ui.event({ icon: 'revive', who: entry.name, text: ' 的复活甲生效了', colour: SKILL_META.revive.colour });
                sound.feedTick();
            }
            if (entry) Object.assign(entry, { hp: MAX_HP, alive: true, spectating: false, hasReviveArmor: false });
            avatars.setReviveArmor(id, false);
        },
        left: (id) => {
            const name = nameOf(id);
            roster.delete(id);
            avatars.remove(id);
            refreshCount();
            ui.notify(`${name} 离开了校园`);
        },
        profileUpdated: (playerId, avatarId, avatarVersion) => {
            const profile = roster.get(playerId);
            if (profile) {
                profile.avatarId = avatarId;
                profile.avatarVersion = avatarVersion;
            }
            avatars.setAvatar(playerId, avatarId, avatarVersion);
            if (playerId === selfId()) restroomMirrors.setAvatar(avatarId, avatarVersion);
        },
        thrown: (from, record, ageMs) => {
            const thrower = roster.get(from);
            avatars.throw(from, performance.now());
            if (record.sniper) sound.sniperThrow(record.o);
            else sound.throw(record.o);
            // Latency compensation: start the replayed disc where it is by now, not where it was released.
            const lead = Math.min(ageMs, 200) / 1000;
            discs.launch({
                owner: from,
                throwId: record.id,
                hue: thrower?.colour ?? 0,
                origin: [
                    record.o[0] + record.v[0] * lead,
                    record.o[1] + record.v[1] * lead,
                    record.o[2] + record.v[2] * lead
                ],
                velocity: record.v,
                normal: launchNormal(record.v, record.tilt),
                local: false,
                sniper: record.sniper === true,
                gold: from === goldHolder(),
                frc: record.frc === true,
                skin: thrower?.skin ?? null
            });
            if (from === goldHolder()) goldThrowFlourish(record.o);
        },
        struck: (throwId, target, by, targetHp, out, head, at, scores, sniper, frc, golden, final, execution, shot) => {
            const goldKill = golden && out;
            const feedbackKind =
                target === selfId()
                    ? 'personal-damage'
                    : goldKill
                      ? 'golden-elimination'
                      : out
                        ? 'elimination'
                        : head
                          ? 'headshot'
                          : 'body-hit';
            const eventId =
                throwId === undefined
                    ? `strike:${by}:${target}:${at.map((value) => Math.round(value * 100)).join(',')}:${targetHp}`
                    : `strike:${by}:${throwId}`;
            const presentation = feedback.submit({ id: eventId, kind: feedbackKind }, performance.now());
            if (!presentation.accepted) return;
            if (by === selfId() && throwId !== undefined) {
                pendingHitClaims.delete(throwId);
                hitsClaimed++;
            }
            const entryFinal = roster.get(target);
            if (entryFinal && final) entryFinal.spectating = true;
            const snipe = sniper && head && out;
            const headshotDistance =
                head && typeof shot?.range === 'number' ? ` · 爆头距离 ${shot.range.toFixed(1)} m` : '';
            if (goldKill) goldView.flourish(at);
            effects.burst(at, roster.get(by)?.colour ?? 0, out ? 'out' : head ? 'head' : 'hit');
            if (out && shot?.skin) skinFx.kill(shot.skin, at);
            if (shot?.counter !== undefined) {
                const thrower = roster.get(by);
                if (thrower) thrower.skinKills = shot.counter;
                if (by === selfId()) {
                    refreshLocalSkin();
                    ui.skinCounterTick(shot.counter);
                    // Milestones on the counter: every 10, louder every 100.
                    if (shot.counter % 100 === 0) ui.popup(`计数器 ${shot.counter} · 百人斩`, 'gold');
                    else if (shot.counter % 10 === 0) ui.popup(`计数器 ${shot.counter}`, 'gold');
                }
            }
            if (snipe) effects.snipe(at);
            for (const [id, [score, kills, deaths]] of Object.entries(scores)) {
                const entry = roster.get(id);
                if (entry) Object.assign(entry, { score, kills, deaths });
            }
            const entry = roster.get(target);
            if (entry) Object.assign(entry, { hp: targetHp, alive: !out });
            const me = selfId();
            avatars.flash(target, performance.now());
            avatars.react(target, head, out, poses.get(target), performance.now());
            if (target !== selfId()) avatars.health(target, targetHp, head);
            if (by === selfId() && feelMotion !== 'off') {
                // Hit-stop on your own head hits and eliminations: the victim's pose and the effects hold briefly.
                const stop = out ? HIT_STOP_MS.kill : head ? HIT_STOP_MS.head : HIT_STOP_MS.hit;
                if (stop > 0) {
                    hitStopUntil = performance.now() + stop;
                    avatars.freeze(target, stop);
                }
            }
            if (target === me) {
                hp = targetHp;
                sound.hurt(out);
                const from = positionOf(by);
                ui.damage(bearingTo(from));
                cameraImpulses.trigger(snipe ? 0.9 : out ? 0.65 : 0.35);
                if (snipe) {
                    // Taken out by a sniper headshot: the view is thrown back hard.
                    if (presentation.showHud) ui.popup('被狙击爆头', 'me');
                }
                if (head && !snipe) {
                    // Every head hit is lethal, with explicit victim feedback.
                    if (presentation.showHud) ui.popup('被爆头淘汰', 'me');
                }
                if (!out) {
                    // Knock-back away from the thrower (or along the disc's path).
                    const p = player.getPosition();
                    const source = from ?? at;
                    let dx = p.x - source[0];
                    let dz = p.z - source[2];
                    const length = Math.hypot(dx, dz) || 1;
                    dx /= length;
                    dz /= length;
                    player.rigidbody!.applyImpulse(dx * PLAYER.mass * 5, PLAYER.mass * 2.2, dz * PLAYER.mass * 5);
                }
                if (out && final) {
                    setAlive(false);
                    killer = nameOf(by);
                    startSpectating(
                        execution
                            ? `你被 ${nameOf(by)} 处决，本局进入观战`
                            : by === 'guard'
                              ? '你被保安的手电筒照到了，出局'
                              : `你被 ${nameOf(by)} 淘汰，本局出局`
                    );
                } else if (out) {
                    setAlive(false);
                    killer = nameOf(by);
                    deadUntil = performance.now() + RESPAWN_SECONDS * 1000;
                } else if (presentation.showHud) {
                    ui.feed(`被 ${nameOf(by)} 命中 · 剩余生命 ${targetHp}`, 'me');
                }
            } else if (by === me) {
                if (goldKill) {
                    sound.snipeConfirm(head, true);
                    ui.hitMarker('snipe');
                    if (presentation.showHud) ui.popup(`金飞盘淘汰 · ${nameOf(target)}${headshotDistance}  +1`, 'gold');
                    punch = Math.max(punch, 1.8);
                    cameraImpulses.trigger(0.55);
                } else if (snipe) {
                    sound.snipeConfirm();
                    ui.hitMarker('snipe');
                    if (presentation.showHud) ui.popup(`狙击爆头 · ${nameOf(target)}${headshotDistance}  +1`, 'snipe');
                    punch = Math.max(punch, 1.8);
                    cameraImpulses.trigger(0.5);
                } else {
                    sound.hitConfirm(out, head);
                    ui.hitMarker(out ? 'kill' : head ? 'head' : 'hit');
                    if (presentation.showHud)
                        ui.popup(
                            out
                                ? `${execution ? '处决淘汰' : head ? '爆头淘汰' : '淘汰'} ${nameOf(target)}${headshotDistance}  +1`
                                : '命中！',
                            out ? 'kill' : head ? 'head' : 'hit'
                        );
                    // Confirmation you can feel: a punch of the view, harder on eliminations.
                    punch = Math.max(punch, out ? 1.4 : head ? 1 : 0.7);
                    if (out) cameraImpulses.trigger(0.4);
                    ui.crosshairKick(out ? 'kill' : head ? 'head' : 'hit');
                }
            } else {
                sound.impact(positionOf(target) ?? at);
                if (!out && presentation.showHud) ui.feed(`${nameOf(by)} 命中 ${nameOf(target)}`);
            }
            if (out) {
                const now = performance.now();
                const previous = streaks.get(by);
                const streak = previous && now - previous.at < 12_000 ? previous.count + 1 : 1;
                streaks.set(by, { count: streak, at: now });
                streaks.delete(target);
                const icons = killIcons({
                    head,
                    sniper,
                    frc,
                    gold: golden,
                    execution,
                    guard: by === 'guard',
                    bank: shot?.bank === true,
                    range: shot?.range ?? null
                });
                const tone = target === me ? 'me' : by === me ? 'mine' : 'neutral';
                if (presentation.showHud) ui.killFeed(nameOf(by), nameOf(target), icons, shot?.range ?? null, tone);
                let leader: string | null = null;
                let best = 0;
                for (const [key, entry] of roster) if ((entry.kills ?? 0) > best) [leader, best] = [key, entry.kills ?? 0];
                medalTracker.setLeader(leader);
                const awards = medalTracker.kill({
                    time: now / 1000,
                    killer: by,
                    victim: target,
                    head,
                    bank: shot?.bank === true,
                    golden,
                    execution,
                    frc,
                    distance: shot?.range ?? undefined,
                    aliveAfter: final ? [...roster].filter(([key, player]) => key !== target && player.alive && !player.spectating).length : undefined
                });
                if (by === me) {
                    if (presentation.showHud) ui.killBanner(streak, nameOf(target), icons);
                    sound.streak(streak);
                    if (presentation.showHud && awards.length) ui.medals(awards);
                }
                killMarks.push({ at: [...(positionOf(target) ?? at)] as V3, until: now + 3000 });
                if (killMarks.length > 8) killMarks.shift();
                const standing = [...roster.values()].filter((player) => player.alive && !player.spectating).length;
                if (feelMotion !== 'off' && endsRound(final, standing))
                    slowMotionUntil = now + FINAL_SLOW_MOTION.seconds * 1000;
                if (goldKill) {
                    if (presentation.showHud)
                        ui.goldKill(nameOf(by), nameOf(target), target === me ? 'me' : by === me ? 'mine' : 'neutral');
                    if (by !== me) sound.goldChime();
                } else {
                    // The kill feed and banner carry ordinary eliminations; the centre stage is for executions.
                    if (presentation.showHud && execution)
                        ui.broadcast(
                            nameOf(by),
                            nameOf(target),
                            target === me ? 'me' : by === me ? 'mine' : 'neutral',
                            streak,
                            snipe
                        );
                    if (target !== me && by !== me) sound.announce();
                }
            }
            refreshBoard();
        },
        hitRejected: (throwId) => {
            pendingHitClaims.delete(throwId);
            feedback.submit({ id: `reject:${selfId()}:${throwId}`, kind: 'contact-rejected' }, performance.now());
            ui.rejectHitPrediction(throwId);
        },
        healed: (id, healedHp) => {
            const entry = roster.get(id);
            if (entry) entry.hp = healedHp;
            if (id === selfId()) {
                hp = healedHp;
                ui.feed('生命已恢复', 'mine');
            }
            refreshBoard();
        },
        chat: (line) => ui.chatLine(line),
        king: (next, isNew) => {
            king = next;
            ui.king(next, isNew);
            refreshBoard();
        },
        account: (account) => {
            auth.account = account;
            ui.account(account);
            restroomMirrors.setAvatar(account.avatarId, account.avatarVersion);
        },
        gold: (gold, event) => {
            const previous = goldView.state?.holder ?? null;
            goldView.set(gold);
            avatars.setGold(gold.holder);
            const me = selfId();
            if (event === 'taken' && gold.holder) {
                const where: V3 = gold.holder === me ? viewmodelWorld() : (positionOf(gold.holder) ?? gold.at);
                goldView.flourish(where);
                if (gold.holder === me) {
                    // A fresh burst count for each hold (the room resets its count on pickup too).
                    goldThrowCount = 0;
                    goldCooldownUntil = 0;
                    sound.goldTaken();
                    ui.popup('夺得金飞盘！', 'gold');
                    ui.feed('你持有金飞盘 · 坚持到倒计时结束就能获胜', 'mine');
                    punch = Math.max(punch, 1.2);
                } else {
                    sound.goldLost();
                    ui.feed(`${nameOf(gold.holder)} 夺得了金飞盘！`, 'neutral');
                }
            } else if (event === 'dropped') {
                goldView.flourish(gold.at);
                sound.goldChime(gold.at);
                ui.feed(
                    previous === me ? '你的金飞盘掉落了！' : '金飞盘掉落了，快去抢！',
                    previous === me ? 'me' : 'neutral'
                );
            } else if (event === 'spawned') {
                goldView.flourish(gold.at);
                sound.goldChime();
                ui.notify('金飞盘已刷新！位置已在地图和屏幕上标出');
            }
        },
        round: (next, scores) => {
            const was = roundState;
            roundState = next;
            for (const [id, [score, kills, deaths]] of Object.entries(scores)) {
                const entry = roster.get(id);
                if (entry) Object.assign(entry, { score, kills, deaths });
            }
            if (next.phase === 'ended') {
                const result = feedback.submit({ id: `round:${next.nextAt}`, kind: 'round-result' }, performance.now());
                const mine = next.winnerId === selfId();
                if (result.accepted) sound.roundEnd(mine, next.outcome);
            } else if (was?.phase === 'ended') {
                sound.roundStart();
                ui.notify('新一局开始！争夺金飞盘');
            }
            refreshBoard();
        },
        caught: (id) => {
            if (id === selfId()) return; // already shown locally
            teacher.say('室内不准打飞盘！', performance.now());
            sound.whistle();
            ui.feed(`纪老师抓到 ${nameOf(id)} 在室内打飞盘，罚站 ${DETENTION_SECONDS} 秒`);
        },
        latency: (ms) => ui.latency(ms),
        power: (next) => {
            power = next;
        },
        momentCutsceneStarted: (cutscene) => {
            currentMomentCutscene = cutscene;
        },
        momentCutsceneEnded: (id) => {
            if (currentMomentCutscene?.id === id) currentMomentCutscene = null;
        },
        executionStarted: (record) => executionView.start(record),
        executionEnded: (id, completed, reason) => {
            const local = executionView.localRecord(selfId())?.id === id;
            executionView.stop(id);
            if (local && !completed) ui.notify(`处决中断：${reason}`);
        },
        executionDenied: (reason) => ui.notify(reason),
        emote: (id, kind) => playEmote(id, kind),
        executionPrepared: (requestId) => {
            if (requestId === finisherRequestId) ui.notify('处决准备已确认');
        },
        executionPrepareDenied: (requestId, reason) => {
            if (requestId !== finisherRequestId) return;
            finisherRequestId = null;
            finisherHoldTarget = null;
            finisherHoldStartedAt = null;
            finisherCommitSent = false;
            ui.executionState(null, 0);
            ui.executionHold('denied');
            ui.notify(reason);
        },
        globalFinisherStarted: (finisher) => {
            globalFinisher = finisher;
            pauseMatchClock(finisher.pauseAt);
            ui.finisherMode(true);
            finisherRequestId = null;
            finisherHoldTarget = null;
            finisherHoldStartedAt = null;
            finisherCommitSent = false;
            executionView.start(globalExecution(finisher), true);
        },
        globalFinisherState: (finisher) => {
            if (globalFinisher?.id === finisher.id) globalFinisher = finisher;
        },
        globalFinisherCompleted: (id, resumedAt) => {
            resumeMatchClock(resumedAt);
            executionView.stop(id);
            if (globalFinisher?.id === id) globalFinisher = null;
            ui.executionState(null, 0);
            ui.finisherMode(false);
            ui.notify('全场处决结束 · 比赛继续');
        },
        globalFinisherCancelled: (id, reason, resumedAt) => {
            resumeMatchClock(resumedAt);
            executionView.stop(id);
            if (globalFinisher?.id === id) globalFinisher = null;
            ui.executionState(null, 0);
            ui.finisherMode(false);
            ui.notify(`全场处决已取消：${reason}`);
        },
        ammo: (next, nextRefillAt) => {
            if (nextRefillAt !== undefined) creationNextAt = nextRefillAt;
            // An older room sends no refill time: a refill restarts the interval.
            else if (localAbilities.creation && next > ammo) creationNextAt = roomNow() + ITEM_RULES.creationRefillMs;
            if (next > ammo) {
                sound.pickup();
                ui.feed(`捡起飞盘 · ${next}/${localAmmoCapacity}`, 'mine');
            }
            ammo = next;
            ui.ammo(ammo, localAmmoCapacity);
        },
        discs: (list, added) => {
            ground.set(list);
            if (added?.office) {
                ui.feed('体育组办公室刷新了一个飞盘', 'neutral');
                const disc = list.find((each) => each.id === added.id);
                if (disc) effects.ring(disc.at, [0.55, 0.85, 1], 0.2, 0.6, 1.6);
            }
        },
        respawn: (id, spawn) => {
            const entry = roster.get(id);
            if (entry) Object.assign(entry, { alive: true, hp: MAX_HP, spectating: false });
            if (id !== selfId()) return refreshBoard();
            stopSpectating();
            spottedSent = false;
            respawnAt(spawn);
            setAlive(true);
            ui.eliminated(null);
            sound.respawn();
            ui.feed(`已复活 · ${SPAWN_PROTECTION} 秒保护`, 'mine');
            net.respawned(pose());
            refreshBoard();
        }
    });

    const forward = new Vec3();
    const right = new Vec3();
    const origin = new Vec3();
    const throwDisc = (speed: number, sniper = false) => {
        if (playerPhase === 'lobby' || globalFinisher || executionView.hasActor(selfId())) return false;
        const now = performance.now();
        if (!alive || now - lastThrowAt < THROW_COOLDOWN * 1000) return false;
        // The golden disc: a short cooldown after every burst of throws.
        if (holdingGold()) {
            if (now < goldCooldownUntil) {
                ui.popup(`金飞盘冷却中 ${((goldCooldownUntil - now) / 1000).toFixed(1)} 秒`, 'hit');
                return false;
            }
            goldThrowCount++;
            if (goldThrowCount % ROUND.goldBurst === 0) {
                goldCooldownUntil = now + ROUND.goldCooldown * 1000;
                ui.feed(`金飞盘已连投 ${ROUND.goldBurst} 次 · 冷却 ${ROUND.goldCooldown} 秒`, 'me');
            }
        }
        const usingFrc = !holdingGold() && localFrcSelected && roomNow() >= localFrcCooldownUntil;
        if (!hasDisc() && !usingFrc) {
            ui.notify('没有飞盘了：去捡回扔出去的飞盘，或到体育组办公室领取');
            return false;
        }
        const golden = holdingGold();
        if (net.state === 'online' && !golden && !usingFrc) {
            ammo = Math.max(0, ammo - 1);
            ui.ammo(ammo, localAmmoCapacity);
        } else if (usingFrc && net.state !== 'online') {
            localFrcSelected = false;
            localFrcCooldownUntil = roomNow() + ITEM_RULES.frcCooldownMs;
            const item = worldItems.find((candidate) => candidate.kind === 'frc' && candidate.holder === selfId());
            if (item) item.cooldownUntil = localFrcCooldownUntil;
        }
        lastThrowAt = now;
        const eye = camera.getPosition();
        forward.copy(camera.forward);
        // Clamp the launch elevation to a throwable range.
        const elevation = Math.max(THROW.minElevation, Math.min(THROW.maxElevation, Math.asin(forward.y)));
        const heading = Math.hypot(forward.x, forward.z) || 1;
        forward.set(
            (forward.x / heading) * Math.cos(elevation),
            Math.sin(elevation),
            (forward.z / heading) * Math.cos(elevation)
        );
        right.cross(forward, Vec3.UP).normalize();
        if (sniper) {
            // Sniper: released on the line of sight, so the disc goes exactly where the crosshair is.
            origin.copy(eye).add(new Vec3().copy(forward).mulScalar(0.45));
        } else {
            origin.copy(eye).add(new Vec3().copy(forward).mulScalar(0.5)).add(new Vec3().copy(right).mulScalar(0.18));
            origin.y -= 0.15;
        }
        // Never launch from inside a wall right in front of the camera.
        if (rigidbody.raycastFirst(eye, origin)) origin.copy(eye).add(new Vec3().copy(forward).mulScalar(0.12));
        const v = sniper ? Vec3.ZERO : player.rigidbody!.linearVelocity;
        const velocity: V3 = [
            forward.x * speed + v.x * 0.5,
            forward.y * speed + v.y * 0.3,
            forward.z * speed + v.z * 0.5
        ];
        const record: ThrowRecord = {
            id: ++throwCounter,
            o: [round(origin.x), round(origin.y), round(origin.z)],
            v: velocity.map(round) as V3,
            tilt: 0,
            ...(usingFrc ? { frc: true } : {}),
            ...(sniper ? { sniper: true } : {})
        };
        if (usingFrc) {
            localFrcThrows.add(record.id);
            // Missed practice shots must not grow this lookup indefinitely.
            while (localFrcThrows.size > 128) localFrcThrows.delete(localFrcThrows.values().next().value!);
        }
        discs.launch({
            owner: selfId(),
            throwId: record.id,
            hue: roster.get(selfId())?.colour ?? colourFor('local'),
            origin: record.o,
            velocity: record.v,
            normal: launchNormal(record.v, record.tilt),
            local: true,
            sniper,
            gold: holdingGold(),
            frc: usingFrc,
            ...(() => {
                const mine = localSkin();
                return mine
                    ? { skin: mine.skin, instances: mine.counter ? skinLibrary.localInstances(mine.skin, true, mine.kills) : null }
                    : {};
            })()
        });
        if (sniper) {
            sound.sniperThrow();
            punch = 1.6;
            cameraImpulses.trigger(0.4);
        } else {
            sound.throw();
            punch = 1;
        }
        if (golden) goldThrowFlourish(record.o);
        net.pose(pose(), true);
        net.throw(record);
        throws++;
        return true;
    };
    /** The golden disc leaves the hand: a gold flash, a shock ring and a spray of sparks along the throw. */
    function goldThrowFlourish(at: V3) {
        effects.ring(at, GOLD_COLOUR, 0.1, 0.35, 1.4);
        effects.mote(at, [1, 1, 1], [0, 0, 0], 0.25, 0.12);
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            effects.mote(at, GOLD_COLOUR, [Math.cos(a) * 2.5, 1 + Math.random() * 2, Math.sin(a) * 2.5], 0.035, 0.5, 4);
        }
        sound.goldChime(at);
    }

    const locked = () => document.pointerLockElement === canvas;
    const cancelCharge = () => {
        chargingSince = null;
        aimSoundPlayed = false;
        aimReadyPlayed = false;
        ui.charge(null);
    };
    const activeLocalSkill = (): ItemKind | null => {
        for (const kind of ['revive', 'frc', 'eye', 'stealth', 'creation', 'flashlight'] as const)
            if (localAbilities[kind]) return kind;
        return null;
    };
    const dropLocalSkill = () => {
        const kind = activeLocalSkill();
        if (!kind) return;
        localAbilities[kind] = false;
        const item = worldItems.find((entry) => entry.kind === kind && entry.holder === selfId());
        if (item) {
            const p = player.getPosition();
            item.available = true;
            item.holder = null;
            item.at = [p.x, 0.02, p.z];
            item.returnAt = roomNow() + ITEM_RULES.droppedReturnMs;
            if (kind === 'frc') {
                item.cooldownUntil = Math.max(item.cooldownUntil, localFrcCooldownUntil);
                localFrcCooldownUntil = 0;
            }
        }
        if (kind === 'frc') localFrcSelected = false;
        if (kind === 'stealth') localStealthUntil = 0;
        applyWorldItems(worldItems);
    };
    const nearestInteraction = () => {
        const p = player.getPosition();
        const candidates = [
            ...worldItems.filter((item) => item.available).map((item) => ({ id: item.id, name: item.name, at: item.at })),
            ...NPC_SPAWNS.map((npc) => ({ id: npc.id, name: npc.name, at: npc.at }))
        ];
        let closest: { id: string; name: string; distance: number } | null = null;
        for (const candidate of candidates) {
            const distance = Math.hypot(p.x - candidate.at[0], p.y - candidate.at[1], p.z - candidate.at[2]);
            if (distance <= ITEM_RULES.pickupRadius && (!closest || distance < closest.distance))
                closest = { id: candidate.id, name: candidate.name, distance };
        }
        return closest;
    };
    const interactNearby = () => {
        if (globalFinisher || !started || playerPhase === 'lobby' || !alive || spectating || inputPaused || performance.now() < detainedUntil) return;
        const target = nearestInteraction();
        if (!target) return;
        if (net.state === 'online') {
            net.interact(target.id);
            return;
        }
        if (target.id === 'coach-michael') {
            if (localAbilities.coach) return ui.notify('Michael 教练：飞盘天赋已经学会了');
            localAbilities.coach = true;
            localAmmoCapacity = 5;
            ammo = Math.min(localAmmoCapacity, ammo + 2);
            ui.ammo(ammo, localAmmoCapacity);
            skillGained('coach');
            return;
        }
        if (target.id === 'mark') {
            if (localMarkGiven || localAbilities.creation) return ui.notify('Mark：创造之力已经交给别人了');
            dropLocalSkill();
            localMarkGiven = true;
            localAbilities.creation = true;
            creationNextAt = roomNow() + ITEM_RULES.creationRefillMs;
            const power = worldItems.find((item) => item.id === 'item-creation');
            if (power) {
                power.available = false;
                power.holder = selfId();
                const local = pose().p;
                power.at = [local[0], Math.max(0.02, local[1] - 0.9), local[2]];
                applyWorldItems(worldItems);
            }
            skillGained('creation');
            return;
        }
        const item = worldItems.find((entry) => entry.id === target.id);
        if (!item) return;
        if (item.kind === 'revive' && (localAbilities.revive || localAbilities.reviveTaken)) return;
        if (item.kind === 'frc' && localAbilities.frc) return;
        if (item.kind === 'eye' && localAbilities.eye) return;
        if (item.kind === 'stealth' && localAbilities.stealth) return;
        if (item.kind === 'creation' && localAbilities.creation) return;
        if (item.kind === 'flashlight' && localAbilities.flashlight) return;
        dropLocalSkill();
        localAbilities[item.kind] = true;
        if (item.kind === 'revive') localAbilities.reviveTaken = true;
        item.available = false;
        item.holder = selfId();
        item.returnAt = null;
        const local = pose().p;
        item.at = [local[0], Math.max(0.02, local[1] - 0.9), local[2]];
        if (item.kind === 'frc') localFrcCooldownUntil = Math.max(localFrcCooldownUntil, item.cooldownUntil);
        applyWorldItems(worldItems);
        skillGained(item.kind);
    };
    window.addEventListener('mousedown', (event) => {
        // Right button while charging or aiming: stand down without throwing.
        if (event.button === 2 && chargingSince !== null) return cancelCharge();
        if (event.button !== 0 || !locked() || !alive || !started || inputPaused) return;
        if (performance.now() < detainedUntil) return; // standing still for 纪老师
        if (!hasDisc()) {
            ui.notify('没有飞盘了：去捡回扔出去的飞盘，或到体育组办公室领取');
            return;
        }
        chargingSince = performance.now();
        aimSoundPlayed = false;
        aimReadyPlayed = false;
        inspectSince = null; // attacking cancels an inspect
    });
    window.addEventListener('contextmenu', (event) => {
        if (locked()) event.preventDefault();
    });
    window.addEventListener('mouseup', (event) => {
        if (event.button !== 0 || chargingSince === null) return;
        const held = (performance.now() - chargingSince) / 1000;
        cancelCharge();
        if (!locked()) return;
        // Fully aimed: a sniper throw; otherwise the usual charged throw.
        if (aimReady(held)) throwDisc(SNIPER.speed, true);
        else throwDisc(chargeSpeed(held));
    });
    const startInspect = () => {
        if (globalFinisher || executionView.hasActor(selfId())) return false;
        if (!started || !alive || inputPaused || chargingSince !== null || inspectSince !== null) return false;
        const now = performance.now();
        if ((now - lastThrowAt) / 1000 <= THROW_COOLDOWN) return false; // disc not back in hand yet
        if (now < detainedUntil) return false;
        inspectSince = now;
        caught = false;
        goldInspect = holdingGold();
        if (goldInspect) {
            tintGhostsGold();
            sound.goldInspect(GOLD_INSPECT_SECONDS, GOLD_TOSS_AT, GOLD_CATCH_AT);
        } else {
            tintGhosts(localFrcSelected ? 0 : viewmodelHue < 0 ? colourFor('local') : viewmodelHue);
            sound.inspect(INSPECT_SECONDS, TOSS_AT, CATCH_AT);
        }
        return true;
    };
    const showBoard = (show: boolean) => {
        if (!show) return ui.scoreboard(null);
        const me = selfId();
        const rows = [...roster.values()]
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name))
            .map((entry) => ({ name: entry.name, kills: entry.kills, deaths: entry.deaths, me: entry.id === me }));
        ui.scoreboard(rows.length ? rows : [{ name: '离线练习', kills: 0, deaths: 0, me: true }]);
    };
    const executionTarget = () => {
        if (
            !started ||
            !alive ||
            spectating ||
            inputPaused ||
            globalFinisher !== null ||
            executionView.hasActor(selfId()) ||
            performance.now() < detainedUntil ||
            (!holdingGold() && ammo <= 0)
        )
            return null;
        const mine = pose();
        if (
            audioLab &&
            labHp > 0 &&
            !executionView.hasActor(labTargetId) &&
            canStartGlobalFinisher(mine, labTargetPose) &&
            !executionWatched(roomNow(), mine, labTargetPose)
        ) {
            const blocked = rigidbody
                .raycastAll(
                    new Vec3(mine.p[0], mine.p[1] + 0.3, mine.p[2]),
                    new Vec3(labTargetPose.p[0], labTargetPose.p[1] + 0.3, labTargetPose.p[2])
                )
                .some((hit) => hit.entity !== player);
            if (!blocked) return labTargetId;
        }
        if (net.state !== 'online' || roundState?.phase !== 'playing') return null;
        return (
            [...poses.entries()]
                .filter(
                    ([id, other]) =>
                        id !== selfId() &&
                        roster.get(id)?.alive &&
                        !roster.get(id)?.spectating &&
                        !executionView.hasActor(id) &&
                        canStartGlobalFinisher(mine, other) &&
                        !executionWatched(roomNow(), mine, other) &&
                        !rigidbody
                            .raycastAll(
                                new Vec3(mine.p[0], mine.p[1] + 0.3, mine.p[2]),
                                new Vec3(other.p[0], other.p[1] + 0.3, other.p[2])
                            )
                            .some((hit) => hit.entity !== player)
                )
                .sort(
                    (a, b) =>
                        Math.hypot(a[1].p[0] - mine.p[0], a[1].p[2] - mine.p[2]) -
                        Math.hypot(b[1].p[0] - mine.p[0], b[1].p[2] - mine.p[2])
                )[0]?.[0] ?? null
        );
    };
    let lastExecutionRequest = -Infinity;
    const beginFinisherHold = () => {
        if (globalFinisher || finisherHoldStartedAt !== null || finisherRequestId !== null) return;
        if (performance.now() - lastExecutionRequest < 250) return;
        const target = executionTarget();
        if (!target) return;
        lastExecutionRequest = performance.now();
        cancelCharge();
        finisherHoldTarget = target;
        finisherHoldStartedAt = performance.now();
        finisherCommitSent = false;
        ui.executionHold('holding', 0);
        if (!(audioLab && target === labTargetId)) {
            finisherRequestId = net.prepareExecution(target);
            net.pose(pose(), true);
        } else finisherRequestId = `practice:${performance.now()}`;
    };
    const cancelFinisherHold = () => {
        if (finisherRequestId && !finisherCommitSent && !finisherRequestId.startsWith('practice:'))
            net.cancelExecution(finisherRequestId);
        finisherRequestId = null;
        finisherHoldTarget = null;
        finisherHoldStartedAt = null;
        finisherCommitSent = false;
        ui.executionState(null, 0);
        ui.executionHold('ready');
    };
    const completeFinisherHold = () => {
        if (finisherHoldStartedAt === null || !finisherRequestId || !finisherHoldTarget) return;
        if (performance.now() - finisherHoldStartedAt < GLOBAL_FINISHER_CONFIG.holdDurationMs) {
            cancelFinisherHold();
            return;
        }
        if (executionTarget() !== finisherHoldTarget) {
            cancelFinisherHold();
            ui.notify('目标已离开处决范围');
            return;
        }
        if (finisherRequestId.startsWith('practice:')) {
            const now = roomNow();
            const record: Execution = {
                id: `practice-${now}`,
                attacker: { id: selfId(), name: nickname || '玩家', colour: colourFor(selfId()), pose: pose() },
                target: {
                    id: labTargetId,
                    name: '固定测试人偶',
                    colour: colourFor(labTargetId),
                    pose: { ...labTargetPose, p: [...labTargetPose.p] }
                },
                startsAt: now,
                endsAt: now + GLOBAL_FINISHER_CONFIG.cinematicDurationMs,
                variant: labGolden ? 'THE_BOOMERANG_GOLD' : 'THE_BOOMERANG'
            };
            labExecution = record;
            executionView.start(record, true);
            globalFinisher = {
                id: record.id,
                roundId: 0,
                sequence: 0,
                phase: 'active',
                attacker: record.attacker,
                target: record.target,
                variant: labGolden ? 'THE_BOOMERANG_GOLD' : 'THE_BOOMERANG',
                cinematicId: 'THE_BOOMERANG',
                cameraPlanId: 'COMPACT',
                pauseAt: now,
                startsAt: record.startsAt,
                endsAt: record.endsAt
            };
            ui.finisherMode(true);
        } else net.commitExecution(finisherRequestId);
        finisherCommitSent = true;
        finisherHoldStartedAt = null;
        ui.executionHold('confirmed', 1);
    };
    // The on-screen button is a real hold, like V: press to start, release to finish (early release cancels).
    ui.onExecute({
        begin: () => beginFinisherHold(),
        end: () => {
            if (finisherHoldStartedAt !== null) completeFinisherHold();
        }
    });
    window.addEventListener('keydown', (event) => {
        if (globalFinisher) {
            if (event.code !== 'Escape') event.preventDefault();
            return;
        }
        if (event.code === 'KeyV' && !event.repeat && locked()) {
            event.preventDefault();
            beginFinisherHold();
        }
        if (event.code === 'KeyE' && !event.repeat && locked()) interactNearby();
        if (
            event.code === 'KeyE' &&
            !event.repeat &&
            locked() &&
            alive &&
            !spectating &&
            !inputPaused &&
            performance.now() >= detainedUntil &&
            nearBreaker(pose().p) &&
            currentPower().pulledAt === null &&
            !executionView.hasActor(selfId()) &&
            (net.state !== 'online' || roundState?.phase === 'playing')
        ) {
            const now = roomNow();
            const nightAt = blackoutAt();
            if (nightAt === null || now < nightAt) {
                if (net.state === 'online') {
                    net.pose(pose(), true);
                    net.pullBreaker();
                } else power = { pulledAt: now };
            }
        }
        if (event.code === 'Tab' && locked()) {
            event.preventDefault();
            showBoard(true);
        }
        // F: inspect the disc in hand (only when it is in hand and not winding up).
        if (event.code === 'KeyF' && !event.repeat && locked()) startInspect();
        // Q while charging (or aiming): put the throw away.
        if (event.code === 'KeyQ' && chargingSince !== null) {
            cancelCharge();
            ui.popup('已取消投掷', 'hit');
        }
    });
    window.addEventListener('keyup', (event) => {
        if (event.code === 'Tab') showBoard(false);
        if (event.code === 'KeyV' && finisherHoldStartedAt !== null) completeFinisherHold();
    });
    window.addEventListener('blur', () => {
        cancelFinisherHold();
    });

    /** Combat feel 3.0, per frame: aim state, elimination marks and the final-kill slow motion. */
    const updateCombatFeel = (now: number) => {
        app.timeScale = now < slowMotionUntil ? FINAL_SLOW_MOTION.scale : 1;
        // Crosshair over a visible enemy within throwing range (checked ~15 times a second).
        if (now >= aimCheckAt) {
            aimCheckAt = now + 66;
            let on = false;
            if (started && alive && !spectating && locked()) {
                const eye = camera.getPosition(),
                    forward = camera.forward;
                const others = [...poses.entries()]
                    .filter(([id]) => id !== selfId() && roster.get(id)?.alive && !roster.get(id)?.spectating)
                    .map(([id, pose]): [string, V3] => [id, pose.p as V3]);
                const target = aimTarget(
                    [eye.x, eye.y, eye.z],
                    [forward.x, forward.y, forward.z],
                    others,
                    AIM_TARGET_RANGE
                );
                if (target) {
                    const centre = poses.get(target.id)!.p;
                    on = !rigidbody.raycastFirst(eye, new Vec3(centre[0], centre[1] + 0.3, centre[2]));
                }
            }
            ui.crosshairTarget(on);
        }
        // Elimination marks, projected to the screen and fading over their last second.
        const cam = camera.camera!;
        const marks: { x: number; y: number; alpha: number }[] = [];
        for (let i = killMarks.length - 1; i >= 0; i--) {
            const mark = killMarks[i];
            if (now >= mark.until) {
                killMarks.splice(i, 1);
                continue;
            }
            markPoint.set(mark.at[0], mark.at[1] + 0.2, mark.at[2]);
            cam.worldToScreen(markPoint, markScreen);
            if (markScreen.z <= 0) continue;
            marks.push({ x: markScreen.x, y: markScreen.y, alpha: Math.min(1, (mark.until - now) / 1000) });
        }
        ui.killMarks(marks);
    };
    const markPoint = new Vec3(),
        markScreen = new Vec3();
    const animateFeel = (deltaTime: number, now: number) => {
        flashlightView.enabled = localAbilities.flashlight && alive && !spectating;
        flashlightBeam.enabled = localAbilities.flashlight && alive && !spectating && !executionFrozen && !globalFinisher;
        if (executionView.hasActor(selfId())) {
            viewmodel.enabled = false;
            for (const ghost of ghosts) ghost.entity.enabled = false;
            return;
        }
        const cam = camera.camera!;
        punch = Math.max(0, punch - deltaTime * 6);
        // Sniper aim: the whole view zooms in gradually; sensitivity and walking speed follow the zoom.
        const held = chargingSince === null ? 0 : (now - chargingSince) / 1000;
        const target = chargingSince === null ? 0 : aimProgress(held);
        aim = target >= aim ? target : Math.max(target, aim - deltaTime * 5);
        if (aimHold !== null) aim = aimHold;
        if (chargingSince !== null && target > 0 && !aimSoundPlayed) {
            aimSoundPlayed = true;
            sound.scopeIn();
        }
        const ready = chargingSince !== null && aimReady(held);
        if (ready && !aimReadyPlayed) {
            aimReadyPlayed = true;
            sound.scopeReady();
        }
        const stealthActive = started && alive && !spectating && localStealthUntil > roomNow();
        const stealthTarget = stealthActive && feelMotion !== 'off' ? 1 : 0;
        stealthViewBlend += (stealthTarget - stealthViewBlend) * (1 - Math.exp(-deltaTime * 6));
        cam.fov =
            viewFov * fovFactor(aim) + punch * 2.5 * cameraImpulses.scale + stealthViewBlend * 5.5 * (1 - aim);
        const script = controller() as unknown as { lookSens?: number; speedGround?: number } | null;
        if (script) {
            script.lookSens = viewSens * sensitivityFactor(viewFov, aim);
            if (walkSpeed === null) walkSpeed = script.speedGround ?? 40;
            // Aiming slows you down; so does carrying the golden disc.
            script.speedGround =
                walkSpeed *
                (1 - (1 - SCOPE.moveScale) * aim) *
                (holdingGold() ? ROUND.goldSpeedFactor : 1);
        }
        ui.scope(aim, ready);
        const [impulseX, impulseY] = cameraImpulses.update(deltaTime);
        camera.setLocalPosition(eyeOffset.x + impulseX, eyeOffset.y + impulseY, eyeOffset.z);
        // In-hand disc: visible when ready, pulled back while charging, gone during the cooldown after a throw.
        const sinceThrow = (now - lastThrowAt) / 1000;
        const inHand = Math.min(1, Math.max(0, (sinceThrow - THROW_COOLDOWN * 0.5) / (THROW_COOLDOWN * 0.5)));
        const charge = chargingSince === null ? 0 : Math.min(1, (now - chargingSince) / 1000 / THROW.chargeSeconds);
        // No disc in hand (all thrown, none picked up yet): nothing to hold.
        viewmodel.enabled = started && alive && hasDisc();
        frcAura.enabled = viewmodel.enabled && localFrcSelected && !holdingGold();
        const frcPulse = 1 + Math.sin(now * 0.012) * 0.06;
        frcAura.setLocalScale(frcPulse, frcPulse, frcPulse);
        frcAura.setLocalEulerAngles(0, (now * 0.08) % 360, 0);
        if (!alive) inspectSince = null;
        const inspecting = inspectSince !== null || inspectHold !== null;
        const routine = goldInspect
            ? { seconds: GOLD_INSPECT_SECONDS, pose: goldInspectPose, inAir: goldAirborne, catchAt: GOLD_CATCH_AT }
            : { seconds: INSPECT_SECONDS, pose: inspectPose, inAir: airborne, catchAt: CATCH_AT };
        const u = inspecting ? (inspectHold ?? (now - inspectSince!) / 1000 / routine.seconds) : 1;
        if (u >= 1) inspectSince = null;
        // Afterimages follow the disc a few milliseconds behind while it flies.
        ghosts.forEach((ghost, index) => {
            const lag = u - (index + 1) * (goldInspect ? 0.008 : 0.011);
            ghost.entity.enabled = viewmodel.enabled && u < 1 && routine.inAir(u) && routine.inAir(lag);
            if (!ghost.entity.enabled) return;
            const [p, e] = routine.pose(lag);
            ghost.entity.setLocalPosition(p[0], p[1], p[2]);
            ghost.entity.setLocalEulerAngles(e[0], e[1], e[2]);
        });
        if (u < 1) {
            const [p, e] = routine.pose(u);
            viewmodel.setLocalPosition(p[0], p[1], p[2]);
            viewmodel.setLocalEulerAngles(e[0], e[1], e[2]);
            if (goldInspect && now - goldSparkAt > 16) {
                // Golden disc: sparks spiral up off it while it levitates and spins, and trail it through the air.
                goldSparkAt = now;
                const at = viewmodelWorld();
                const spinning = u > 0.1 && u < 0.44;
                const a = now / 40;
                const r = spinning ? 0.16 : 0.05;
                effects.mote(
                    [at[0] + Math.cos(a) * r, at[1] + (spinning ? 0.02 : 0), at[2] + Math.sin(a) * r],
                    Math.random() < 0.35 ? [1, 1, 1] : GOLD_COLOUR,
                    spinning ? [Math.cos(a) * 0.5, 1.1, Math.sin(a) * 0.5] : [0, 0.2, 0],
                    0.012 + Math.random() * 0.014,
                    0.7
                );
            }
            // Snap catch: a kick of the view (and a gold shockwave for the golden disc).
            if (!caught && u >= routine.catchAt && inspectHold === null) {
                caught = true;
                punch = Math.max(punch, goldInspect ? 1.1 : 0.55);
                cameraImpulses.trigger(0.28);
                if (goldInspect) {
                    const at = viewmodelWorld();
                    effects.ring(at, GOLD_COLOUR, 0.05, 0.45, 0.6);
                    for (let i = 0; i < 16; i++) {
                        const a = (i / 16) * Math.PI * 2;
                        effects.mote(at, GOLD_COLOUR, [Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0.3], 0.01, 0.45, 2);
                    }
                }
            }
            return;
        }
        const bob = Math.sin(now / 260) * 0.004 * (1 - aim);
        // While aiming the disc is brought in under the eye and drops out of the scoped view (the narrow field of
        // view magnifies it, so it sinks well below the frame and is hidden once the scope is mostly up).
        viewmodel.enabled = viewmodel.enabled && aim < 0.7;
        viewmodel.setLocalPosition(
            0.3 + charge * 0.09 - aim * 0.3,
            -0.31 - (1 - inHand) * 0.25 + charge * 0.05 + bob - aim * 0.5,
            -0.66 + charge * 0.16 + aim * 0.1
        );
        viewmodel.setLocalEulerAngles(
            18 - charge * 25 + aim * 50,
            -12 - charge * 30 + aim * 42,
            -8 - charge * 10 + aim * 18
        );
    };

    const markerScreen = new Vec3();
    const markerWorld = new Vec3();
    /** Where the golden disc is right now (lying spot, or the holder's position), or null. */
    const goldPosition = (): V3 | null => {
        const state = goldView.state;
        if (!state) return null;
        if (state.holder === null) return state.at;
        if (state.holder === selfId()) {
            const p = player.getPosition();
            return [p.x, p.y, p.z];
        }
        return positionOf(state.holder) ?? null;
    };
    let roundEndSecond = -1;
    const beginLocalTestRound = (now = roomNow()) => {
        roundState = { phase: 'playing', endsAt: now + ROUND.roundSeconds * 1000 };
        roundEndSecond = -1;
    };
    /** Per frame: 纪老师, the golden disc, detention, the round clock and the on-screen gold marker. */
    const updateRound = (now: number) => {
        if (warming) return;
        if (audioLab && started && roundState) {
            const matchTime = roomNow();
            if (roundState.phase === 'playing' && matchTime >= roundState.endsAt) {
                const winnerId = holdingGold() ? selfId() : null;
                roundState = {
                    phase: 'ended',
                    winner: winnerId ? nickname || '你' : null,
                    winnerId,
                    outcome: winnerId ? 'golden-disc' : 'draw',
                    nextAt: matchTime + ROUND.intermissionSeconds * 1000
                };
                sound.roundEnd(winnerId === selfId(), winnerId ? 'golden-disc' : 'draw');
                ui.notify(winnerId ? '回合结束 · 你守住了金飞盘' : '回合结束 · 无人持有金飞盘');
            } else if (roundState.phase === 'ended' && matchTime >= roundState.nextAt) {
                beginLocalTestRound(matchTime);
                goldView.set(null);
                goldThrowCount = 0;
                goldCooldownUntil = 0;
                power = { pulledAt: null };
                labNightOverride = false;
                labNightAt = null;
                labFinalOverride = false;
                labPowerOverride = null;
                labMomentCutscene = null;
                finalShown = false;
                finalDone = false;
                finalRelocationResult = 'idle';
                shuttersShut = false;
                sound.roundStart();
                ui.notify('新一局开始！争夺金飞盘');
            }
        }
        if (net.state !== 'online') {
            let returned = false;
            for (const item of worldItems) {
                if (item.returnAt === null || roomNow() < item.returnAt) continue;
                const spawn = ITEM_SPAWNS.find((candidate) => candidate.id === item.id);
                if (!spawn) continue;
                item.at = [...spawn.at];
                item.available = true;
                item.holder = null;
                item.returnAt = null;
                returned = true;
            }
            if (returned) applyWorldItems(worldItems);
        }
        for (const item of worldItems) {
            const mesh = pickupMeshes.get(item.id);
            if (!mesh || !item.available) continue;
            const phase = ITEM_SPAWNS.findIndex((spawn) => spawn.id === item.id) * 1.7;
            mesh.setPosition(item.at[0], item.at[1] + 0.34 + Math.sin(now * 0.002 + phase) * 0.07, item.at[2]);
            mesh.setEulerAngles(0, (now * 0.045 + phase * 57.3) % 360, 0);
            const pulse = 1 + Math.sin(now * 0.003 + phase) * 0.045;
            mesh.setLocalScale(pulse, pulse, pulse);
        }
        teacher.update(roomNow(), now, 0);
        // Offline practice: a golden disc of your own to find.
        if (started && net.state !== 'online' && !goldView.state) {
            const [x, z] = SPAWN_POINTS[10];
            goldView.set({ holder: null, at: [x, 0.92, z] });
        }
        const state = goldView.state;
        const me = selfId();
        if (state && net.state !== 'online' && state.holder === null && alive) {
            const p = player.getPosition();
            if (Math.hypot(p.x - state.at[0], p.z - state.at[2]) < ROUND.pickupRadius) {
                goldView.set({ holder: me, at: state.at });
                goldView.flourish(viewmodelWorld());
                sound.goldTaken();
                ui.popup('夺得金飞盘！', 'gold');
            }
        }
        const holder = goldHolder();
        const mine = holder !== null && holder === me;
        // Gold takes visual priority; otherwise the selected FRC disc replaces the normal hand disc.
        setViewmodelSkin(mine ? 'gold' : localFrcSelected ? 'frc' : 'normal');
        if (mine && viewmodel.enabled && inspectSince === null && now - goldSparkAt > 90) {
            goldSparkAt = now;
            const [x, y, z] = viewmodelWorld();
            effects.mote(
                [x + (Math.random() - 0.5) * 0.12, y + 0.02, z + (Math.random() - 0.5) * 0.12],
                GOLD_COLOUR,
                [0, 0.25, 0],
                0.006,
                0.5
            );
        }
        // 纪老师's circle: stepping into it means standing still for a few seconds, frisbee or not. Once released you
        // get a few seconds to walk out before he can stop you again.
        const watched =
            started && playerPhase === 'playing' && alive && !spectating && !executionView.hasActor(selfId()) && teacher.sees(player.getPosition());
        if (watched !== inWatch) {
            inWatch = watched;
            ui.watchWarning(watched);
        }
        if (watched && !warming && now >= detainedUntil && now >= teacherGraceUntil) {
            detainedUntil = now + DETENTION_SECONDS * 1000;
            teacherGraceUntil = detainedUntil + 4000;
            teacher.say('站住！禁止打飞盘！', now);
            sound.whistle();
            ui.popup('纪老师：禁止打飞盘！罚站！', 'me');
            ui.feed(`被纪老师抓到 · 罚站 ${DETENTION_SECONDS} 秒`, 'me');
            net.caught();
        }
        // The night guard: at the south gate until the lights go out, then on his rounds with a flashlight.
        const lightsOut = blackoutAt();
        const time = roomNow();
        const activePower = currentPower();
        const outage = powerOut(time, activePower);
        const nightActive =
            ((net.state === 'online' || audioLab) && lightsOut !== null && time >= lightsOut) ||
            (audioLab && labNightOverride);
        guard.update(time, lightsOut, activePower);
        // Event cutscenes: everyone sees the moment the lights go out / the breaker is pulled, frozen meanwhile.
        const cut = started && !ceremonyRun ? activeCutscene(time, lightsOut, activePower, currentMomentCutscene ?? labMomentCutscene) : null;
        if (cut && !cutsceneRun) {
            const elapsed = (time - cut.at) / 1000;
            const beats = new Set<string>();
            // Seeking a welcome snapshot must not replay one-shot cues that happened before this client joined.
            if (welcomeSyncPending) {
                const cueTimes = cut.kind === 'breaker'
                    ? [['spark1', 0.05], ['spark2', 0.45], ['spark3', 0.9]] as const
                    : cut.kind === 'blackout'
                      ? [['torch', 1.75]] as const
                      : cut.kind === 'last-two'
                        ? [['duel', 0.25]] as const
                        : [];
                for (const [name, at] of cueTimes) if (elapsed >= at) beats.add(name);
            }
            cutsceneRun = { kind: cut.kind, at: cut.at, moment: cut.moment ?? null, skipped: false, lastPerf: performance.now(), beats };
            cutsceneView.start();
            ui.cutscene(CUTSCENE_CAPTIONS[cut.kind]);
            inputPaused = true;
            chargingSince = null;
            ui.charge(null);
            const script = controller();
            if (script) script.enabled = false;
        }
        if (cutsceneRun) {
            const perfNow = performance.now();
            const dt = Math.min(0.1, (perfNow - cutsceneRun.lastPerf) / 1000);
            cutsceneRun.lastPerf = perfNow;
            const t = (time - cutsceneRun.at) / 1000;
            const beat = (name: string, at: number, action: () => void) => {
                if (t >= at && !cutsceneRun!.beats.has(name)) {
                    cutsceneRun!.beats.add(name);
                    action();
                }
            };
            if (cutsceneRun.kind === 'breaker') {
                const [bx, by, bz] = BREAKER_CABINET;
                for (const [name, at] of [['spark1', 0.05], ['spark2', 0.45], ['spark3', 0.9]] as const)
                    beat(name, at, () => {
                        // A spray of small sparks off the cabinet front.
                        for (let i = 0; i < 14; i++) {
                            const angle = Math.random() * Math.PI * 2;
                            effects.mote(
                                [bx, by + 0.35, bz],
                                [1, 0.75 + Math.random() * 0.2, 0.3],
                                [Math.cos(angle) * 1.6, 1 + Math.random() * 1.8, Math.sin(angle) * 1.6],
                                0.012,
                                0.45
                            );
                        }
                        sound.impact([bx, by, bz]);
                    });
            } else if (cutsceneRun.kind === 'blackout') beat('torch', 1.75, () => sound.ceremonySpot());
            else if (cutsceneRun.kind === 'last-two') beat('duel', 0.25, () => sound.ceremonySpot());
            if (!cutsceneRun.skipped)
                cutsceneView.update(
                    cutsceneShot(
                        cutsceneRun.kind,
                        t,
                        guardAt(time, lightsOut, activePower),
                        [...BREAKER_CABINET] as [number, number, number],
                        cutsceneRun.moment
                    ),
                    dt
                );
            const over = !cut || cut.at !== cutsceneRun.at;
            if ((cutsceneRun.skipped || over) && cutsceneView.active) {
                // Skipping only hands back the view and controls; the room still protects everyone until it ends.
                cutsceneView.stop();
                ui.cutscene(null);
                inputPaused = false;
                const script = controller();
                if (script) script.enabled = alive && !executionFrozen && !spectating;
            }
            if (over) cutsceneRun = null;
        }
        breakerView.update(outage);
        if (outage !== wasPowerOut) {
            wasPowerOut = outage;
            if (outage) {
                sound.blackout();
                ui.broadcastText('总闸被拉下！全校断电 · 保安前往配电室');
            } else if (activePower.pulledAt !== null) {
                ui.broadcastText(nightActive ? '保安已合闸 · 终局夜晚继续' : '保安已恢复供电，正在返回原位');
                sound.pickup();
            }
        }
        const near = started && playerPhase !== 'lobby' && alive && !spectating ? nearestInteraction() : null;
        ui.interaction(
            near
                  ? (() => {
                        const talk = near.id.startsWith('coach-') || near.id === 'mark';
                        const skill = activeLocalSkill();
                        const item = worldItems.find((candidate) => candidate.id === near.id);
                        const replacesSkill =
                            skill !== null && (item ? item.kind !== skill : near.id === 'mark' && skill !== 'creation');
                        return `E ${talk ? '交谈' : '拾取'} ${near.name}${replacesSkill ? ' · 替换当前技能' : ''}`;
                    })()
                  : started && alive && !spectating && nearBreaker(pose().p)
                    ? activePower.pulledAt === null
                        ? nightActive
                            ? '终局夜晚 · 无法拉闸'
                            : 'E 拉闸 · 全服每局限一次'
                        : outage
                          ? '全校断电 · 保安正在恢复供电'
                          : '本局已拉闸 · 无法再次使用'
                    : null
        );
        dark = nightActive || outage;
        if (nightActive && !wasNight) {
            if (!outage) sound.blackout();
            ui.broadcastText('终局夜晚开始 · 被保安手电筒照到即出局');
            ui.feed('从现在起被淘汰就不能复活，只剩最后一人时直接获胜', 'me');
        }
        wasNight = nightActive;
        if (nightActive && !ceremonyRun && playerPhase === 'playing' && alive && !spectating && !spottedSent && guard.catches(player.getPosition(), player)) {
            spottedSent = true;
            ui.popup('被保安的手电筒照到了！', 'me');
            net.spotted();
        }
        // Watching: the camera follows someone still in the game.
        const wantFan = started && spectating && standsOpenNow();
        if (wantFan && !fanMode) enterFanMode();
        else if (!wantFan && fanMode) leaveFanMode();
        const seal = parapetSeal();
        const sealOn = standsOpenNow();
        if (seal && seal.enabled !== sealOn) seal.enabled = sealOn;
        if (spectating && !fanMode) spectate(now);
        // In the dark the golden disc (and whoever carries it) is lit up for everyone to find.
        const goldAt = goldPosition();
        goldLight.light!.intensity = dark && goldAt ? 2.6 : 0;
        if (goldAt) goldLight.setPosition(goldAt[0], goldAt[1] + 1.6, goldAt[2]);
        // The entrance ceremony in the CEREMONY.seconds before the final minute (same room clock on every client).
        const ceremonyAt =
            labCeremony?.at ??
            ((net.state === 'online' || audioLab) && roundState?.phase === 'playing'
                ? roundState.endsAt - (ROUND.finalSecondsLeft + CEREMONY.seconds) * 1000
                : null);
        // `endsAt` and ceremonyAt use Match Time. Using the real server clock here lets earlier pauses
        // consume the ceremony before the authoritative final-minute boundary is reached.
        const ceremonyT = ceremonyAt === null ? -1 : (roomNow() - ceremonyAt) / 1000;
        if (!ceremonyRun && started && ceremonyAt !== null && ceremonyT >= 0 && ceremonyT < CEREMONY.seconds) {
            const entrants: Entrant[] =
                labCeremony?.entrants ??
                (audioLab && roster.size === 0
                    ? [{ id: selfId(), name: nickname || '你', kills: 0, deaths: 0, score: 0, colour: hueColour(colourFor('local')), equipment: '普通飞盘' }]
                    : [...roster.values()]
                          .filter((entry) => entry.phase === 'playing' && entry.alive && !entry.spectating)
                          .map((entry) => ({
                              id: entry.id,
                              name: entry.name,
                              kills: entry.kills,
                              deaths: entry.deaths,
                              score: entry.score,
                              colour: hueColour(entry.colour),
                              equipment: ceremonyLoadout(entry),
                              skill: ceremonySkills(entry) || undefined
                          })));
            if (entrants.length) {
                // The fans' section gets its own shot when anyone is sitting in it.
                const fanCount =
                    [...roster.values()].filter((entry) => entry.spectating).length +
                    (labCeremony ? 14 : 0) +
                    (labFan ? 1 : 0);
                const plan = planCeremony(entrants, arenaCenter, ceremony.doors, { focus: fanFocus, count: fanCount });
                ceremonyRun = { at: ceremonyAt, plan, moved: false, lastPerf: performance.now(), t: ceremonyT };
                // Fans in the stands watch it live from where they stand; everyone else gets the film.
                const film = !fanMode;
                ceremony.start(plan, (id) => avatars.headImage(id), film);
                ceremonyCardId = null;
                ui.ceremony.card(null);
                // A player joining mid-ceremony picks it up where it is, without replaying the opening sound.
                const seekingWelcome = welcomeSyncPending && ceremonyT > 0.15;
                if (seekingWelcome) ceremony.update(ceremonyT, 0);
                if (!seekingWelcome) sound.ceremonyDark();
                if (film) {
                    ui.ceremony.show(true);
                    inputPaused = true;
                    chargingSince = null;
                    ui.charge(null);
                    const script = controller();
                    if (script) script.enabled = false;
                }
            }
        }
        if (ceremonyRun) {
            const perfNow = performance.now();
            const dt = Math.min(0.1, (perfNow - ceremonyRun.lastPerf) / 1000);
            ceremonyRun.lastPerf = perfNow;
            const t = (roomNow() - ceremonyRun.at) / 1000;
            ceremonyRun.t = t;
            const { plan } = ceremonyRun;
            const fadeOutAt = CEREMONY.seconds - CEREMONY.fadeOut;
            // A quick dip to black on the cut from the exterior to the inside.
            const cutAt = CEREMONY.fade + CEREMONY.exterior;
            const dip = Math.max(0, 1 - Math.abs(t - cutAt) / 0.18);
            if (!fanMode)
                ui.ceremony.fade(
                    t < CEREMONY.fade
                        ? t / CEREMONY.fade
                        : t >= fadeOutAt
                          ? (t - fadeOutAt) / CEREMONY.fadeOut
                          : Math.max(dip, 1 - (t - CEREMONY.fade) / 0.6)
                );
            // Under the black: everyone still in the game is moved to their entrance mark, facing the court.
            if (!ceremonyRun.moved && t >= CEREMONY.fade * 0.9) {
                ceremonyRun.moved = true;
                const mine = plan.entrants.find((entry) => entry.id === selfId());
                if (mine && alive && !spectating) {
                    player.rigidbody!.teleport(mine.to[0], 0.92, mine.to[2], 0, 0, 0);
                    player.rigidbody!.linearVelocity = Vec3.ZERO;
                    setLook(player, 0, (mine.faceYaw * 180) / Math.PI);
                    net.pose(pose(), true, true);
                    finalDone = true;
                    finalRelocationResult = 'ceremony';
                }
            }
            const events = ceremony.update(t, dt);
            if (events.launched) sound.fireworkLaunch();
            if (events.burst) sound.fireworkBurst(events.burst);
            for (const entrant of events.entered) {
                sound.ceremonySpot();
                sound.crowd([entrant.to[0], 6, entrant.to[2]], 'cheer');
            }
            const focusedEntrant = featuredEntrantAt(plan, t);
            if (focusedEntrant?.id !== ceremonyCardId) {
                ceremonyCardId = focusedEntrant?.id ?? null;
                ui.ceremony.card(
                    focusedEntrant
                        ? {
                              name: focusedEntrant.id === selfId() ? `${focusedEntrant.name}（你）` : focusedEntrant.name,
                              order: focusedEntrant.order + 1,
                              total: plan.entrants.length,
                              kills: focusedEntrant.kills,
                              deaths: focusedEntrant.deaths,
                              score: focusedEntrant.score,
                              equipment: focusedEntrant.equipment,
                              skill: focusedEntrant.skill,
                              colour: `rgb(${focusedEntrant.colour.map((c) => Math.round(c * 255)).join(' ')})`
                          }
                        : null
                );
            }
            if (events.shut.length) sound.ceremonyShutter();
            for (const ring of events.struck) {
                sound.ceremonyRing(ring);
                if (ring === CEREMONY.rings - 1) sound.crowd([arenaCenter[0], 8, arenaCenter[1]], 'confetti');
            }
            ui.ceremony.title(t >= plan.holdAt - 0.2);
            if (t >= CEREMONY.seconds || (ceremonyAt === null && !labCeremony)) {
                ceremony.stop();
                ui.ceremony.show(false);
                ui.ceremony.fade(0);
                ceremonyRun = null;
                inputPaused = false;
                const script = controller();
                if (script) script.enabled = (alive && !executionFrozen && !spectating) || fanMode;
            }
        }
        // In the offline test lab, the final showdown starts as soon as its entry ceremony completes.
        if (audioLab && labFinalAfterCeremony && labCeremony && ceremonyT >= CEREMONY.seconds) {
            labFinalOverride = true;
            labFinalAfterCeremony = false;
        }
        // The entrances stay shut (and the lamp rings lit) for the final minute.
        const finalFight =
            ceremonyAt !== null &&
            ceremonyT >= CEREMONY.seconds - CEREMONY.fadeOut - CEREMONY.hold - 1 &&
            (labCeremony ? ceremonyT < CEREMONY.seconds + 30 : roundState?.phase === 'playing');
        if (!ceremonyRun && finalFight !== shuttersShut) {
            shuttersShut = finalFight;
            ceremony.setShuttersClosed(finalFight);
            ceremony.setRingsLit(finalFight);
            if (!finalFight && labCeremony) {
                labCeremony = null;
                // End of the stands test: back in the game where you stand.
                if (labFan) {
                    labFan = false;
                    if (fanMode) leaveFanMode();
                    stopSpectating();
                    setAlive(true);
                }
            }
        }
        // The final minute: floodlights over the 莲花球场, and everyone still in the game is brought there.
        const finalAt = roundState?.phase === 'playing' ? roundState.endsAt - ROUND.finalSecondsLeft * 1000 : null;
        const finalNow =
            (((net.state === 'online' || audioLab) && finalAt !== null && roomNow() >= finalAt) ||
                (audioLab && labFinalOverride));
        const showdown = finalNow || !!ceremonyRun;
        const matchStartAt =
            roundState?.phase === 'playing' ? roundState.endsAt - ROUND.roundSeconds * 1000 : time;
        const blackoutStartAt = outage
            ? activePower.pulledAt ?? time
            : nightActive && lightsOut !== null
              ? lightsOut
              : time;
        const finalMusicStartAt = ceremonyRun ? ceremonyAt ?? finalAt ?? time : finalAt ?? time;
        const audioSeek = welcomeSyncPending && started;
        sound.matchPlaylistMusic(
            started &&
                (!audioLab || roundState?.phase === 'playing') &&
                (net.state !== 'online' || roundState?.phase === 'playing') &&
                !dark &&
                !showdown,
            Math.max(0, (time - matchStartAt) / 1000),
            audioSeek
        );
        sound.blackoutMusic(dark && !showdown, Math.max(0, (time - blackoutStartAt) / 1000), audioSeek);
        sound.finalShowdownMusic(started && showdown, Math.max(0, (time - finalMusicStartAt) / 1000), audioSeek);
        const settlementStarted = started && (roundState?.phase === 'ended' || labMvp !== null);
        const settlementAt =
            roundState?.phase === 'ended'
                ? roundState.nextAt - ROUND.intermissionSeconds * 1000
                : (labMvp?.at ?? roomNow());
        sound.settlementMusic(settlementStarted, Math.max(0, (roomNow() - settlementAt) / 1000), audioSeek);
        if (audioSeek) welcomeSyncPending = false;
        if (finalNow !== finalShown) {
            finalShown = finalNow;
            floodlightFrom = floodlights[0].light!.intensity;
            floodlightTransitionAt = now;
            if (finalNow) {
                ui.broadcastText(finalDone ? '最终对决开始 · 入口已封闭' : '最终对决！所有存活玩家传送到莲花球场');
                sound.roundStart();
            }
        }
        const floodlightTarget = finalNow ? 2.4 : 0;
        const floodlightProgress = Math.min(1, Math.max(0, (now - floodlightTransitionAt) / 420));
        for (const light of floodlights) {
            light.light!.intensity = ceremonyRun
                ? ceremony.floodLevel(ceremonyRun.t) * 2.4
                : floodlightFrom + (floodlightTarget - floodlightFrom) * floodlightProgress;
        }
        if (!finalNow && !(ceremonyT >= 0)) finalDone = false;
        if (finalNow && !finalDone && alive && !spectating && started) {
            finalDone = true;
            finalRelocationResult = 'pending';
            ui.arenaTransition(() => {
                const current = roundState;
                const localTestFinal = audioLab && (labFinalOverride || (finalAt !== null && roomNow() >= finalAt));
                if (
                    !alive ||
                    spectating ||
                    !started ||
                    (!localTestFinal &&
                        (net.state !== 'online' ||
                            current?.phase !== 'playing' ||
                            roomNow() < current.endsAt - ROUND.finalSecondsLeft * 1000))
                ) {
                    const reason = !alive
                        ? 'dead'
                        : spectating
                          ? 'spectating'
                          : !started
                            ? 'not-started'
                            : !localTestFinal && net.state !== 'online'
                              ? 'offline'
                              : current?.phase !== 'playing'
                                ? 'round-ended'
                                : 'early';
                    finalRelocationResult = `skipped:${reason}`;
                    return;
                }
                // Spread out round the middle of the court (a fixed spot per player, so nobody lands on anyone).
                const id = selfId();
                let hash = 0;
                for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
                const r = 5 + (hash % 5);
                let a = ((hash % 360) * Math.PI) / 180;
                // Never on the tennis net, which crosses the court's middle (east–west through the arena centre).
                if (Math.abs(Math.sin(a) * r) < 1.2) a += 0.4;
                player.rigidbody!.teleport(
                    arenaCenter[0] + Math.cos(a) * r,
                    0.92,
                    arenaCenter[1] + Math.sin(a) * r,
                    0,
                    0,
                    0
                );
                player.rigidbody!.linearVelocity = Vec3.ZERO;
                setLook(player, 0, (Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI);
                net.pose(pose(), true, true);
                finalRelocationResult = 'relocated';
            });
        }
        // Carrying the golden disc: no faster in the air than on the ground (jumping must not dodge the slowdown).
        const body = player.rigidbody;
        const controllerState = controller() as unknown as { _grounded?: boolean } | null;
        if (body && holdingGold() && controllerState) {
            const v = body.linearVelocity;
            const horizontal = Math.hypot(v.x, v.z);
            if (controllerState._grounded) groundCap = Math.max(horizontal, groundCap * 0.98, 0.5);
            else if (horizontal > groundCap && groundCap > 0) {
                const k = groundCap / horizontal;
                body.linearVelocity = new Vec3(v.x * k, v.y, v.z * k);
            }
        }
        const holderPosition = holder && !mine ? (positionOf(holder) ?? null) : null;
        // The ceremony's night exterior (and the opening flyover) show the stadium alone: no golden-disc beam.
        goldView.hideBeam(introBeamHidden || (!!ceremonyRun && ceremonyRun.t < CEREMONY.fade + CEREMONY.exterior));
        goldView.update(now, holderPosition, mine);

        const eyeEnabled = localAbilities.eye && started && alive && !spectating;
        ui.playerPings(
            eyeEnabled
                ? [...poses]
                      .filter(([id]) => id !== selfId())
                      .flatMap(([id, each]) => {
                          const summary = roster.get(id);
                          if (summary?.phase !== 'playing' || summary.alive === false || (summary.stealthUntil ?? 0) > roomNow()) return [];
                          markerWorld.set(each.p[0], each.p[1] + 1.45, each.p[2]);
                          camera.camera!.worldToScreen(markerWorld, markerScreen);
                          return markerScreen.z > 0
                              ? [{
                                    id,
                                    name: summary.name,
                                    x: markerScreen.x,
                                    y: markerScreen.y,
                                    distance: Math.hypot(each.p[0] - player.getPosition().x, each.p[2] - player.getPosition().z)
                                }]
                              : [];
                      })
                : []
        );
        const clockNow = roomNow();
        const abilityLabels: string[] = [];
        const abilityProgress: number[] = [];
        if (localAbilities.frc) {
            const remaining = Math.max(0, localFrcCooldownUntil - clockNow);
            abilityLabels.push(remaining ? `FRC 冷却 ${Math.ceil(remaining / 1000)} 秒` : `Enter ${localFrcSelected ? '切回普通盘' : '切换 FRC'}`);
            abilityProgress.push(1 - remaining / ITEM_RULES.frcCooldownMs);
        }
        if (localAbilities.stealth) {
            const remaining = Math.max(0, localStealthCooldownUntil - clockNow);
            const active = localStealthUntil > clockNow;
            abilityLabels.push(active ? `隐身 ${Math.ceil((localStealthUntil - clockNow) / 1000)} 秒` : `Enter 请假条${remaining ? ` 冷却 ${Math.ceil(remaining / 1000)} 秒` : ' 就绪'}`);
            abilityProgress.push(remaining ? 1 - remaining / ITEM_RULES.stealthCooldownMs : 1);
            const stealthRemaining = Math.max(0, localStealthUntil - clockNow);
            ui.stealthState(
                active && alive && !spectating ? stealthRemaining / 1000 : null,
                stealthRemaining / ITEM_RULES.stealthDurationMs
            );
        } else {
            ui.stealthState(null);
        }
        if (localAbilities.revive) abilityLabels.push('复活甲 · 可抵挡一次淘汰');
        if (localAbilities.eye) abilityLabels.push('监控室之眼 · 全场位置已标记');
        if (localAbilities.flashlight) abilityLabels.push('手电筒 · 照亮视线前方');
        if (localAbilities.creation) {
            if (ammo >= localAmmoCapacity) {
                // Full: the room holds the refill timer until a disc is thrown.
                abilityLabels.push('创造之力 · 飞盘已满');
                abilityProgress.push(1);
            } else {
                const remaining = Math.min(ITEM_RULES.creationRefillMs, Math.max(0, creationNextAt - clockNow));
                abilityLabels.push(`创造之力 · 下次补充 ${Math.max(1, Math.ceil(remaining / 1000))} 秒`);
                abilityProgress.push(1 - remaining / ITEM_RULES.creationRefillMs);
            }
        }
        refreshLocalSkin();
        ui.abilityStatus(abilityLabels.length ? abilityLabels.join('　·　') : null, abilityProgress.length ? Math.min(...abilityProgress) : 1);

        // Detention: frozen in place (looking around is allowed) until the time is up.
        const script = controller() as unknown as { speedGround: number; speedAir: number; jumpForce: number } | null;
        const detained = now < detainedUntil;
        if (script) {
            if (!speeds) speeds = { ground: script.speedGround, air: script.speedAir, jump: script.jumpForce };
            if (detained) {
                script.speedGround = 0;
                script.speedAir = 0;
                script.jumpForce = 0;
                chargingSince = null;
            } else if (detentionShown) {
                script.speedAir = speeds.air;
                script.jumpForce = speeds.jump;
            }
        }
        if (detained) {
            detentionShown = true;
            ui.detention((detainedUntil - now) / 1000, DETENTION_SECONDS);
        } else if (detentionShown) {
            detentionShown = false;
            ui.detention(null);
        }

        // Round clock, golden disc status and end-of-round banner.
        const roomMs = roomNow();
        const current = roundState;
        // The MVP sequence opens the intermission for everyone.
        const mvpAt =
            labMvp?.at ??
            ((net.state === 'online' || audioLab) && current?.phase === 'ended'
                ? current.nextAt - ROUND.intermissionSeconds * 1000
                : null);
        const mvpT = mvpAt === null ? -1 : (roomMs - mvpAt) / 1000;
        if (!mvpRun && started && !ceremonyRun && mvpAt !== null && mvpT >= 0 && mvpT < MVP.seconds - 1) {
            const ended = current?.phase === 'ended' ? current : null;
            const entry =
                labMvp?.entry ??
                (ended?.winnerId ? roster.get(ended.winnerId) : undefined) ??
                [...roster.values()].filter((p) => p.phase === 'playing').sort((a, b) => b.score - a.score)[0];
            if (entry) startMvp(mvpAt, entry, labMvp?.outcome ?? ended?.outcome ?? 'draw');
        }
        if (mvpRun) {
            const t = (roomMs - mvpRun.at) / 1000;
            mvpView.update(t);
            ui.ceremony.fade(t > MVP.seconds - MVP.fadeOut ? (t - (MVP.seconds - MVP.fadeOut)) / MVP.fadeOut : 0);
            if (t >= MVP.seconds || mvpAt !== mvpRun.at) {
                stopMvp();
                if (labMvp) labMvp = null;
            }
        }
        if ((net.state === 'online' || audioLab) && current) {
            if (current.phase === 'playing') {
                ui.roundClock(Math.max(0, (current.endsAt - roomMs) / 1000));
                if (roundEndSecond !== -1) {
                    roundEndSecond = -1;
                    ui.roundEnd(null);
                }
            } else {
                ui.roundClock(0);
                const left = Math.max(0, (current.nextAt - roomMs) / 1000);
                if (Math.ceil(left) !== roundEndSecond) {
                    roundEndSecond = Math.ceil(left);
                    ui.roundEnd({
                        winner: current.winner,
                        mine: current.winnerId === me,
                        outcome: current.outcome,
                        nextIn: left
                    });
                }
            }
        } else {
            ui.roundClock(null);
        }
        ui.goldStatus(
            !state
                ? '金飞盘未出现'
                : mine
                  ? '你持有金飞盘 · 守住它！'
                  : holder
                    ? `${nameOf(holder)} 持有金飞盘`
                    : '金飞盘无人持有 · 去抢！',
            !state ? 'neutral' : mine ? 'mine' : holder ? 'other' : 'lying'
        );
        // On-screen marker: where it lies, or over its holder's head.
        const target = mine ? null : goldPosition();
        if (!target || !started) {
            ui.goldMarker(null);
            return;
        }
        markerWorld.set(target[0], target[1] + (holder ? 1.3 : 0.6), target[2]);
        camera.camera!.worldToScreen(markerWorld, markerScreen);
        const width = window.innerWidth;
        const height = window.innerHeight;
        const eye = camera.getPosition();
        const distance = Math.round(Math.hypot(target[0] - eye.x, target[2] - eye.z));
        const label = holder ? `${nameOf(holder)} · ${distance} m` : `金飞盘 · ${distance} m`;
        const margin = 48;
        const inFront = markerScreen.z > 0;
        if (
            inFront &&
            markerScreen.x > margin &&
            markerScreen.x < width - margin &&
            markerScreen.y > margin &&
            markerScreen.y < height - margin
        ) {
            ui.goldMarker({ x: markerScreen.x, y: markerScreen.y, angle: null, label });
            return;
        }
        // Off screen (or behind): pin to the edge in its direction.
        let dx = markerScreen.x - width / 2;
        let dy = markerScreen.y - height / 2;
        if (!inFront) {
            dx = -dx;
            dy = -dy;
        }
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = height;
        const scale = Math.min(
            (width / 2 - margin) / Math.abs(dx || 1e-6),
            (height / 2 - margin) / Math.abs(dy || 1e-6)
        );
        ui.goldMarker({
            x: width / 2 + dx * scale,
            y: height / 2 + dy * scale,
            angle: (Math.atan2(dy, dx) * 180) / Math.PI,
            label
        });
    };

    /** Other in-round players, visible on the map only while carrying the monitoring-room eye. */
    const radarPlayers = () => {
        if (!localAbilities.eye) return [];
        return [...poses]
            .filter(([id]) => id !== selfId() && roster.get(id)?.phase === 'playing' && roster.get(id)?.alive !== false && !roster.get(id)?.stealthUntil)
            .map(([id, each]) => ({ x: each.p[0], z: each.p[2], colour: roster.get(id)?.colour ?? 0 }));
    };
    const mapMarkers = () => {
        const at = goldPosition();
        const teacherPose = teacher.pose;
        return {
            gold: at ? { x: at[0], z: at[2], held: goldHolder() !== null } : null,
            teacher: { x: teacherPose.x, z: teacherPose.z, yaw: teacherPose.yaw, range: TEACHER.range },
            players: radarPlayers(),
            specialLocations: [
                ...SPECIAL_LOCATIONS.map((location) =>
                    location.id === 'medical' && worldItems.find((item) => item.id === 'item-revive')?.available
                        ? { ...location, colour: '#f7e86a' }
                        : location
                ),
                ...worldItems
                    .filter((item) => item.available)
                    .map((item) => ({
                        id: item.id,
                        short: item.kind === 'revive' ? '甲' : item.kind === 'frc' ? 'F' : item.kind === 'eye' ? '眼' : item.kind === 'stealth' ? '假' : item.kind === 'creation' ? '创' : '筒',
                        name: item.name,
                        x: item.at[0],
                        z: item.at[2],
                        colour: item.kind === 'revive' ? '#ff9f9a' : item.kind === 'frc' ? '#ff5b4d' : item.kind === 'eye' ? '#65d8e8' : item.kind === 'stealth' ? '#b49aff' : item.kind === 'creation' ? '#b8d879' : '#ffe19a'
                    }))
            ]
        };
    };
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
        /** Call after any teleport the game performs outside match.ts (fall recovery, R, G). */
        teleported() {
            teleportPending = true;
        },
        async setTrainingDummyAvatar(image: Blob | null) {
            if (!audioLab) throw new Error('训练人偶头像只在开发音效测试环境可用');
            if (!image) {
                labAvatarImage = null;
                avatars.setHeadImage(labTargetId, null);
                return;
            }
            const url = URL.createObjectURL(image);
            const decoded = new Image();
            try {
                decoded.src = url;
                await decoded.decode();
                labAvatarImage = decoded;
                avatars.setHeadImage(labTargetId, decoded);
            } finally {
                URL.revokeObjectURL(url);
            }
        },
        /**
         * Draws every gameplay visual once while the title screen still covers the canvas — thrown disc and its
         * physics body, in-hand disc with stripe, inspect afterimages, hit sparks and ring, another player — so their
         * shaders are compiled before play instead of on the first hit, inspect or opponent (a visible hitch).
         */
        async prewarm() {
            warming = true;
            const eye = camera.getPosition().clone();
            const ahead = camera.forward.clone().mulScalar(1.6).add(eye);
            const at: V3 = [ahead.x, ahead.y, ahead.z];
            tintGhosts(colourFor('local'));
            viewmodel.enabled = true;
            ghosts.forEach((ghost, index) => {
                ghost.entity.enabled = true;
                ghost.entity.setLocalPosition(-0.25 + index * 0.25, 0, -1.2);
            });
            effects.burst(at, colourFor('local'), 'out');
            effects.burst(at, colourFor('local'), 'head');
            effects.snipe(at);
            effects.tracer(at, colourFor('local'));
            effects.mote(at, GOLD_COLOUR, [0, 0, 0], 0.05, 0.3);
            effects.ring(at, GOLD_COLOUR, 0.2, 0.3, 1);
            goldView.showAll(at);
            ground.showAt(at[0], at[1] - 0.5, at[2]);
            teacher.root.setPosition(at[0], at[1] - 1, at[2]);
            guard.showAt(at[0] + 1, at[2]);
            ghosts[0].entity.render!.meshInstances = [new MeshInstance(goldView.mesh, goldView.material)];
            avatars.add('prewarm', '', colourFor('local'));
            // The finisher pair is pooled and drawn here once, so a real move starts without a hitch.
            const coolExecution = executionView.warm(at);
            const coolStands = stands.warm(at);
            avatars.update(new Map([['prewarm', { p: [at[0], at[1] - 0.9, at[2]], yaw: 0, pitch: 0, aim: 1 }]]), 0);
            discs.launch({
                owner: 'warm-up',
                throwId: 0,
                hue: colourFor('local'),
                origin: at,
                velocity: [0, 0, 0],
                normal: [0, 1, 0],
                local: false
            });
            // A skinned disc too: the textured skin shader compiles here, not on the first skinned throw.
            discs.launch({
                owner: 'warm-up',
                throwId: 1,
                hue: colourFor('local'),
                origin: [at[0] + 0.4, at[1], at[2]],
                velocity: [0, 0, 0],
                normal: [0, 1, 0],
                local: false,
                skin: 'classic'
            });
            for (let frame = 0; frame < 3; frame++) await nextFrame();
            viewmodel.enabled = false;
            for (const ghost of ghosts) ghost.entity.enabled = false;
            avatars.remove('prewarm');
            coolExecution();
            coolStands();
            discs.clear();
            effects.clear();
            goldView.set(null);
            ground.set([]);
            warming = false;
        },
        /** Joins the shared world (first entry only). */
        start(name: string, phase: 'lobby' | 'playing' = 'playing') {
            if (started) return;
            started = true;
            playerPhase = phase;
            nickname = name;
            sound.unlock();
            viewmodel.enabled = true;
            refreshBoard();
            net.connect(name, auth.token, phase);
            if (audioLab && phase === 'playing' && net.state !== 'online') beginLocalTestRound();
            refreshCount();
        },
        /** Client-side phase changes on the gate crossing; the room independently validates its latest pose. */
        joinRound() {
            if (playerPhase !== 'lobby') return;
            if (net.state === 'online') {
                const now = performance.now();
                if (now - lastJoinRoundRequestAt < 500) return;
                lastJoinRoundRequestAt = now;
                // Preserve WebSocket order: the room validates the exact gate-crossing pose first.
                net.pose(pose(), true);
                net.joinRound();
            } else {
                playerPhase = 'playing';
                if (audioLab && !roundState) beginLocalTestRound();
            }
        },
        update(deltaTime: number) {
            const now = performance.now();
            // Offline practice mirrors the room: the refill timer is held while the stack is full.
            if (net.state !== 'online' && localAbilities.creation && ammo >= localAmmoCapacity)
                creationNextAt = roomNow() + ITEM_RULES.creationRefillMs;
            if (net.state !== 'online' && localAbilities.creation && ammo < localAmmoCapacity && roomNow() >= creationNextAt) {
                ammo++;
                creationNextAt = roomNow() + ITEM_RULES.creationRefillMs;
                ui.ammo(ammo, localAmmoCapacity);
                ui.feed('创造之力 · 自动补充一张飞盘', 'mine');
            }
            poses = net.poses();
            for (const npc of NPC_SPAWNS) poses.set(npc.id, { p: npc.at, yaw: 180, pitch: 0 });
            const finishPracticeFinisher = () => {
                if (labExecution && realRoomNow() >= labExecution.endsAt) {
                    const record = labExecution;
                    labExecution = null;
                    executionView.stop(record.id);
                    // Release the practice lock like a completed online finisher (it used to stay set, freezing the
                    // player and hiding the execute prompt for good).
                    if (globalFinisher?.id === record.id) globalFinisher = null;
                    finisherRequestId = null;
                    finisherHoldTarget = null;
                    finisherCommitSent = false;
                    ui.executionState(null, 0);
                    ui.finisherMode(false);
                    simulateDummyHit('execution');
                }
            };
            // The practice finisher also runs as a global finisher, so its end must be checked before the early return.
            finishPracticeFinisher();
            if (globalFinisher) {
                avatars.update(poses, now, ceremonyRun || mvpRun ? everyoneHidden() : executionView.hiddenIds());
                executionView.update(realRoomNow(), selfId());
                const progress = executionProgress(globalExecution(globalFinisher), realRoomNow());
                ui.executionPrompt(null);
                ui.executionState(
                    `全场处决 · 回旋飞盘 · ${globalFinisher.attacker.name} × ${globalFinisher.target.name}`,
                    progress
                );
                return;
            }
            if (finisherHoldStartedAt !== null && !finisherCommitSent) {
                const current = executionTarget();
                if (current !== finisherHoldTarget) {
                    cancelFinisherHold();
                    ui.notify('处决条件已失效');
                } else {
                    const progress = Math.min(1, (now - finisherHoldStartedAt) / GLOBAL_FINISHER_CONFIG.holdDurationMs);
                    ui.executionHold('holding', progress);
                    if (progress >= 1) completeFinisherHold();
                }
            }
            // The charge ring fills for quick throws; once aiming starts the scope takes over.
            if (chargingSince !== null && aim < 0.02) {
                const fraction = Math.min(1, (now - chargingSince) / 1000 / THROW.chargeSeconds);
                ui.charge(fraction);
                if (fraction >= 1 && !chargeFullPlayed) {
                    chargeFullPlayed = true;
                    sound.chargeFull();
                }
            } else if (chargingSince !== null) ui.charge(null);
            if (chargingSince === null) chargeFullPlayed = false;
            updateCombatFeel(now);
            const standsOpen = standsOpenNow();
            stands.update(
                standsOpen
                    ? [
                          ...[...roster.values()].filter((entry) => entry.spectating).map((entry) => entry.id),
                          ...(labCeremony && ceremonyRun ? Array.from({ length: 14 }, (_, i) => `lab-fan-${i}`) : [])
                      ]
                    : NO_IDS,
                (id) => roster.get(id)?.colour ?? (id.startsWith('lab-fan-') ? (Number(id.slice(8)) * 53) % 360 : 0),
                standsOpen,
                now,
                !!ceremonyRun,
                net.fans(),
                fanMode ? selfId() : null
            );
            if (!alive && !spectating) ui.eliminated(killer, Math.max(0, (deadUntil - now) / 1000));
            if (net.state === 'online' && (alive || fanMode) && !executionView.hasActor(selfId())) {
                // A move the game made itself is flagged so the room resets (not rewinds across) this player's history.
                net.pose(pose(), teleportPending, teleportPending);
                teleportPending = false;
            }
            const eye = camera.getPosition();
            const f = camera.forward;
            sound.listener([eye.x, eye.y, eye.z], [f.x, f.y, f.z]);
            const localPose = pose();
            const velocity = player.rigidbody?.linearVelocity;
            restroomMirrors.update(
                localPose,
                camera.forward,
                alive && !spectating && !executionView.hasActor(selfId()),
                velocity ? Math.hypot(velocity.x, velocity.z) : 0
            );
            if (audioLab) {
                // Network state changes clear remote avatars, including on first entering offline practice.
                // Keep the local target registered independently of that remote-player lifecycle.
                if (!avatars.has(labTargetId)) {
                    avatars.add(labTargetId, '固定测试人偶', colourFor(labTargetId));
                    avatars.setScale(labTargetId, labDummyHeight / CHARACTER_SOURCE_HEIGHT);
                    if (labAvatarImage) avatars.setHeadImage(labTargetId, labAvatarImage);
                }
                if (labHp === 0 && now >= labRespawnAt) labHp = MAX_HP;
                if (labHp > 0) poses.set(labTargetId, labTargetPose);
                else poses.delete(labTargetId);
                labUi?.dummy(labHp, Math.max(0, (labRespawnAt - now) / 1000));
            }
            avatars.update(poses, now, ceremonyRun || mvpRun ? everyoneHidden() : executionView.hiddenIds());
            animateFeel(deltaTime, now);
            updateRound(now);
            effects.update(now < hitStopUntil ? 0 : deltaTime);
            targets.clear();
            for (const [id, each] of poses) targets.set(id, each.p);
            discs.update(
                deltaTime,
                targets,
                (throwId, target, contact: DiscContact, _velocity, bounces) => {
                    const { at } = contact;
                    if (audioLab && target === labTargetId) {
                        const head = isHeadHit(at[1], labTargetPose.p[1]);
                        const frcHit = localFrcThrows.delete(throwId);
                        simulateDummyHit(head ? 'head' : frcHit ? 'frc' : 'body');
                        return;
                    }
                    // Immediate local prediction is visually distinct; the room alone confirms a hit.
                    feedback.submit(
                        { id: `prediction:${selfId()}:${throwId}`, kind: 'contact-predicted' },
                        performance.now()
                    );
                    pendingHitClaims.set(throwId, now + 8_500);
                    hitsPredicted++;
                    ui.hitPrediction(throwId);
                    net.hit(
                        throwId,
                        target,
                        at.map(round) as V3,
                        bounces.map((point) => point.map(round) as V3)
                    );
                },
                (at, speed) => sound.bounce(at, speed),
                (at, hue, speed, skin) => {
                    if (!skin || !skinFx.trail(skin, at, speed)) effects.tracer(at, hue, speed);
                },
                (rest) => {
                    // The golden disc flies home but leaves an ordinary disc on the floor where it came down;
                    // an ordinary disc of ours now lies where it stopped.
                    if (rest.gold && rest.at) {
                        effects.ring(rest.at, GOLD_COLOUR, 0.1, 0.3, 0.8);
                        effects.burst(rest.at, 45, 'head');
                    }
                    if (rest.local && rest.at && net.state === 'online') {
                        const at = rest.gold ? [rest.at[0], 0.02, rest.at[2]] : rest.at;
                        net.landed(rest.throwId, at.map(round) as V3);
                    }
                },
                [camera.getPosition().x, camera.getPosition().y, camera.getPosition().z],
                (at, speed) => sound.flyby(at, speed)
            );
            for (const [throwId, expiresAt] of pendingHitClaims) {
                if (now <= expiresAt) continue;
                pendingHitClaims.delete(throwId);
                ui.rejectHitPrediction(throwId);
            }
            ground.update(now);
            executionView.update(realRoomNow(), selfId());
            const local = executionView.localRecord(selfId());
            ui.executionState(
                local
                    ? local.attacker.id === selfId()
                        ? `正在处决 ${local.target.name}`
                        : `正在被 ${local.attacker.name} 处决`
                    : null,
                local ? executionProgress(local, realRoomNow()) : 0
            );
            const target = executionTarget();
            ui.executionPrompt(target ? nameOf(target) : null);
        },
        get alive() {
            return alive;
        },
        get executing() {
            return globalFinisher !== null || executionView.hasActor(selfId());
        },
        get finisherLocked() {
            return globalFinisher !== null;
        },
        get detained() {
            return performance.now() < detainedUntil;
        },
        /** Lights out (the round's final minutes). */
        get dark() {
            // The ceremony keeps the arena dark until its last ring of lamps strikes.
            const ceremonyDark =
                !!ceremonyRun && ceremonyRun.t < ceremonyRun.plan.ring(CEREMONY.rings - 1);
            return dark || ceremonyDark;
        },
        /** Room entry remains passive; the monitoring-room eye is required to reveal live player locations. */
        enteredRoom(_id: string | null, _kind?: string | null) {
            void _id;
            void _kind;
        },
        /** The golden disc and 纪老师 for the maps. */
        markers: mapMarkers,
        get online() {
            return net.state === 'online';
        },
        get phase() {
            return playerPhase;
        },
        /** The player's normal field of view and mouse sensitivity (the sniper scope scales from these). */
        setView(fov: number, lookSensitivity: number) {
            viewFov = fov;
            viewSens = lookSensitivity;
        },
        setFeedbackSettings(settings: {
            cameraMotion: CameraMotion;
            effectsQuality: 'low' | 'medium' | 'high';
            reducedFlashes: boolean;
            masterVolume: number;
            combatVolume: number;
            confirmationVolume: number;
        }) {
            cameraImpulses.setMode(settings.cameraMotion);
            feelMotion = settings.cameraMotion;
            effects.setQuality(settings.effectsQuality);
            effects.setReducedFlashes(settings.reducedFlashes);
            sound.setVolumes({
                master: settings.masterVolume,
                combat: settings.combatVolume,
                confirmation: settings.confirmationVolume
            });
        },
        /** Call from a user gesture (a click or key) so the browser lets audio start. */
        unlockAudio: () => sound.unlock(),
        homepageMusic: (active: boolean) => sound.homepageMusic(active),
        preloadAudio: (onProgress?: (completed: number, total: number) => void) => sound.preload(onProgress),
        /** Background download of the music tracks (after the title screen is up). */
        prefetchMusic: () => sound.prefetchMusic(),
        /** Joins again with the current account (after signing in or out from the pause screen). */
        rejoin(name?: string) {
            if (name !== undefined) nickname = name;
            if (started) net.rejoin(nickname, auth.token);
        },
        chat: (text: string) => net.chat(text),
        /** Uses Enter for the currently held active skill; returns false when Enter may open chat. */
        activateActiveSkill,
        /** Hides the golden-disc beam while the opening flyover plays. */
        setIntroPlaying(playing: boolean) {
            introBeamHidden = playing;
        },
        /** Freezes movement and throwing while the chat box is open. */
        setInputPaused(paused: boolean) {
            if (globalFinisher) return;
            inputPaused = paused;
            const script = controller();
            if (script) script.enabled = alive && !paused && !executionFrozen && !spectating;
            if (paused) {
                chargingSince = null;
                ui.charge(null);
            }
        },
        debug: {
            /** Adjust only the developer audio-lab round clock so phase thresholds can be tested without waiting. */
            setRoundRemaining: (seconds: number) => {
                if (!audioLab || roundState?.phase !== 'playing' || !Number.isFinite(seconds)) return;
                roundState = { phase: 'playing', endsAt: roomNow() + Math.max(0, seconds) * 1000 };
                roundEndSecond = -1;
            },
            /** Plays the final entrance ceremony now (offline test): you plus `others` stand-in players. */
            playCeremony: (others = 4) => playLabCeremony(others),
            ceremony: () => (ceremonyRun ? { t: ceremonyRun.t, entrants: ceremonyRun.plan.entrants.length } : null),
            cutscene: () => (cutsceneRun ? { kind: cutsceneRun.kind, skipped: cutsceneRun.skipped, camera: cutsceneView.active } : null),
            shuttersClosed: () => ceremony.shuttersClosed(),
            shutterProbes: () => ceremony.shutterProbes(),
            ceremonyMetrics: () => ({ ...ceremony.metrics(), seatedSpectators: stands.seated }),
            setSimulatedRtt: (milliseconds: number) => net.setSimulatedRtt(milliseconds),
            markers: mapMarkers,
            monitorFocused: () => false,
            cameraPosition: () => camera.getPosition().toArray(),
            state: () => ({
                net: net.state,
                phase: playerPhase,
                simulatedRtt: net.simulatedRtt,
                id: net.id,
                alive,
                spectating,
                executions: executionView.debug(realRoomNow(), selfId()),
                globalFinisher: globalFinisher ? { ...globalFinisher } : null,
                viewmodelSkin,
                hp,
                items: worldItems.map((item) => ({ ...item })),
                abilities: {
                    ...localAbilities,
                    frcSelected: localFrcSelected,
                    frcCooldownUntil: localFrcCooldownUntil,
                    stealthUntil: localStealthUntil,
                    stealthCooldownUntil: localStealthCooldownUntil,
                    ammoCapacity: localAmmoCapacity
                },
                players: [...roster.values()].map((entry) => ({ ...entry })),
                discs: discs.count,
                throws,
                hitsClaimed,
                hitsPredicted,
                finalShown,
                finalRelocationResult,
                activeAudioVoices: sound.voiceCount(),
                cameraMotionScale: cameraImpulses.scale,
                effectIntensity: effects.intensity(),
                trailDensity: discs.trailDensity,
                trailLength: effects.trailLength(),
                tracerSamples: effects.tracerSamples(),
                practiceDummy: audioLab ? { hp: labHp, position: [...labTargetPose.p], respawnAt: labRespawnAt } : null,
                practiceExecution: labExecution ? { id: labExecution.id, endsAt: labExecution.endsAt } : null,
                restroomMirrorRoom: restroomMirrors.activeRoom(),
                restroomMirror: restroomMirrors.state(),
                inspecting: inspectSince !== null,
                aim,
                gold: goldView.state,
                round: roundState,
                roomNow: roomNow(),
                blackoutAt: blackoutAt(),
                detained: performance.now() < detainedUntil,
                power: {
                    ...currentPower(),
                    phase: powerPhase(roomNow(), currentPower()),
                    dark,
                    guard: { ...guard.pose }
                }
            }),
            avatarAction: (id: string) => avatars.actionState(id),
            avatarJointRotation: (id: string, name: string) => avatars.jointRotation(id, name),
            avatarHeadTextured: (id: string) => avatars.hasHeadImage(id),
            /** 纪老师 right now (position and facing). */
            teacher: () => teacher.pose,
            /** Browser tests isolate traversal from patrol timing while teacher behavior is tested separately. */
            setTeacherGrace: (milliseconds: number) => {
                teacherGraceUntil = performance.now() + Math.max(0, milliseconds);
            },
            inspect: startInspect,
            holdInspect: (u: number | null) => (inspectHold = u),
            holdAim: (value: number | null) => (aimHold = value),
            chat: (text: string) => net.chat(text),
            throwAt: (x: number, y: number, z: number, speed: number = THROW.maxSpeed, sniper = false) => {
                const eye = camera.getPosition();
                const dx = x - eye.x;
                const dy = y - eye.y;
                const dz = z - eye.z;
                const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
                const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
                setLook(player, pitch, yaw);
                camera.setEulerAngles(pitch, yaw, 0);
                return sniper ? throwDisc(SNIPER.speed, true) : throwDisc(speed);
            }
        }
    };
};

/** Duration of the player-activated monitoring console feed. */

const round = (value: number) => Math.round(value * 1000) / 1000;
/** The crosshair turns red over a visible enemy within this distance (m), about a full-strength throw. */
const AIM_TARGET_RANGE = 30;

export type MatchDebug = ReturnType<typeof createMatch>['debug'];
