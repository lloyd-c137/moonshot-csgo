// Stages the final-minute entrance ceremony (timeline in ceremonyPlan.ts): walking, waving stand-ins for every
// entrant, roof spotlights that follow them, warm tunnel lights, the entrance shutters (visible and, once down,
// solid for the rest of the final minute), lamp rings that light the arena from the centre out, and the camera.
import type { AppBase, Entity as EntityType } from 'playcanvas';
import { BLEND_ADDITIVE, Color, Entity, MeshInstance, StandardMaterial, Vec3 } from 'playcanvas';

import type { CharacterAssetLoader } from '../../characters/CharacterAssetLoader';
import { MeshBuilder } from '../../render/meshBuilder';
import { tierRadiusAt } from '../../world/arenaAccess';
import type { Point2 } from '../../world/stadiumLayout';
import { courtSurroundPath, intersectRadius, ringRadii, STADIUM, tierHeight, TENNIS } from '../../world/stadiumLayout';

import type { CeremonyPlan, Entrance, EntrantPlan, Shot } from './ceremonyPlan';
import { CEREMONY, entrances, entrantAt, ringLevel, shotAt, shutterAt } from './ceremonyPlan';

type Character = ReturnType<CharacterAssetLoader['create']>;
type V3 = [number, number, number];

const SHUTTER_HEIGHT = 3.55;
const SPOTLIGHTS = 4;

const emissiveMaterial = (name: string, colour: V3) => {
    const m = new StandardMaterial();
    m.name = name;
    m.diffuse.set(0, 0, 0);
    m.emissive.set(...colour);
    m.emissiveIntensity = 0;
    m.useLighting = false;
    m.update();
    return m;
};

/** A flat lamp band (width w) along a closed path of points at height y. */
const band = (builder: MeshBuilder, path: readonly Point2[], y: number, w: number, closed = true) => {
    const n = path.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
        const [ax, az] = path[i];
        const [bx, bz] = path[(i + 1) % n];
        const length = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / length) * (w / 2),
            nz = ((bx - ax) / length) * (w / 2);
        builder.quad(
            [
                [ax - nx, y, az - nz],
                [ax + nx, y, az + nz],
                [bx + nx, y, bz + nz],
                [bx - nx, y, bz - nz]
            ],
            [0, 1, 0],
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
            ]
        );
    }
};

/** A vertical lamp strip (height h) along a closed path, its bottom at y. */
const strip = (builder: MeshBuilder, path: readonly Point2[], y: number, h: number) => {
    const n = path.length;
    for (let i = 0; i < n; i++) {
        const [ax, az] = path[i];
        const [bx, bz] = path[(i + 1) % n];
        builder.quad(
            [
                [ax, y, az],
                [bx, y, bz],
                [bx, y + h, bz],
                [ax, y + h, az]
            ],
            [0, 0, 1],
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
            ]
        );
    }
};

const circle = (center: Point2, radius: (angle: number) => number, count = 96): Point2[] =>
    Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const r = radius(a);
        return [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
    });

