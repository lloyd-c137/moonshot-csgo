// The shared-world frisbee game: throwing input, the network session, other players, eliminations and respawns.
// Works offline as frisbee practice when no server is configured or reachable.
import type { AppBase, RigidBodyComponentSystem } from 'playcanvas';
import { BLEND_NORMAL, Color, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import type { CharacterAssetLoader } from '../characters/CharacterAssetLoader';
import { CHARACTER_SOURCE_HEIGHT } from '../characters/CharacterAssetLoader';
import { PLAYER, SAFE_SPAWN } from '../config/gameplay';
import { SPAWN_POINTS } from '../config/spawns';
import { MONITOR_CONSOLE, SPECIAL_LOCATIONS } from '../config/specialLocations';
import type { Auth } from '../net/auth';
import { createNetClient } from '../net/client';
import type { NetState } from '../net/client';
import type { King, PlayerPose, PlayerSummary, RoundState, ThrowRecord } from '../net/protocol';
import {
    colourFor,
    AMMO,
    DETENTION_SECONDS,
    HEAD_ABOVE,
    MAX_HP,
    RESPAWN_SECONDS,
    ROUND,
    SNIPER,
    SPAWN_PROTECTION,
    THROW_COOLDOWN
} from '../net/protocol';
import { setLook } from '../player/playerController';
import { box, place } from '../render/shapes';
import type { AudioLabUi } from '../ui/audioLab';
import type { Ui } from '../ui/shell';

import { createAvatars } from './avatars';
import { createBreakerView } from './breakerView';
import { createDiscs } from './discs';
import { createEffects } from './effects';
import { canExecute, executionProgress } from './execution';
import type { Execution } from './execution';
import { createExecutionView } from './executionView';
import { CameraImpulseController } from './feedback/CameraImpulseController';
import type { CameraMotion } from './feedback/CameraImpulseController';
import { CombatFeedbackDirector } from './feedback/CombatFeedbackDirector';
import type { DiscContact, V3 } from './frisbee';
import { chargeSpeed, DISC, launchNormal, THROW } from './frisbee';
import { createGold, GOLD_COLOUR } from './gold';
import { createGroundDiscs } from './groundDiscs';
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
import { createMonitorView } from './monitorView';
import { nearBreaker, powerOut, powerPhase } from './power';
import type { PowerState } from './power';
import { aimProgress, aimReady, fovFactor, SCOPE, sensitivityFactor } from './scope';
import { createSound } from './sound';
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
    /** Middle of the 莲花球场 (X/Z): the final showdown is fought there. */
    arenaCenter: [number, number];
    characters: CharacterAssetLoader;
};

