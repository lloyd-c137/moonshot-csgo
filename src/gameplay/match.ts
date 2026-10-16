// The shared-world frisbee game: throwing input, the network session, other players, eliminations and respawns.
// Works offline as frisbee practice when no server is configured or reachable.
import type { AppBase, RigidBodyComponentSystem } from 'playcanvas';
import { Entity, Vec3 } from 'playcanvas';
import { FirstPersonController } from 'playcanvas/scripts/esm/first-person-controller.mjs';

import { PLAYER } from '../config/gameplay';
import { SPAWN_POINTS } from '../config/spawns';
import { createNetClient } from '../net/client';
import type { NetState } from '../net/client';
import type { PlayerPose, PlayerSummary, ThrowRecord } from '../net/protocol';
import { colourFor, MAX_HP, RESPAWN_SECONDS, SPAWN_PROTECTION, THROW_COOLDOWN } from '../net/protocol';
import { setLook } from '../player/playerController';
import type { Ui } from '../ui/shell';

import { createAvatars } from './avatars';
import { createDiscs } from './discs';
import type { V3 } from './frisbee';
import { chargeSpeed, launchNormal, THROW } from './frisbee';
import { createSound } from './sound';

type Options = { app: AppBase; player: Entity; camera: Entity; canvas: HTMLCanvasElement; ui: Ui; url: string | null };