export const createCeremonyView = (
    app: AppBase,
    playerCamera: EntityType,
    characters: CharacterAssetLoader,
    arena: { outline: readonly Point2[]; center: Point2 }
) => {
    const { center } = arena;
    const radii = ringRadii(arena.outline, center);
    const doors: Entrance[] = entrances((angle) => intersectRadius(arena.outline, center, angle));
    const root = new Entity('GameplayAuthored_FinalCeremony');
    app.root.addChild(root);

    // ---------- camera ----------
    const camera = new Entity('final-ceremony-camera');
    camera.addComponent('camera');
    camera.camera!.copy(playerCamera.camera!);
    camera.camera!.farClip = 260;
    camera.enabled = false;
    app.root.addChild(camera);
    let smoothed: Shot | null = null;

    // ---------- entrance shutters (visual + collider) ----------
    const shutterMaterial = new StandardMaterial();
    shutterMaterial.diffuse.set(0.42, 0.45, 0.5);
    shutterMaterial.useMetalness = true;
    shutterMaterial.metalness = 0.75;
    shutterMaterial.gloss = 0.55;
    shutterMaterial.update();
    const stripeMaterial = emissiveMaterial('ceremony-shutter-warning', [1, 0.72, 0.1]);
    const shutters = doors.map((door) => {
        const [ox, oz] = door.out;
        const x = center[0] + ox * door.radius,
            z = center[1] + oz * door.radius;
        const yaw = (-(door.angle + Math.PI / 2) * 180) / Math.PI;
        const panel = new Entity(`ceremony-shutter-${door.id}`);
        panel.addComponent('render', { type: 'box', material: shutterMaterial, castShadows: false });
        panel.setPosition(x, SHUTTER_HEIGHT, z);
        panel.setEulerAngles(0, yaw, 0);
        panel.enabled = false;
        root.addChild(panel);
        const warning = new Entity(`ceremony-shutter-light-${door.id}`);
        warning.addComponent('render', { type: 'box', material: stripeMaterial, castShadows: false });
        warning.setPosition(x - ox * 0.12, SHUTTER_HEIGHT + 0.06, z - oz * 0.12);
        warning.setEulerAngles(0, yaw, 0);
        warning.setLocalScale(door.width, 0.08, 0.05);
        root.addChild(warning);
        const body = new Entity(`GameplayAuthored_CeremonyShutterCollider_${door.id}`);
        body.addComponent('collision', {
            type: 'box',
            halfExtents: new Vec3(door.width / 2, SHUTTER_HEIGHT / 2, 0.15)
        });
        body.addComponent('rigidbody', { type: 'static', friction: 0, restitution: 0.2 });
        body.setPosition(x, SHUTTER_HEIGHT / 2, z);
        body.setEulerAngles(0, yaw, 0);
        body.enabled = false;
        root.addChild(body);
        // A warm light inside each tunnel: the only light in the dark arena before the walk-ins.
        const tunnel = new Entity(`ceremony-tunnel-light-${door.id}`);
        tunnel.addComponent('light', {
            type: 'omni',
            color: new Color(1, 0.78, 0.5),
            intensity: 0,
            range: 9,
            castShadows: false
        });
        tunnel.setPosition(center[0] + ox * (door.radius + 1.6), 2.6, center[1] + oz * (door.radius + 1.6));
        root.addChild(tunnel);
        return { door, panel, warning, body, tunnel, x, z };
    });
    /** Shutter drop 0 (open) … 1 (shut); solid once fully down. */
    const setShutter = (index: number, drop: number) => {
        const { panel, body, door } = shutters[index];
        panel.enabled = drop > 0.001;
        const height = SHUTTER_HEIGHT * drop;
        panel.setLocalScale(door.width, Math.max(0.001, height), 0.12);
        panel.setPosition(panel.getPosition().x, SHUTTER_HEIGHT + 0.03 - height / 2, panel.getPosition().z);
        body.enabled = drop >= 1;
    };

    // ---------- light rings, centre out ----------
    const ringMeshes: { entity: EntityType; material: StandardMaterial }[] = [];
    const ringColours: V3[] = [
        [1, 0.96, 0.85],
        [0.7, 0.95, 1],
        [1, 1, 1],
        [0.3, 0.75, 1],
        [1, 0.97, 0.9],
        [1, 0.97, 0.9],
        [1, 0.98, 0.92]
    ];
    const ringBuilders = ringColours.map(() => new MeshBuilder());
    // 0: a medallion of light at the centre of the court.
    band(
        ringBuilders[0],
        circle(center, () => 1.5, 48),
        0.03,
        0.22
    );
    band(
        ringBuilders[0],
        circle(center, () => 2.4, 64),
        0.03,
        0.08
    );
    // 1: the tennis court's outline.
    {
        const hw = TENNIS.doublesHalfWidth + 0.6,
            hl = TENNIS.halfLength + 0.8;
        const cx = TENNIS.centerX,
            cz = TENNIS.netZ;
        band(
            ringBuilders[1],
            [
                [cx - hw, cz - hl],
                [cx + hw, cz - hl],
                [cx + hw, cz + hl],
                [cx - hw, cz + hl]
            ],
            0.03,
            0.12
        );
    }
    // 2: the court surround's top edge.
    band(ringBuilders[2], courtSurroundPath(), 0.93, 0.1);
    // 3: the parapet coping, all the way round.
    strip(
        ringBuilders[3],
        circle(center, (a) => tierRadiusAt(radii, a, 0) - STADIUM.setback - 0.33),
        STADIUM.fasciaTop - 0.02,
        0.1
    );
    // 4: lower bowl — along the cross-aisle walkway's front.
    strip(
        ringBuilders[4],
        circle(center, (a) => tierRadiusAt(radii, a, STADIUM.walkwayTier) - 0.02),
        tierHeight(STADIUM.walkwayTier),
        0.08
    );
    strip(
        ringBuilders[4],
        circle(center, (a) => tierRadiusAt(radii, a, 4) - 0.02),
        tierHeight(4) - 0.05,
        0.05
    );
    // 5: upper bowl and the back of the top tier.
    strip(
        ringBuilders[5],
        circle(center, (a) => tierRadiusAt(radii, a, 13) - 0.02),
        tierHeight(13) - 0.05,
        0.05
    );
    strip(
        ringBuilders[5],
        circle(center, (a) => tierRadiusAt(radii, a, STADIUM.tiers - 1) + STADIUM.tierRun - 0.03),
        tierHeight(STADIUM.tiers - 1) + STADIUM.tierRise,
        0.14
    );
    // 6: under the roof ring.
    strip(
        ringBuilders[6],
        circle(center, (a) => tierRadiusAt(radii, a, 0) - STADIUM.roofInnerInset + 0.4),
        STADIUM.roofInnerHeight - 0.6,
        0.18
    );
    ringBuilders.forEach((builder, k) => {
        const material = emissiveMaterial(`ceremony-ring-${k}`, ringColours[k]);
        material.blendType = BLEND_ADDITIVE;
        material.depthWrite = false;
        material.update();
        const entity = new Entity(`ceremony-ring-${k}`);
        entity.addComponent('render', {
            meshInstances: [new MeshInstance(builder.build(app.graphicsDevice), material)],
            castShadows: false
        });
        entity.enabled = false;
        root.addChild(entity);
        ringMeshes.push({ entity, material });
    });
    // Real light for the first rings (the floodlights in match.ts take over at the last).
    const centreLight = new Entity('ceremony-centre-light');
    centreLight.addComponent('light', {
        type: 'omni',
        color: new Color(1, 0.96, 0.88),
        intensity: 0,
        range: 18,
        castShadows: false
    });
    centreLight.setPosition(center[0], 7, center[1]);
    root.addChild(centreLight);

    // ---------- roof spotlights that follow the entrants ----------
    const spots = Array.from({ length: SPOTLIGHTS }, (_, i) => {
        const spot = new Entity(`ceremony-spot-${i}`);
        spot.addComponent('light', {
            type: 'spot',
            color: new Color(1, 0.97, 0.9),
            intensity: 0,
            range: 40,
            innerConeAngle: 5,
            outerConeAngle: 9,
            castShadows: false
        });
        root.addChild(spot);
        return spot;
    });

    // ---------- stand-ins ----------
    const puppets = new Map<string, { character: Character; holder: EntityType; clip: string }>();
    const clearPuppets = () => {
        for (const { character, holder } of puppets.values()) {
            character.dispose();
            holder.destroy();
        }
        puppets.clear();
    };
    const puppetFor = (e: EntrantPlan, headImage: (id: string) => HTMLImageElement | HTMLCanvasElement | null) => {
        let puppet = puppets.get(e.id);
        if (puppet) return puppet;
        const character = characters.create({ name: `ceremony-${e.id}`, colour: e.colour, castShadows: true });
        const head = headImage(e.id);
        if (head) character.setHeadImage(head);
        const holder = new Entity(`ceremony-holder-${e.id}`);
        holder.addChild(character.root);
        root.addChild(holder);
        puppet = { character, holder, clip: '' };
        puppets.set(e.id, puppet);
        return puppet;
    };

    let plan: CeremonyPlan | null = null;
    let lastT = -1;
    let headImage: (id: string) => HTMLImageElement | HTMLCanvasElement | null = () => null;

    const lerp3 = (a: V3, b: V3, k: number): V3 => [
        a[0] + (b[0] - a[0]) * k,
        a[1] + (b[1] - a[1]) * k,
        a[2] + (b[2] - a[2]) * k
    ];

    return {
        doors,
        shutterProbes: () => shutters.map(({ door, x, z }) => ({
            id: door.id,
            from: [x + door.out[0] * 2, 1.4, z + door.out[1] * 2] as V3,
            to: [x - door.out[0] * 2, 1.4, z - door.out[1] * 2] as V3
        })),
        metrics: () => ({ entrantActors: puppets.size, spotlights: SPOTLIGHTS }),
        get running() {
            return plan !== null;
        },
        start(next: CeremonyPlan, images: (id: string) => HTMLImageElement | HTMLCanvasElement | null) {
            clearPuppets();
            plan = next;
            headImage = images;
            smoothed = null;
            lastT = -1;
            playerCamera.enabled = false;
            camera.enabled = true;
            for (const { entity } of ringMeshes) entity.enabled = true;
        },
        /** Advances to ceremony time t (seconds since it began). Returns ring/shutter events that crossed this frame. */
        update(t: number, dt: number) {
            if (!plan) return { struck: [] as number[], shut: [] as string[], entered: [] as EntrantPlan[] };
            const events = { struck: [] as number[], shut: [] as string[], entered: [] as EntrantPlan[] };
            // Stand-ins.
            for (const e of plan.entrants) {
                const at = entrantAt(e, t);
                const puppet = puppetFor(e, headImage);
                puppet.holder.enabled = at.visible;
                puppet.holder.setPosition(at.position[0], 0, at.position[2]);
                puppet.holder.setEulerAngles(0, (at.yaw * 180) / Math.PI, 0);
                const clip = at.walking ? 'Walk_Wave_Loop' : at.arrived ? 'Idle_Wave_Loop' : 'Idle_Loop';
                if (clip !== puppet.clip) {
                    puppet.character.play(clip, 0.25);
                    puppet.clip = clip;
                }
                if (lastT < e.start && t >= e.start) events.entered.push(e);
            }
            // Spotlights: the most recent entrants (up to four), from the roof above their entrance.
            const lit = plan.entrants.filter((e) => t >= e.start - 0.1).slice(-SPOTLIGHTS);
            const fadeAll = Math.max(0, Math.min(1, (t - plan.ringsAt) / 1.5));
            spots.forEach((spot, i) => {
                const e = lit[i];
                if (!e || fadeAll >= 1) {
                    spot.light!.intensity = 0;
                    return;
                }
                const at = entrantAt(e, t).position;
                const [ox, oz] = e.entrance.out;
                const side = e.order % 2 ? 0.35 : -0.35;
                const r = e.entrance.radius - 2;
                spot.setPosition(
                    center[0] + (ox * Math.cos(side) - oz * Math.sin(side)) * r,
                    STADIUM.roofInnerHeight - 1,
                    center[1] + (oz * Math.cos(side) + ox * Math.sin(side)) * r
                );
                spot.lookAt(new Vec3(at[0], 0.9, at[2]));
                spot.rotateLocal(90, 0, 0); // spot lights shine down their local −y
                const on = Math.min(1, (t - e.start + 0.1) / 0.15);
                spot.light!.intensity = 9 * on * (1 - fadeAll);
            });
            // Tunnels glow until their shutter starts to fall.
            shutters.forEach(({ tunnel, door }, i) => {
                const fade = Math.max(0, Math.min(1, (t - CEREMONY.fade) / 1.2));
                const drop = shutterAt(plan!, door.id, t);
                tunnel.light!.intensity = 2.2 * fade * (1 - drop);
                if (
                    lastT < plan!.shutters[door.id] + CEREMONY.shutterDrop &&
                    t >= plan!.shutters[door.id] + CEREMONY.shutterDrop
                )
                    events.shut.push(door.id);
                setShutter(i, drop);
            });
            // Rings.
            ringMeshes.forEach(({ material }, k) => {
                const level = ringLevel(plan!, k, t);
                material.emissiveIntensity = level * 2.2;
                material.update();
                if (lastT < plan!.ring(k) && t >= plan!.ring(k)) events.struck.push(k);
            });
            centreLight.light!.intensity = Math.min(1, ringLevel(plan, 0, t)) * 2.4;
            // Camera: eased toward the planned shot (cuts between entrants happen over ~0.3 s).
            const target = shotAt(plan, center, t);
            const k = smoothed ? 1 - Math.exp(-dt * (target.fov < 50 ? 9 : 3)) : 1;
            smoothed = smoothed
                ? {
                      eye: lerp3(smoothed.eye, target.eye, k),
                      target: lerp3(smoothed.target, target.target, k),
                      fov: smoothed.fov + (target.fov - smoothed.fov) * k
                  }
                : target;
            camera.setPosition(...smoothed.eye);
            camera.lookAt(new Vec3(...smoothed.target));
            camera.camera!.fov = smoothed.fov;
            lastT = t;
            return events;
        },
        /** Final-minute lighting level for match.ts's floodlights (the last ring). */
        floodLevel(t: number) {
            return plan ? Math.min(1, ringLevel(plan, CEREMONY.rings - 1, t)) : 0;
        },
        stop() {
            plan = null;
            clearPuppets();
            camera.enabled = false;
            playerCamera.enabled = true;
            for (const spot of spots) spot.light!.intensity = 0;
            for (const { tunnel } of shutters) tunnel.light!.intensity = 0;
            centreLight.light!.intensity = 0;
        },
        /** Lamp rings stay lit for the final minute; off again when it is over. */
        setRingsLit(lit: boolean) {
            ringMeshes.forEach(({ entity, material }) => {
                entity.enabled = lit;
                material.emissiveIntensity = lit ? 2.2 : 0;
                material.update();
            });
        },
        /** The entrances: shut (solid) during the final minute, open otherwise. */
        setShuttersClosed(closed: boolean) {
            shutters.forEach((_, i) => setShutter(i, closed ? 1 : 0));
        },
        shuttersClosed: () => shutters.every(({ body }) => body.enabled)
    };
};
