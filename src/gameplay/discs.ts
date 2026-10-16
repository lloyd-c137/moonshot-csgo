// Thrown discs in the scene: Ammo rigid bodies that collide with the level only (walls, floors, furniture), steered
// each frame by the flying-disc model. Discs launched by the local player also test their path against the other
// players and report hits; remote players' discs are replayed for display only (their throwers decide hits).
import type { AppBase, Entity as EntityType } from 'playcanvas';
import {
    BODYGROUP_USER_1,
    BODYMASK_STATIC,
    Color,
    CULLFACE_BACK,
    Entity,
    Mesh,
    MeshInstance,
    Quat,
    StandardMaterial,
    Vec3
} from 'playcanvas';

import { SNIPER } from '../net/protocol';
import { cylinder, merge, place, torus } from '../render/shapes';

import type { V3 } from './frisbee';
import { DISC, DISC_LIVE_SECONDS, discAcceleration, discHitsPlayer } from './frisbee';

type Disc = {
    entity: EntityType;
    visual: EntityType;
    normal: V3;
    owner: string;
    throwId: number;
    local: boolean;
    age: number;
    live: boolean;
    spin: number;
    last: V3;
    settledFor: number;
    /** Sniper disc: flies dead straight (no drop or lift) for SNIPER.straightSeconds, with a tracer. */
    sniper: boolean;
    hue: number;
    gold: boolean;
};

/** Discs in the world at once; the oldest is removed first. Fewer bodies keep physics steps cheap. */
const MAX_DISCS = 24;
const DISC_REMOVE_SECONDS = 8;
/** A disc lying still this long is handed over to the floor list (and picked up from there). */
const SETTLED_HANDOVER_SECONDS = 0.5;

export const hueColour = (hue: number): [number, number, number] => {
    // HSL(hue, 75%, 52%) → RGB
    const s = 0.75;
    const l = 0.52;
    const k = (n: number) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
};