export const createMatch = ({ app, player, camera, canvas, ui, url, auth, arenaCenter, characters }: Options) => {
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const discs = createDiscs(app, PLAYER.gravity);
    const avatars = createAvatars(app, camera, ui.nameTagLayer(), characters);
    const roster = new Map<string, PlayerSummary>();
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
    let started = false;
    let throws = 0;
    let hitsClaimed = 0;
    let hitsPredicted = 0;
    const pendingHitClaims = new Map<number, number>();
    let killer = '';
    let hp = MAX_HP;
    const sound = createSound();
    const effects = createEffects(app);
    const feedback = new CombatFeedbackDirector();
    const cameraImpulses = new CameraImpulseController();
    let executionFrozen = false;
    const executionView = createExecutionView(app, camera, characters, (active) => {
        executionFrozen = active;
        const script = controller();
        if (script) script.enabled = alive && !inputPaused && !spectating && !active;
        player.rigidbody!.linearVelocity = Vec3.ZERO;
        player.rigidbody!.angularVelocity = Vec3.ZERO;
        player.rigidbody!.enabled = !spectating && !active;
        if (active) {
            cancelCharge();
            inspectSince = null;
        }
    });
    // GAMEPLAY_AUTHORED fixed local dummy four metres north of the south-entrance spawn.
    const audioLab = import.meta.env.DEV && new URLSearchParams(window.location.search).get('audioLab') === '1';
    const labTargetId = 'audio-lab-target';
    const labTargetPose: PlayerPose = { p: [SAFE_SPAWN.x, SAFE_SPAWN.y, SAFE_SPAWN.z - 4], yaw: 0, pitch: 0 };
    let labHp: number = MAX_HP;
    let labDummyHeight = 2.1;
    let labRespawnAt = 0;
    let labExecution: Execution | null = null;
    let labGolden = false;
    let labUi: AudioLabUi | undefined;
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
    const goldView = createGold(app, discs.mesh, effects);
    discs.goldMaterial = goldView.material;
    avatars.goldMaterial = goldView.material;
    const teacher = createTeacher(app, camera, ui.nameTagLayer(), characters);
    let roundState: RoundState | null = null;
    // Disc ammunition (online): discs in hand; thrown ones lie where they land until someone picks them up.
    const ground = createGroundDiscs(app, discs.mesh);
    let ammo: number = AMMO.start;
    /** The monitoring room's radar: every player's position on the maps until this time (performance.now ms). */
    let radarUntil = 0;
    let radarShown = false;
    let inWatch = false;
    const hasDisc = () => net.state !== 'online' || holdingGold() || ammo > 0;
    /** performance.now() when the local player may move again after being caught by 纪老师. */
    let detainedUntil = 0;
    let detentionShown = false;
    let speeds: { ground: number; air: number; jump: number } | null = null;
    let warming = false;
    /** Whether the current inspect is the golden disc's (it has its own, longer routine). */
    let goldInspect = false;
    let goldSparkAt = 0;
    let lastGoldMine = false;
    const guard = createGuard(app, camera, ui.nameTagLayer(), characters);
    const breakerView = createBreakerView(app);
    const monitorView = createMonitorView(app);
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
    let finalShown = false;
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
        roundState?.phase === 'playing' ? roundState.endsAt - ROUND.blackoutSecondsLeft * 1000 : null;
    const goldHolder = () => goldView.state?.holder ?? null;
    const holdingGold = () => goldHolder() === selfId();
    /** Room clock now: the server's while online, the local clock offline. */
    const roomNow = () => (net.state === 'online' ? (net.serverNow() ?? Date.now()) : Date.now());
    let nickname = '';
    let inputPaused = false;
    let poses = new Map<string, PlayerPose>();
    /** Recent eliminations per killer, for streak announcements. */
    const streaks = new Map<string, { count: number; at: number }>();
    // Feel: FOV punch on release, damped local camera impulses, in-hand disc that winds up and snaps forward.
    let punch = 0;
    const eyeOffset = camera.getLocalPosition().clone();
    const viewmodel = new Entity('viewmodel-disc');
    viewmodel.addComponent('render', { meshInstances: discs.meshInstances(colourFor('local')), castShadows: false });
    viewmodel.enabled = false;
    viewmodel.setLocalScale(0.85, 0.85, 0.85);
    camera.addChild(viewmodel);
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
            ghost.entity.render!.meshInstances = [new MeshInstance(discs.mesh, ghost.material)];
        }
    };
    const viewmodelWorld = (): V3 => {
        const p = viewmodel.getPosition();
        return [p.x, p.y, p.z];
    };
    /** Whether the catch kick of the current inspect has fired. */
    let caught = false;

    const selfId = () => net.id ?? 'local';
    const nameOf = (id: string) =>
        id === 'guard' ? '保安' : id === labTargetId ? '固定测试人偶' : (roster.get(id)?.name ?? '某人');
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
            viewmodel.render!.meshInstances = discs.meshInstances(myHue);
            tintGhosts(myHue);
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
        if (spectating && event.button === 0) watchIndex++;
    });

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
                executionView.clear();
                power = { pulledAt: null };
                roster.clear();
                avatars.clear();
                // Back to offline practice: no round, and a local golden disc will be laid out again.
                roundState = null;
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
            executionView.clear();
            for (const record of extra.executions) executionView.start(record);
            power = extra.power;
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
            }
            roundState = extra.round;
            ammo = extra.ammo;
            ui.ammo(ammo, AMMO.max);
            ground.set(extra.discs);
            goldView.set(extra.gold);
            avatars.setGold(extra.gold.holder);
            for (const each of players) {
                roster.set(each.id, each);
                if (each.id !== me.id) avatars.add(each.id, each.name, each.colour);
            }
            refreshCount();
            hp = me.hp;
            refreshBoard();
            ui.notify(`已加入共享校园，你是「${me.name}」，当前 ${players.length} 人`);
        },
        joined: (summary) => {
            roster.set(summary.id, summary);
            avatars.add(summary.id, summary.name, summary.colour);
            refreshCount();
            ui.notify(`${summary.name} 进入了校园`);
            sound.join();
        },
        left: (id) => {
            const name = nameOf(id);
            roster.delete(id);
            avatars.remove(id);
            refreshCount();
            ui.notify(`${name} 离开了校园`);
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
                gold: from === goldHolder()
            });
            if (from === goldHolder()) goldThrowFlourish(record.o);
        },
        struck: (throwId, target, by, targetHp, out, head, at, scores, sniper, golden, final, execution) => {
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
            if (goldKill) goldView.flourish(at);
            effects.burst(at, roster.get(by)?.colour ?? 0, out ? 'out' : head ? 'head' : 'hit');
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
                    if (presentation.showHud) ui.popup(`金飞盘淘汰 · ${nameOf(target)}  +1`, 'gold');
                    punch = Math.max(punch, 1.8);
                    cameraImpulses.trigger(0.55);
                } else if (snipe) {
                    sound.snipeConfirm();
                    ui.hitMarker('snipe');
                    if (presentation.showHud) ui.popup(`狙击爆头 · ${nameOf(target)}  +1`, 'snipe');
                    punch = Math.max(punch, 1.8);
                    cameraImpulses.trigger(0.5);
                } else {
                    sound.hitConfirm(out, head);
                    ui.hitMarker(out ? 'kill' : head ? 'head' : 'hit');
                    if (presentation.showHud)
                        ui.popup(
                            out
                                ? `${execution ? '处决淘汰' : head ? '爆头淘汰' : '淘汰'} ${nameOf(target)}  +1`
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
                if (goldKill) {
                    if (presentation.showHud)
                        ui.goldKill(nameOf(by), nameOf(target), target === me ? 'me' : by === me ? 'mine' : 'neutral');
                    if (by !== me) sound.goldChime();
                } else {
                    if (presentation.showHud)
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
                if (result.accepted) sound.roundEnd(mine);
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
        executionStarted: (record) => executionView.start(record),
        executionEnded: (id, completed, reason) => {
            const local = executionView.localRecord(selfId())?.id === id;
            executionView.stop(id);
            if (local && !completed) ui.notify(`处决中断：${reason}`);
        },
        executionDenied: (reason) => ui.notify(reason),
        ammo: (next) => {
            if (next > ammo) {
                sound.pickup();
                ui.feed(`捡起飞盘 · ${next}/${AMMO.max}`, 'mine');
            }
            ammo = next;
            ui.ammo(ammo, AMMO.max);
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
        if (executionView.hasActor(selfId())) return false;
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
        if (!hasDisc()) {
            ui.notify('没有飞盘了：去捡回扔出去的飞盘，或到体育组办公室领取');
            return false;
        }
        const golden = holdingGold();
        if (net.state === 'online' && !golden) {
            ammo = Math.max(0, ammo - 1);
            ui.ammo(ammo, AMMO.max);
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
            ...(sniper ? { sniper: true } : {})
        };
        discs.launch({
            owner: selfId(),
            throwId: record.id,
            hue: roster.get(selfId())?.colour ?? colourFor('local'),
            origin: record.o,
            velocity: record.v,
            normal: launchNormal(record.v, record.tilt),
            local: true,
            sniper,
            gold: holdingGold()
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
    const lookingAtMonitor = () => {
        const eye = camera.getPosition();
        const dx = MONITOR_CONSOLE.x - eye.x;
        const dy = MONITOR_CONSOLE.y - eye.y;
        const dz = MONITOR_CONSOLE.z - eye.z;
        const distance = Math.hypot(dx, dy, dz);
        if (distance > 3 || distance < 0.1) return false;
        const forward = camera.forward;
        return (dx * forward.x + dy * forward.y + dz * forward.z) / distance > 0.94;
    };
    const activateMonitor = () => {
        if (!started || !alive || spectating || inputPaused || performance.now() < detainedUntil || !lookingAtMonitor())
            return false;
        radarUntil = performance.now() + RADAR_SECONDS * 1000;
        sound.scopeReady();
        ui.popup('监控画面已开启', 'gold');
        ui.feed(`监控画面 · ${RADAR_SECONDS} 秒内地图显示其他玩家位置`, 'mine');
        return true;
    };
    window.addEventListener('mousedown', (event) => {
        // Right button while charging or aiming: stand down without throwing.
        if (event.button === 2 && chargingSince !== null) return cancelCharge();
        if (event.button !== 0 || !locked() || !alive || !started || inputPaused) return;
        if (activateMonitor()) return;
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
        if (executionView.hasActor(selfId())) return false;
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
            tintGhosts(viewmodelHue < 0 ? colourFor('local') : viewmodelHue);
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
            executionView.hasActor(selfId()) ||
            performance.now() < detainedUntil
        )
            return null;
        const mine = pose();
        if (audioLab && labHp > 0 && !executionView.hasActor(labTargetId) && canExecute(mine, labTargetPose)) {
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
                        canExecute(mine, other) &&
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
    const attemptExecution = () => {
        if (performance.now() - lastExecutionRequest < 500) return;
        const target = executionTarget();
        if (!target) return;
        lastExecutionRequest = performance.now();
        cancelCharge();
        if (audioLab && target === labTargetId) {
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
                startsAt: now + 150,
                endsAt: now + 150 + 2600
            };
            labExecution = record;
            executionView.start(record);
            return;
        }
        net.pose(pose(), true);
        net.execute(target);
    };
    ui.onExecute(() => {
        attemptExecution();
        if (!locked()) void canvas.requestPointerLock().catch(() => undefined);
    });
    window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyV' && !event.repeat && locked()) {
            event.preventDefault();
            attemptExecution();
        }
        if (
            event.code === 'KeyE' &&
            !event.repeat &&
            locked() &&
            alive &&
            !spectating &&
            !inputPaused &&
            performance.now() >= detainedUntil &&
            nearBreaker(pose().p) &&
            power.pulledAt === null &&
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
    });

    const animateFeel = (deltaTime: number, now: number) => {
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
        cam.fov = viewFov * fovFactor(aim) + punch * 2.5 * cameraImpulses.scale;
        const script = controller() as unknown as { lookSens?: number; speedGround?: number } | null;
        if (script) {
            script.lookSens = viewSens * sensitivityFactor(viewFov, aim);
            if (walkSpeed === null) walkSpeed = script.speedGround ?? 40;
            // Aiming slows you down; so does carrying the golden disc.
            script.speedGround =
                walkSpeed * (1 - (1 - SCOPE.moveScale) * aim) * (holdingGold() ? ROUND.goldSpeedFactor : 1);
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
    /** Per frame: 纪老师, the golden disc, detention, the round clock and the on-screen gold marker. */
    const updateRound = (now: number) => {
        if (warming) return;
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
        // Equip: the in-hand disc becomes the golden one (and back when it is lost).
        if (mine !== lastGoldMine) {
            lastGoldMine = mine;
            viewmodel.render!.meshInstances = mine
                ? [new MeshInstance(discs.mesh, goldView.material)]
                : discs.meshInstances(viewmodelHue < 0 ? colourFor('local') : viewmodelHue);
        }
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
            started && alive && !spectating && !executionView.hasActor(selfId()) && teacher.sees(player.getPosition());
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
        const outage = powerOut(time, power);
        const nightActive = net.state === 'online' && lightsOut !== null && time >= lightsOut;
        guard.update(time, lightsOut, power);
        breakerView.update(outage);
        monitorView.setActive(performance.now() < radarUntil);
        if (outage !== wasPowerOut) {
            wasPowerOut = outage;
            if (outage) {
                sound.blackout();
                ui.broadcastText('总闸被拉下！全校断电 · 保安前往配电室');
            } else if (power.pulledAt !== null) {
                ui.broadcastText(nightActive ? '保安已合闸 · 终局夜晚继续' : '保安已恢复供电，正在返回原位');
                sound.pickup();
            }
        }
        ui.interaction(
            started && alive && !spectating && lookingAtMonitor()
                ? '点击电脑查看其他玩家位置（30 秒）'
                : started && alive && !spectating && nearBreaker(pose().p)
                  ? power.pulledAt === null
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
        if (nightActive && alive && !spectating && !spottedSent && guard.catches(player.getPosition(), player)) {
            spottedSent = true;
            ui.popup('被保安的手电筒照到了！', 'me');
            net.spotted();
        }
        // Watching: the camera follows someone still in the game.
        if (spectating) spectate(now);
        // In the dark the golden disc (and whoever carries it) is lit up for everyone to find.
        const goldAt = goldPosition();
        goldLight.light!.intensity = dark && goldAt ? 2.6 : 0;
        if (goldAt) goldLight.setPosition(goldAt[0], goldAt[1] + 1.6, goldAt[2]);
        // The final minute: floodlights over the 莲花球场, and everyone still in the game is brought there.
        const finalAt = roundState?.phase === 'playing' ? roundState.endsAt - ROUND.finalSecondsLeft * 1000 : null;
        const finalNow = net.state === 'online' && finalAt !== null && roomNow() >= finalAt;
        if (finalNow !== finalShown) {
            finalShown = finalNow;
            for (const light of floodlights) light.light!.intensity = finalNow ? 2.4 : 0;
            if (finalNow) {
                ui.broadcastText('最终对决！所有存活玩家传送到莲花球场');
                sound.roundStart();
            }
        }
        if (!finalNow) finalDone = false;
        if (finalNow && !finalDone && alive && !spectating && started) {
            finalDone = true;
            // Spread out round the middle of the court (a fixed spot per player, so nobody lands on anyone).
            const id = selfId();
            let hash = 0;
            for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
            const a = ((hash % 360) * Math.PI) / 180;
            const r = 5 + (hash % 5);
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
            net.pose(pose(), true);
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
        // Monitoring room radar countdown.
        if (now < radarUntil) {
            radarShown = true;
            ui.radar((radarUntil - now) / 1000);
        } else if (radarShown) {
            radarShown = false;
            ui.radar(null);
            ui.feed('监控画面已关闭', 'neutral');
        }
        const holderPosition = holder && !mine ? (positionOf(holder) ?? null) : null;
        goldView.update(now, holderPosition, mine);

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
        if (net.state === 'online' && current) {
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
                    ui.roundEnd({ winner: current.winner, mine: current.winnerId === me, nextIn: left });
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

    /** Everyone else's position, while the monitoring room's radar is on. */
    const radarPlayers = () => {
        if (performance.now() >= radarUntil) return [];
        return [...poses]
            .filter(([id]) => id !== selfId())
            .map(([id, each]) => ({ x: each.p[0], z: each.p[2], colour: roster.get(id)?.colour ?? 0 }));
    };
    const mapMarkers = () => {
        const at = goldPosition();
        const teacherPose = teacher.pose;
        return {
            gold: at ? { x: at[0], z: at[2], held: goldHolder() !== null } : null,
            teacher: { x: teacherPose.x, z: teacherPose.z, yaw: teacherPose.yaw, range: TEACHER.range },
            players: radarPlayers(),
            specialLocations: SPECIAL_LOCATIONS
        };
    };
    const targets = new Map<string, V3>();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
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
            ghosts[0].entity.render!.meshInstances = [new MeshInstance(discs.mesh, goldView.material)];
            avatars.add('prewarm', '', colourFor('local'));
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
            for (let frame = 0; frame < 3; frame++) await nextFrame();
            viewmodel.enabled = false;
            for (const ghost of ghosts) ghost.entity.enabled = false;
            avatars.remove('prewarm');
            discs.clear();
            effects.clear();
            goldView.set(null);
            ground.set([]);
            warming = false;
        },
        /** Joins the shared world (first entry only). */
        start(name: string) {
            if (started) return;
            started = true;
            nickname = name;
            sound.unlock();
            viewmodel.enabled = true;
            refreshBoard();
            net.connect(name, auth.token);
            refreshCount();
        },
        update(deltaTime: number) {
            const now = performance.now();
            // The charge ring fills for quick throws; once aiming starts the scope takes over.
            if (chargingSince !== null && aim < 0.02) {
                ui.charge(Math.min(1, (now - chargingSince) / 1000 / THROW.chargeSeconds));
            } else if (chargingSince !== null) ui.charge(null);
            if (!alive && !spectating) ui.eliminated(killer, Math.max(0, (deadUntil - now) / 1000));
            if (net.state === 'online' && alive && !executionView.hasActor(selfId())) net.pose(pose());
            const eye = camera.getPosition();
            const f = camera.forward;
            sound.listener([eye.x, eye.y, eye.z], [f.x, f.y, f.z]);
            poses = net.poses();
            if (audioLab) {
                // Network state changes clear remote avatars, including on first entering offline practice.
                // Keep the local target registered independently of that remote-player lifecycle.
                if (!avatars.has(labTargetId)) {
                    avatars.add(labTargetId, '固定测试人偶', colourFor(labTargetId));
                    avatars.setScale(labTargetId, labDummyHeight / CHARACTER_SOURCE_HEIGHT);
                }
                if (labHp === 0 && now >= labRespawnAt) labHp = MAX_HP;
                if (labHp > 0) poses.set(labTargetId, labTargetPose);
                else poses.delete(labTargetId);
                labUi?.dummy(labHp, Math.max(0, (labRespawnAt - now) / 1000));
            }
            avatars.update(poses, now, executionView.hiddenIds());
            animateFeel(deltaTime, now);
            updateRound(now);
            effects.update(deltaTime);
            targets.clear();
            for (const [id, each] of poses) targets.set(id, each.p);
            discs.update(
                deltaTime,
                targets,
                (throwId, target, contact: DiscContact) => {
                    const { at } = contact;
                    if (audioLab && target === labTargetId) {
                        if (labHp === 0) return;
                        const head = at[1] - labTargetPose.p[1] > HEAD_ABOVE;
                        labHp = head ? 0 : Math.max(0, labHp - 1);
                        const out = labHp === 0;
                        if (out) {
                            labRespawnAt = now + RESPAWN_SECONDS * 1000;
                            targets.delete(labTargetId);
                        }
                        if (out && labGolden) sound.snipeConfirm(head, true);
                        else sound.hitConfirm(out, head);
                        effects.burst(at, colourFor(labTargetId), out ? 'out' : 'hit');
                        avatars.flash(target, performance.now());
                        avatars.react(target, head, out, poses.get(target), performance.now());
                        ui.hitMarker(out ? 'kill' : 'hit');
                        ui.popup(
                            out && labGolden
                                ? '人偶 · 金飞盘击杀'
                                : head
                                  ? '人偶 · 爆头淘汰'
                                  : out
                                    ? '人偶 · 击杀'
                                    : '人偶 · 身体命中（1/2）',
                            out ? 'kill' : 'hit'
                        );
                        labUi?.hit(head, out, labGolden);
                        hitsClaimed++;
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
                    net.hit(throwId, target, at.map(round) as V3);
                },
                (at, speed) => sound.bounce(at, speed),
                (at, hue, speed) => effects.tracer(at, hue, speed),
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
            executionView.update(roomNow(), selfId());
            if (labExecution && roomNow() >= labExecution.endsAt) {
                const record = labExecution;
                labExecution = null;
                executionView.stop(record.id);
                labHp = 0;
                labRespawnAt = now + RESPAWN_SECONDS * 1000;
                const impact = [record.target.pose.p[0], record.target.pose.p[1] + 0.25, record.target.pose.p[2]] as V3;
                if (labGolden) sound.snipeConfirm(true, true);
                else sound.hitConfirm(true, false);
                effects.burst(impact, colourFor(labTargetId), 'out');
                ui.hitMarker('kill');
                ui.popup(labGolden ? '人偶 · 金飞盘处决' : '人偶 · 处决淘汰', 'kill');
                labUi?.hit(false, true, labGolden);
            }
            const local = executionView.localRecord(selfId());
            ui.executionState(
                local
                    ? local.attacker.id === selfId()
                        ? `正在处决 ${local.target.name}`
                        : `正在被 ${local.attacker.name} 处决`
                    : null,
                local ? executionProgress(local, roomNow()) : 0
            );
            const target = executionTarget();
            ui.executionPrompt(target ? nameOf(target) : null);
        },
        get alive() {
            return alive;
        },
        get executing() {
            return executionView.hasActor(selfId());
        },
        get detained() {
            return performance.now() < detainedUntil;
        },
        /** Lights out (the round's final minutes). */
        get dark() {
            return dark;
        },
        /** Entering the room does not reveal player positions; those require clicking the console. */
        enteredRoom(_id: string | null) {
            // Entering the room does not grant access to the camera feed.
        },
        /** The golden disc and 纪老师 for the maps. */
        markers: mapMarkers,
        get online() {
            return net.state === 'online';
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
        /** Joins again with the current account (after signing in or out from the pause screen). */
        rejoin(name?: string) {
            if (name !== undefined) nickname = name;
            if (started) net.rejoin(nickname, auth.token);
        },
        chat: (text: string) => net.chat(text),
        /** Freezes movement and throwing while the chat box is open. */
        setInputPaused(paused: boolean) {
            inputPaused = paused;
            const script = controller();
            if (script) script.enabled = alive && !paused && !executionFrozen && !spectating;
            if (paused) {
                chargingSince = null;
                ui.charge(null);
            }
        },
        debug: {
            markers: mapMarkers,
            monitorFocused: lookingAtMonitor,
            cameraPosition: () => camera.getPosition().toArray(),
            state: () => ({
                net: net.state,
                id: net.id,
                alive,
                spectating,
                executions: executionView.debug(roomNow(), selfId()),
                hp,
                players: [...roster.values()].map((entry) => ({ ...entry })),
                discs: discs.count,
                throws,
                hitsClaimed,
                hitsPredicted,
                activeAudioVoices: sound.voiceCount(),
                cameraMotionScale: cameraImpulses.scale,
                practiceDummy: audioLab ? { hp: labHp, position: [...labTargetPose.p], respawnAt: labRespawnAt } : null,
                practiceExecution: labExecution ? { id: labExecution.id, endsAt: labExecution.endsAt } : null,
                inspecting: inspectSince !== null,
                aim,
                gold: goldView.state,
                round: roundState,
                detained: performance.now() < detainedUntil,
                power: { ...power, phase: powerPhase(roomNow(), power), dark, guard: { ...guard.pose } }
            }),
            avatarAction: (id: string) => avatars.actionState(id),
            avatarJointRotation: (id: string, name: string) => avatars.jointRotation(id, name),
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
const RADAR_SECONDS = 30;

const round = (value: number) => Math.round(value * 1000) / 1000;

export type MatchDebug = ReturnType<typeof createMatch>['debug'];
