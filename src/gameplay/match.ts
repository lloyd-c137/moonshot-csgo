// The shared-world frisbee game: throwing input, the network session, other players, eliminations and respawns.
// Works offline as frisbee practice when no server is configured or reachable.
import type { AppBase, RigidBodyComponentSystem } from 'playcanvas';
import { BLEND_NORMAL, Color, Entity, Mesh, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import { PLAYER } from '../config/gameplay';
import { SPAWN_POINTS } from '../config/spawns';
import type { Auth } from '../net/auth';
import { createNetClient } from '../net/client';
import type { NetState } from '../net/client';
import type { King, PlayerPose, PlayerSummary, ThrowRecord } from '../net/protocol';
import { colourFor, MAX_HP, RESPAWN_SECONDS, SNIPER, SPAWN_PROTECTION, THROW_COOLDOWN } from '../net/protocol';
import { kickLook, setLook } from '../player/playerController';
import { box, place } from '../render/shapes';
import type { Ui } from '../ui/shell';

import { createAvatars } from './avatars';
import { createDiscs } from './discs';
import { createEffects } from './effects';
import type { V3 } from './frisbee';
import { chargeSpeed, DISC, launchNormal, THROW } from './frisbee';
import { airborne, CATCH_AT, INSPECT_SECONDS, inspectPose, TOSS_AT } from './inspect';
import { aimProgress, aimReady, fovFactor, SCOPE, sensitivityFactor } from './scope';
import { createSound } from './sound';

type Options = {
    app: AppBase;
    player: Entity;
    camera: Entity;
    canvas: HTMLCanvasElement;
    ui: Ui;
    url: string | null;
    auth: Auth;
};

export const createMatch = ({ app, player, camera, canvas, ui, url, auth }: Options) => {
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const discs = createDiscs(app, PLAYER.gravity);
    const avatars = createAvatars(app, camera, ui.nameTagLayer());
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
    let killer = '';
    let hp = MAX_HP;
    const sound = createSound();
    const effects = createEffects(app);
    let king: King | null = null;
    let nickname = '';
    let inputPaused = false;
    let poses = new Map<string, PlayerPose>();
    /** Recent eliminations per killer, for streak announcements. */
    const streaks = new Map<string, { count: number; at: number }>();
    // Feel: FOV punch on release, camera shake when hit, in-hand disc that winds up and snaps forward.
    let punch = 0;
    let shake = 0;
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
    /** Whether the catch kick of the current inspect has fired. */
    let caught = false;

    const selfId = () => net.id ?? 'local';
    const nameOf = (id: string) => roster.get(id)?.name ?? '某人';
    const refreshBoard = () => {
        ui.net(netState, roster.size);
        const me = selfId();
        ui.leaderboard(
            roster.size
                ? [...roster.values()].map((entry) => ({
                      name: entry.name,
                      score: entry.score,
                      hp: entry.hp,
                      alive: entry.alive,
                      colour: entry.colour,
                      me: entry.id === me,
                      king: !!king && entry.account && entry.name === king.name
                  }))
                : [{ name: '你（离线练习）', score: 0, hp, alive, colour: colourFor('local'), me: true, king: false }]
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
        if (script) script.enabled = value && !inputPaused;
        if (value) hp = MAX_HP;
        if (!value) {
            player.rigidbody!.linearVelocity = Vec3.ZERO;
            chargingSince = null;
            ui.charge(null);
        }
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
                roster.clear();
                avatars.clear();
                if (!alive) {
                    setAlive(true);
                    ui.eliminated(null);
                }
            }
            refreshCount();
        },
        welcome: (me, players, extra) => {
            roster.clear();
            king = extra.king;
            ui.king(king);
            ui.chatHistory(extra.chat);
            if (extra.account) {
                auth.account = extra.account;
                ui.account(extra.account);
            }
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
                sniper: record.sniper === true
            });
        },
        struck: (target, by, targetHp, out, head, at, scores, sniper) => {
            const snipe = sniper && head && out;
            effects.burst(at, roster.get(by)?.colour ?? 0, out ? 'out' : head ? 'head' : 'hit');
            if (snipe) effects.snipe(at);
            for (const [id, [score, kills, deaths]] of Object.entries(scores)) {
                const entry = roster.get(id);
                if (entry) Object.assign(entry, { score, kills, deaths });
            }
            const entry = roster.get(target);
            if (entry) Object.assign(entry, { hp: targetHp, alive: !out });
            const me = selfId();
            if (target === me) {
                hp = targetHp;
                sound.hurt(out);
                const from = positionOf(by);
                ui.damage(bearingTo(from));
                shake = snipe ? 0.16 : out ? 0.12 : 0.07;
                if (snipe) {
                    // Taken out by a sniper headshot: the view is thrown back hard.
                    kickLook(player, 16, (Math.random() - 0.5) * 10);
                    ui.popup('被狙击爆头', 'me');
                }
                if (head && !out) {
                    // A head hit knocks the view upward.
                    kickLook(player, 9, (Math.random() - 0.5) * 4);
                    ui.popup('被爆头', 'me');
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
                if (out) {
                    setAlive(false);
                    killer = nameOf(by);
                    deadUntil = performance.now() + RESPAWN_SECONDS * 1000;
                } else {
                    ui.feed(`被 ${nameOf(by)} 命中 · 剩余生命 ${targetHp}`, 'me');
                }
            } else if (by === me) {
                if (snipe) {
                    sound.snipeConfirm();
                    ui.hitMarker('snipe');
                    ui.popup(`狙击爆头 · ${nameOf(target)}  +3`, 'snipe');
                } else {
                    sound.hitConfirm(out, head);
                    ui.hitMarker(out ? 'kill' : head ? 'head' : 'hit');
                    ui.popup(
                        out ? `淘汰 ${nameOf(target)}  +3` : head ? '爆头  +1' : '命中  +1',
                        out ? 'kill' : head ? 'head' : 'hit'
                    );
                }
            } else {
                sound.impact(positionOf(target) ?? at);
                if (!out) ui.feed(`${nameOf(by)} 命中 ${nameOf(target)}`);
            }
            if (out) {
                const now = performance.now();
                const previous = streaks.get(by);
                const streak = previous && now - previous.at < 12_000 ? previous.count + 1 : 1;
                streaks.set(by, { count: streak, at: now });
                streaks.delete(target);
                ui.broadcast(
                    nameOf(by),
                    nameOf(target),
                    target === me ? 'me' : by === me ? 'mine' : 'neutral',
                    streak,
                    snipe
                );
                if (target !== me && by !== me) sound.announce();
            }
            refreshBoard();
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
        respawn: (id, spawn) => {
            const entry = roster.get(id);
            if (entry) Object.assign(entry, { alive: true, hp: MAX_HP });
            if (id !== selfId()) return refreshBoard();
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
        const now = performance.now();
        if (!alive || now - lastThrowAt < THROW_COOLDOWN * 1000) return false;
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
            sniper
        });
        if (sniper) {
            sound.sniperThrow();
            punch = 1.6;
            shake = Math.max(shake, 0.05);
            kickLook(player, 1.8, (Math.random() - 0.5) * 0.8); // recoil
        } else {
            sound.throw();
            punch = 1;
        }
        net.pose(pose(), true);
        net.throw(record);
        throws++;
        return true;
    };

    const locked = () => document.pointerLockElement === canvas;
    const cancelCharge = () => {
        chargingSince = null;
        aimSoundPlayed = false;
        aimReadyPlayed = false;
        ui.charge(null);
    };
    window.addEventListener('mousedown', (event) => {
        // Right button while charging or aiming: stand down without throwing.
        if (event.button === 2 && chargingSince !== null) return cancelCharge();
        if (event.button !== 0 || !locked() || !alive || !started || inputPaused) return;
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
        if (!started || !alive || inputPaused || chargingSince !== null || inspectSince !== null) return false;
        const now = performance.now();
        if ((now - lastThrowAt) / 1000 <= THROW_COOLDOWN) return false; // disc not back in hand yet
        inspectSince = now;
        caught = false;
        sound.inspect(INSPECT_SECONDS, TOSS_AT, CATCH_AT);
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
    window.addEventListener('keydown', (event) => {
        if (event.code === 'Tab' && locked()) {
            event.preventDefault();
            showBoard(true);
        }
        // F: inspect the disc in hand (only when it is in hand and not winding up).
        if (event.code === 'KeyF' && !event.repeat && locked()) startInspect();
    });
    window.addEventListener('keyup', (event) => {
        if (event.code === 'Tab') showBoard(false);
    });

    const animateFeel = (deltaTime: number, now: number) => {
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
        cam.fov = viewFov * fovFactor(aim) + punch * 2.5;
        const script = controller() as unknown as { lookSens?: number; speedGround?: number } | null;
        if (script) {
            script.lookSens = viewSens * sensitivityFactor(viewFov, aim);
            if (walkSpeed === null) walkSpeed = script.speedGround ?? 40;
            script.speedGround = walkSpeed * (1 - (1 - SCOPE.moveScale) * aim);
        }
        ui.scope(aim, ready);
        shake = Math.max(0, shake - deltaTime * 0.35);
        const jitter = shake * shake * 4;
        camera.setLocalPosition(
            eyeOffset.x + (Math.random() - 0.5) * jitter,
            eyeOffset.y + (Math.random() - 0.5) * jitter,
            eyeOffset.z
        );
        // In-hand disc: visible when ready, pulled back while charging, gone during the cooldown after a throw.
        const sinceThrow = (now - lastThrowAt) / 1000;
        const inHand = Math.min(1, Math.max(0, (sinceThrow - THROW_COOLDOWN * 0.5) / (THROW_COOLDOWN * 0.5)));
        const charge = chargingSince === null ? 0 : Math.min(1, (now - chargingSince) / 1000 / THROW.chargeSeconds);
        viewmodel.enabled = started && alive;
        if (!alive) inspectSince = null;
        const inspecting = inspectSince !== null || inspectHold !== null;
        const u = inspecting ? (inspectHold ?? (now - inspectSince!) / 1000 / INSPECT_SECONDS) : 1;
        if (u >= 1) inspectSince = null;
        // Afterimages follow the disc a few milliseconds behind while it flies.
        ghosts.forEach((ghost, index) => {
            const lag = u - (index + 1) * 0.011;
            ghost.entity.enabled = viewmodel.enabled && u < 1 && airborne(u) && airborne(lag);
            if (!ghost.entity.enabled) return;
            const [p, e] = inspectPose(lag);
            ghost.entity.setLocalPosition(p[0], p[1], p[2]);
            ghost.entity.setLocalEulerAngles(e[0], e[1], e[2]);
        });
        if (u < 1) {
            const [p, e] = inspectPose(u);
            viewmodel.setLocalPosition(p[0], p[1], p[2]);
            viewmodel.setLocalEulerAngles(e[0], e[1], e[2]);
            // Snap catch: a small FOV kick and a jolt of the view.
            if (!caught && u >= CATCH_AT && inspectHold === null) {
                caught = true;
                punch = Math.max(punch, 0.55);
                shake = Math.max(shake, 0.05);
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

    const targets = new Map<string, V3>();
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
        /**
         * Draws every gameplay visual once while the title screen still covers the canvas — thrown disc and its
         * physics body, in-hand disc with stripe, inspect afterimages, hit sparks and ring, another player — so their
         * shaders are compiled before play instead of on the first hit, inspect or opponent (a visible hitch).
         */
        async prewarm() {
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
            if (!alive) ui.eliminated(killer, Math.max(0, (deadUntil - now) / 1000));
            if (net.state === 'online' && alive) net.pose(pose());
            const eye = camera.getPosition();
            const f = camera.forward;
            sound.listener([eye.x, eye.y, eye.z], [f.x, f.y, f.z]);
            poses = net.poses();
            avatars.update(poses, now);
            animateFeel(deltaTime, now);
            effects.update(deltaTime);
            targets.clear();
            for (const [id, each] of poses) targets.set(id, each.p);
            discs.update(
                deltaTime,
                targets,
                (throwId, target, at) => {
                    // Instant local confirmation (the room's verdict follows within a round trip).
                    ui.hitMarker('hit');
                    hitsClaimed++;
                    net.hit(throwId, target, at.map(round) as V3);
                },
                (at, speed) => sound.bounce(at, speed),
                (at, hue) => effects.tracer(at, hue)
            );
        },
        get alive() {
            return alive;
        },
        get online() {
            return net.state === 'online';
        },
        /** The player's normal field of view and mouse sensitivity (the sniper scope scales from these). */
        setView(fov: number, lookSensitivity: number) {
            viewFov = fov;
            viewSens = lookSensitivity;
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
            if (script) script.enabled = alive && !paused;
            if (paused) {
                chargingSince = null;
                ui.charge(null);
            }
        },
        debug: {
            state: () => ({
                net: net.state,
                id: net.id,
                alive,
                hp,
                players: [...roster.values()].map((entry) => ({ ...entry })),
                discs: discs.count,
                throws,
                hitsClaimed,
                inspecting: inspectSince !== null,
                aim
            }),
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

const round = (value: number) => Math.round(value * 1000) / 1000;

export type MatchDebug = ReturnType<typeof createMatch>['debug'];