export const createDiscs = (app: AppBase, worldGravity: number) => {
    const discs: Disc[] = [];
    const shape = merge([
        place(cylinder(DISC.radius - 0.01, 0.012, 32), { y: 0.004 }),
        place(cylinder(DISC.radius - 0.035, 0.004, 24), { y: 0.0115 }),
        torus(DISC.radius - 0.012, 0.012, 32, 8)
    ]);
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(shape.positions);
    mesh.setNormals(shape.normals);
    mesh.setIndices(shape.indices);
    mesh.update();
    // Shared by every disc: keep our own reference so removing the last disc never destroys the mesh.
    mesh.incRefCount();
    const materials = new Map<number, StandardMaterial>();
    const meshFor = (hue: number) => {
        let material = materials.get(hue);
        if (!material) {
            material = new StandardMaterial();
            material.name = `disc-${hue}`;
            material.diffuse = new Color(...hueColour(hue));
            material.useMetalness = true;
            material.metalness = 0;
            material.gloss = 0.55;
            material.cull = CULLFACE_BACK;
            material.update();
            materials.set(hue, material);
        }
        return [new MeshInstance(mesh, material)];
    };

    let goldMaterial: StandardMaterial | null = null;
    const orientation = new Quat();
    const up = new Vec3(0, 1, 0);
    const normalVec = new Vec3();
    const force = new Vec3();

    let bounceHandler: ((at: V3, speed: number) => void) | null = null;
    const remove = (disc: Disc) => {
        disc.entity.destroy();
        discs.splice(discs.indexOf(disc), 1);
    };

    return {
        get count() {
            return discs.length;
        },
        /** Launches a disc; `normal` is the disc-plane normal (see launchNormal). */
        launch(options: {
            owner: string;
            throwId: number;
            hue: number;
            origin: V3;
            velocity: V3;
            normal: V3;
            local: boolean;
            sniper?: boolean;
            /** Thrown by the golden disc's holder: drawn in gold. */
            gold?: boolean;
        }) {
            if (discs.length >= MAX_DISCS) remove(discs[0]);
            const entity = new Entity(`disc-${options.owner}-${options.throwId}`);
            // The body keeps the disc's flight attitude; a child carries the mesh and spins for show.
            const visual = new Entity('disc-visual');
            visual.addComponent('render', {
                meshInstances:
                    options.gold && goldMaterial ? [new MeshInstance(mesh, goldMaterial)] : meshFor(options.hue),
                castShadows: false
            });
            visual.setLocalPosition(0, -0.008, 0);
            entity.addChild(visual);
            entity.addComponent('collision', {
                type: 'cylinder',
                radius: DISC.radius,
                height: DISC.thickness,
                axis: 1
            });
            entity.addComponent('rigidbody', {
                type: 'dynamic',
                mass: DISC.mass,
                friction: 0.35,
                restitution: 0.45,
                linearDamping: 0.02,
                angularDamping: 0,
                angularFactor: Vec3.ZERO,
                group: BODYGROUP_USER_1,
                mask: BODYMASK_STATIC
            });
            normalVec.set(...options.normal);
            orientation.setFromDirections(up, normalVec);
            entity.setPosition(...options.origin);
            entity.setRotation(orientation);
            app.root.addChild(entity);
            const body = entity.rigidbody!;
            let lastBounce = 0;
            entity.collision!.on('collisionstart', () => {
                const now = performance.now();
                const speed = body.linearVelocity.length();
                if (now - lastBounce < 120 || speed < 1.5) return;
                lastBounce = now;
                const p = entity.getPosition();
                bounceHandler?.([p.x, p.y, p.z], speed);
            });
            body.teleport(new Vec3(...options.origin), orientation);
            body.linearVelocity = new Vec3(...options.velocity);
            // Continuous collision so a fast, thin disc cannot tunnel through walls.
            const ammoBody = (
                body as unknown as {
                    body?: { setCcdMotionThreshold(v: number): void; setCcdSweptSphereRadius(v: number): void };
                }
            ).body;
            ammoBody?.setCcdMotionThreshold(0.02);
            ammoBody?.setCcdSweptSphereRadius(0.06);
            discs.push({
                entity,
                visual,
                normal: options.normal,
                owner: options.owner,
                throwId: options.throwId,
                local: options.local,
                age: 0,
                live: true,
                spin: 0,
                last: options.origin,
                settledFor: 0,
                sniper: options.sniper === true,
                hue: options.hue,
                gold: options.gold === true
            });
        },
        /**
         * Steps aerodynamics and, for local discs, tests their path this frame against `targets`
         * (player id → capsule centre). Calls `onHit` once per disc.
         */
        update(
            deltaTime: number,
            targets: Map<string, V3>,
            onHit: (throwId: number, target: string, at: V3, velocity: V3) => void,
            onBounce?: (at: V3, speed: number) => void,
            onTracer?: (at: V3, hue: number) => void,
            onRest?: (rest: { owner: string; throwId: number; local: boolean; gold: boolean; at: V3 | null }) => void
        ) {
            bounceHandler = onBounce ?? null;
            // Backwards, so removing a disc does not skip the next one (and no per-frame array copy).
            for (let index = discs.length - 1; index >= 0; index--) {
                const disc = discs[index];
                disc.age += deltaTime;
                const body = disc.entity.rigidbody!;
                const v = body.linearVelocity;
                const velocity: V3 = [v.x, v.y, v.z];
                const p = disc.entity.getPosition();
                const position: V3 = [p.x, p.y, p.z];
                const speed = Math.hypot(...velocity);
                // Aerodynamics only while flying; once it skids along the floor it is just a sliding body.
                const straight = disc.sniper && disc.live && disc.age < SNIPER.straightSeconds;
                if (straight) {
                    // Sniper disc: cancel gravity exactly, no aerodynamics — it goes where it was aimed.
                    force.set(0, Math.abs(worldGravity) * DISC.mass, 0);
                    body.applyForce(force);
                    onTracer?.(position, disc.hue);
                } else if (disc.live || p.y > 0.25) {
                    if (disc.gold && disc.live) onTracer?.(position, -1);
                    const a = discAcceleration(velocity, disc.normal, worldGravity);
                    force.set(a[0] * DISC.mass, a[1] * DISC.mass, a[2] * DISC.mass);
                    body.applyForce(force);
                }
                // Spin for show about the disc's own axis.
                disc.spin += deltaTime * Math.min(40, speed * 3);
                disc.visual.setLocalEulerAngles(0, (disc.spin * 180) / Math.PI, 0);
                if (disc.live && disc.local) {
                    for (const [id, centre] of targets) {
                        if (id === disc.owner) continue;
                        if (discHitsPlayer(disc.last, position, centre)) {
                            disc.live = false;
                            onHit(disc.throwId, id, position, velocity);
                            break;
                        }
                    }
                }
                if (
                    disc.live &&
                    (disc.age > DISC_LIVE_SECONDS || (p.y < 0.2 && Math.abs(v.y) < 0.6 && disc.age > 0.2))
                ) {
                    disc.live = false;
                }
                disc.last = position;
                disc.settledFor = !disc.live && speed < 0.4 ? disc.settledFor + deltaTime : 0;
                // The golden disc never lies about: once its flight is over it flies back to its holder.
                // Ordinary discs come to rest and hand over to the room's list of discs lying on the floor.
                const done = disc.gold
                    ? !disc.live
                    : disc.settledFor > SETTLED_HANDOVER_SECONDS || disc.age > DISC_REMOVE_SECONDS || p.y < -5;
                if (done) {
                    onRest?.({
                        owner: disc.owner,
                        throwId: disc.throwId,
                        local: disc.local,
                        gold: disc.gold,
                        at: p.y < -5 ? null : position
                    });
                    remove(disc);
                }
            }
        },
        /** The golden disc's material, for discs its holder throws. */
        set goldMaterial(material: StandardMaterial) {
            goldMaterial = material;
        },
        /** The shared disc mesh. */
        mesh,
        /** Shared first-person/remote disc material, for the in-hand viewmodel. */
        meshInstances: (hue: number) => meshFor(hue),
        clear() {
            for (const disc of [...discs]) remove(disc);
        }
    };
};

export type Discs = ReturnType<typeof createDiscs>;
