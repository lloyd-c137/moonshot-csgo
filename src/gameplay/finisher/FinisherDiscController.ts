import { Color, Entity, MeshInstance, Quat, StandardMaterial, Vec3 } from 'playcanvas';
import type { Mesh } from 'playcanvas';

import { TOSS, tossDisc } from './tossTimeline';

type ActorHand = { root: Entity; character: { root: Entity } };

/** Cinematic-only disc. It has no Ammo body and is fully positioned by the shared film timeline. */
export class FinisherDiscController {
    private readonly entity = new Entity('global-finisher-disc');
    private readonly material: StandardMaterial;
    private readonly rotation = new Quat();
    private destroyed = false;
    private readonly attacker: ActorHand;
    private readonly target: ActorHand;

    constructor(mesh: Mesh, attacker: ActorHand, target: ActorHand, gold: boolean) {
        this.attacker = attacker;
        this.target = target;
        this.material = new StandardMaterial();
        this.material.name = gold ? 'global-finisher-disc-gold' : 'global-finisher-disc';
        this.material.diffuse = new Color(...(gold ? [1, 0.72, 0.12] : [0.82, 0.88, 0.92]));
        this.material.useMetalness = true;
        this.material.metalness = gold ? 0.66 : 0.25;
        this.material.gloss = 0.7;
        // A faint glow so the disc reads against any background while it flies its pattern.
        this.material.emissive = new Color(...(gold ? [0.9, 0.55, 0.08] : [0.35, 0.6, 0.85]));
        this.material.emissiveIntensity = 0.6;
        this.material.update();
        this.entity.addComponent('render', { meshInstances: [new MeshInstance(mesh, this.material)] });
        this.entity.enabled = false;
    }

    attach(parent: Entity) {
        parent.addChild(this.entity);
    }

    /** Hand bones, looked up once per actor (a tree search every frame showed up as hitches). */
    private readonly hands = new Map<ActorHand, Entity | null>();

    /** Where the disc is now (for the trail). */
    get position() {
        return this.entity.getPosition();
    }

    private hand(actor: ActorHand) {
        if (!this.hands.has(actor)) this.hands.set(actor, actor.character.root.findByName('hand_r') as Entity | null);
        const hand = this.hands.get(actor);
        return (
            hand?.getPosition().clone() ??
            actor.root
                .getPosition()
                .clone()
                .add(new Vec3(0, 1.35, 0))
        );
    }

    /** Hand positions captured at the toss and throw releases (the arcs start exactly where the disc left). */
    private releaseHand: Vec3 | null = null;
    private throwHand: Vec3 | null = null;

    /** `progress` is the film position 0…1 (TOSS timeline, tossTimeline.ts). */
    update(progress: number) {
        if (this.destroyed) return;
        this.entity.enabled = true;
        const frame = Math.max(0, Math.min(1, progress)) * TOSS.frames;
        const hand = this.hand(this.attacker);
        if (frame < TOSS.tossRelease || !this.releaseHand) this.releaseHand = hand.clone();
        if (frame < TOSS.throwRelease || !this.throwHand) this.throwHand = hand.clone();
        const victim = this.target.root.getPosition();
        const attacker = this.attacker.root.getPosition();
        const forward = new Vec3(victim.x - attacker.x, 0, victim.z - attacker.z).normalize();
        const v = (p: Vec3): [number, number, number] => [p.x, p.y, p.z];
        const { at, spin } = tossDisc(frame, v(hand), v(this.releaseHand), v(this.throwHand), v(victim), [
            forward.x,
            0,
            forward.z
        ]);
        this.entity.setPosition(at[0], at[1], at[2]);
        const heading = (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
        if (spin === 'flip') {
            // End over end through the toss: three turns about the walker's right-hand axis.
            const u = (frame - TOSS.tossRelease) / (TOSS.tossCatch - TOSS.tossRelease);
            this.rotation.setFromEulerAngles(u * 1080, heading, 0);
        } else if (spin === 'flat') {
            // Thrown: spinning fast and flat, banked into its loop.
            this.rotation.setFromEulerAngles(12 * Math.sin(frame * 0.35), frame * 47, 16 * Math.cos(frame * 0.2));
        } else this.rotation.setFromEulerAngles(78, heading, 0);
        this.entity.setRotation(this.rotation);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.entity.destroy();
        this.material.destroy();
    }
}
