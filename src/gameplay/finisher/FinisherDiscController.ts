import { Color, Entity, MeshInstance, Quat, StandardMaterial, Vec3 } from 'playcanvas';
import type { Mesh } from 'playcanvas';

type ActorHand = { root: Entity; character: { root: Entity } };

const smooth = (t: number) => {
    const u = Math.max(0, Math.min(1, t));
    return u * u * (3 - 2 * u);
};

const cubic = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number) => {
    const u = 1 - t;
    return a
        .clone()
        .mulScalar(u * u * u)
        .add(b.clone().mulScalar(3 * u * u * t))
        .add(c.clone().mulScalar(3 * u * t * t))
        .add(d.clone().mulScalar(t * t * t));
};

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
        this.material.update();
        this.entity.addComponent('render', { meshInstances: [new MeshInstance(mesh, this.material)] });
        this.entity.enabled = false;
    }

    attach(parent: Entity) {
        parent.addChild(this.entity);
    }

    private hand(actor: ActorHand) {
        const hand = actor.character.root.findByName('hand_r');
        return (
            hand?.getPosition().clone() ??
            actor.root
                .getPosition()
                .clone()
                .add(new Vec3(0, 1.35, 0))
        );
    }

    update(progress: number) {
        if (this.destroyed) return;
        this.entity.enabled = true;
        const t = Math.max(0, Math.min(1, progress));
        const fromHand = this.hand(this.attacker);
        const toHand = this.hand(this.target);
        const targetRoot = this.target.root.getPosition();
        const attackerRoot = this.attacker.root.getPosition();
        const towardAttacker = new Vec3(attackerRoot.x - targetRoot.x, 0, attackerRoot.z - targetRoot.z).normalize();
        const startOrbit = targetRoot
            .clone()
            .add(towardAttacker.clone().mulScalar(0.76))
            .add(new Vec3(0, 1.68, 0));
        const orbitEnd = startOrbit.clone();
        const orbitMid = targetRoot.clone().add(new Vec3(0, 1.95, 0));
        const strikePoint = targetRoot.clone().add(new Vec3(0, 1.3, 0));
        let position: Vec3;

        if (t < 0.17) {
            const u = smooth(t / 0.17);
            position = cubic(
                fromHand,
                fromHand.clone().add(new Vec3(0, 0.7, 0)),
                startOrbit.clone().add(new Vec3(0, 0.58, 0)),
                startOrbit,
                u
            );
        } else if (t < 0.44) {
            const u = (t - 0.17) / 0.27;
            const angle = u * Math.PI * 2;
            const radial = towardAttacker
                .clone()
                .mulScalar(Math.cos(angle) * 0.76)
                .add(new Vec3(-towardAttacker.z, 0, towardAttacker.x).mulScalar(Math.sin(angle) * 0.76));
            position = targetRoot
                .clone()
                .add(radial)
                .add(new Vec3(0, 1.68 + Math.sin(angle * 2) * 0.22, 0));
        } else if (t < 0.635) {
            const u = smooth((t - 0.44) / 0.195);
            position = cubic(orbitEnd, orbitMid, fromHand.clone().add(new Vec3(0, 0.36, 0)), fromHand, u);
        } else if (t < 0.83) {
            const u = smooth((t - 0.635) / 0.195);
            position = cubic(
                fromHand,
                fromHand.clone().add(new Vec3(0.9, 0.38, 0)),
                strikePoint.clone().add(new Vec3(-0.35, 0.32, 0)),
                strikePoint,
                u
            );
        } else {
            const u = smooth((t - 0.83) / 0.17);
            position = cubic(
                strikePoint,
                strikePoint.clone().add(new Vec3(0, 0.7, 0)),
                toHand.clone().add(new Vec3(0, 0.32, 0)),
                fromHand,
                u
            );
        }

        const spin = t * 3600;
        this.rotation.setFromEulerAngles(78 + Math.sin(t * 16) * 12, spin, Math.sin(t * 11) * 18);
        this.entity.setPosition(position);
        this.entity.setRotation(this.rotation);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.entity.destroy();
        this.material.destroy();
    }
}