export const createMatch = ({ app, player, camera, canvas, ui, url }: Options) => {
    const rigidbody = app.systems.rigidbody as RigidBodyComponentSystem;
    const discs = createDiscs(app, PLAYER.gravity);
    const avatars = createAvatars(app, camera, ui.nameTagLayer());
    const roster = new Map<string, PlayerSummary>();
    let netState: NetState = 'offline';
    let alive = true;
    let deadUntil = 0;
    let chargingSince: number | null = null;
    let lastThrowAt = -Infinity;
    let throwCounter = 0;
    let started = false;
    let throws = 0;
    let hitsClaimed = 0;
    let killer = '';
    let hp = MAX_HP;
    const sound = createSound();
    let poses = new Map<string, PlayerPose>();
    /** Recent eliminations per killer, for streak announcements. */
    const streaks = new Map<string, { count: number; at: number }>();
    // Feel: FOV punch on release, camera shake when hit, in-hand disc that winds up and snaps forward.
    let punch = 0;
    let shake = 0;
    let baseFov = camera.camera!.fov;
    const eyeOffset = camera.getLocalPosition().clone();
    const viewmodel = new Entity('viewmodel-disc');
    viewmodel.addComponent('render', { meshInstances: discs.meshInstances(colourFor('local')), castShadows: false });
    viewmodel.enabled = false;
    viewmodel.setLocalScale(0.85, 0.85, 0.85);
    camera.addChild(viewmodel);
    let viewmodelHue = -1;

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
                      me: entry.id === me
                  }))
                : [{ name: '你（离线练习）', score: 0, hp, alive, colour: colourFor('local'), me: true }]
        );
        ui.health(hp, MAX_HP);
        // The leader (most points, at least one) carries the 淘汰王 title above their head too.
        const leader = [...roster.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0];
        avatars.setLeader(leader && leader.score > 0 ? leader.id : null);
        const myHue = roster.get(me)?.colour ?? colourFor('local');
        if (myHue !== viewmodelHue) {
            viewmodelHue = myHue;
            viewmodel.render!.meshInstances = discs.meshInstances(myHue);
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
        return {
            p: [round(p.x), round(p.y), round(p.z)],
            yaw: round((Math.atan2(-f.x, -f.z) * 180) / Math.PI),
            pitch: round((Math.asin(Math.max(-1, Math.min(1, f.y))) * 180) / Math.PI)
        };
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
        if (script) script.enabled = value;
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
        welcome: (me, players) => {
            roster.clear();
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
            sound.throw(record.o);
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
                local: false
            });
        },
        struck: (target, by, targetHp, out, at, scores) => {
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
                shake = out ? 0.12 : 0.07;
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
                sound.hitConfirm(out);
                ui.hitMarker(out ? 'kill' : 'hit');
                if (!out) ui.feed(`命中 ${nameOf(target)} · +1`, 'mine');
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
                ui.broadcast(nameOf(by), nameOf(target), target === me ? 'me' : by === me ? 'mine' : 'neutral', streak);
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
    const throwDisc = (speed: number) => {
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
        origin.copy(eye).add(new Vec3().copy(forward).mulScalar(0.5)).add(new Vec3().copy(right).mulScalar(0.18));
        origin.y -= 0.15;
        // Never launch from inside a wall right in front of the camera.
        if (rigidbody.raycastFirst(eye, origin)) origin.copy(eye).add(new Vec3().copy(forward).mulScalar(0.12));
        const v = player.rigidbody!.linearVelocity;
        const velocity: V3 = [
            forward.x * speed + v.x * 0.5,
            forward.y * speed + v.y * 0.3,
            forward.z * speed + v.z * 0.5
        ];
        const record: ThrowRecord = {
            id: ++throwCounter,
            o: [round(origin.x), round(origin.y), round(origin.z)],
            v: velocity.map(round) as V3,
            tilt: 0
        };
        discs.launch({
            owner: selfId(),
            throwId: record.id,
            hue: roster.get(selfId())?.colour ?? colourFor('local'),
            origin: record.o,
            velocity: record.v,
            normal: launchNormal(record.v, record.tilt),
            local: true
        });
        sound.throw();
        punch = 1;
        net.pose(pose(), true);
        net.throw(record);
        throws++;
        return true;
    };

    const locked = () => document.pointerLockElement === canvas;
    window.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || !locked() || !alive || !started) return;
        chargingSince = performance.now();
    });
    window.addEventListener('mouseup', (event) => {
        if (event.button !== 0 || chargingSince === null) return;
        const held = (performance.now() - chargingSince) / 1000;
        chargingSince = null;
        ui.charge(null);
        if (locked()) throwDisc(chargeSpeed(held));
    });
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
    });
    window.addEventListener('keyup', (event) => {
        if (event.code === 'Tab') showBoard(false);
    });

    const animateFeel = (deltaTime: number, now: number) => {
        const cam = camera.camera!;
        if (punch <= 0.001) baseFov = cam.fov;
        punch = Math.max(0, punch - deltaTime * 6);
        cam.fov = baseFov + punch * 2.5;
        shake = Math.max(0, shake - deltaTime * 0.35);
        const jitter = shake * shake * 4;
        camera.setLocalPosition(
            eyeOffset.x + (Math.random() - 0.5) * jitter,
            eyeOffset.y + (Math.random() - 0.5) * jitter,
            eyeOffset.z
        );
        // In-hand disc: visible when ready, pulled back while charging, gone during the cooldown after a throw.
        const sinceThrow = (now - lastThrowAt) / 1000;
        const ready = Math.min(1, Math.max(0, (sinceThrow - THROW_COOLDOWN * 0.5) / (THROW_COOLDOWN * 0.5)));
        const charge = chargingSince === null ? 0 : Math.min(1, (now - chargingSince) / 1000 / THROW.chargeSeconds);
        viewmodel.enabled = started && alive;
        const bob = Math.sin(now / 260) * 0.004;
        viewmodel.setLocalPosition(
            0.3 + charge * 0.09,
            -0.31 - (1 - ready) * 0.25 + charge * 0.05 + bob,
            -0.66 + charge * 0.16
        );
        viewmodel.setLocalEulerAngles(18 - charge * 25, -12 - charge * 30, -8 - charge * 10);
    };

    const targets = new Map<string, V3>();
    return {
        /** Joins the shared world (first entry only). */
        start(name: string) {
            if (started) return;
            started = true;
            sound.unlock();
            viewmodel.enabled = true;
            // Warm-up: create (and soon remove) one disc body so the first real throw does not pay for the physics
            // shape and contact set-up; the in-hand disc already compiles the disc material's shader.
            const eye = camera.getPosition();
            discs.launch({
                owner: 'warm-up',
                throwId: 0,
                hue: colourFor('local'),
                origin: [eye.x, -2, eye.z],
                velocity: [0, 0, 0],
                normal: [0, 1, 0],
                local: false
            });
            refreshBoard();
            net.connect(name);
            refreshCount();
        },
        update(deltaTime: number) {
            const now = performance.now();
            if (chargingSince !== null) ui.charge(Math.min(1, (now - chargingSince) / 1000 / THROW.chargeSeconds));
            if (!alive) ui.eliminated(killer, Math.max(0, (deadUntil - now) / 1000));
            if (net.state === 'online' && alive) net.pose(pose());
            const eye = camera.getPosition();
            const f = camera.forward;
            sound.listener([eye.x, eye.y, eye.z], [f.x, f.y, f.z]);
            poses = net.poses();
            avatars.update(poses, now);
            animateFeel(deltaTime, now);
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
                (at, speed) => sound.bounce(at, speed)
            );
        },
        get alive() {
            return alive;
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
                hitsClaimed
            }),
            throwAt: (x: number, y: number, z: number, speed: number = THROW.maxSpeed) => {
                const eye = camera.getPosition();
                const dx = x - eye.x;
                const dy = y - eye.y;
                const dz = z - eye.z;
                const yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
                const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
                setLook(player, pitch, yaw);
                camera.setEulerAngles(pitch, yaw, 0);
                return throwDisc(speed);
            }
        }
    };
};

const round = (value: number) => Math.round(value * 1000) / 1000;

export type MatchDebug = ReturnType<typeof createMatch>['debug'];
