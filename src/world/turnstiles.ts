// South lobby pillar-line turnstiles and the waiting plaza: five stainless cabinets span the interior passage,
// glass flaps swing open for an approaching player, and indicators show red / green. Logic is in gameplay/gateLobby.ts.
import type { AppBase, Entity as EntityType, StandardMaterial as StandardMaterialType } from 'playcanvas';
import { BLEND_NORMAL, Color, Entity, StandardMaterial } from 'playcanvas';

import { SURFACE_RESTITUTION } from '../config/bounce';
import { SOUTH_GATE } from '../config/gameplay';
import type { GateLight } from '../gameplay/gateLobby';

const material = (
    colour: [number, number, number],
    options: { gloss?: number; emissive?: [number, number, number]; opacity?: number } = {}
) => {
    const m = new StandardMaterial();
    m.useMetalness = true;
    m.metalness = options.opacity ? 0 : 0.6;
    m.gloss = options.gloss ?? 0.6;
    m.diffuse = new Color(...colour);
    if (options.emissive) {
        m.emissive = new Color(...options.emissive);
        m.emissiveIntensity = 2;
    }
    if (options.opacity !== undefined) {
        m.opacity = options.opacity;
        m.blendType = BLEND_NORMAL;
        m.depthWrite = false;
    }
    m.update();
    return m;
};

const box = (
    parent: EntityType,
    name: string,
    m: StandardMaterialType,
    at: [number, number, number],
    size: [number, number, number]
) => {
    const entity = new Entity(name);
    entity.addComponent('render', { type: 'box', material: m, castShadows: false });
    entity.setLocalPosition(...at);
    entity.setLocalScale(...size);
    parent.addChild(entity);
    return entity;
};

const solid = (parent: EntityType, name: string, at: [number, number, number], size: [number, number, number]) => {
    const entity = new Entity(name);
    entity.addComponent('collision', { type: 'box', halfExtents: [size[0] / 2, size[1] / 2, size[2] / 2] });
    entity.addComponent('rigidbody', { type: 'static', friction: 0.5, restitution: SURFACE_RESTITUTION.wall });
    entity.setLocalPosition(...at);
    parent.addChild(entity);
    return entity;
};

export const buildTurnstiles = (app: AppBase, parent: EntityType) => {
    const root = new Entity('South_Gate_Turnstiles');
    parent.addChild(root);
    const { cabinets, line, plaza } = SOUTH_GATE;
    const steel = material([0.72, 0.74, 0.76], { gloss: 0.75 });
    const top = material([0.16, 0.18, 0.2], { gloss: 0.5 });
    const glass = material([0.75, 0.88, 0.95], { gloss: 0.95, opacity: 0.38 });
    const red = material([0.2, 0.02, 0.02], { emissive: [1, 0.08, 0.06] });
    const green = material([0.02, 0.2, 0.05], { emissive: [0.1, 1, 0.3] });
    const off = material([0.2, 0.05, 0.05], { emissive: [0.25, 0.02, 0.02] });

    // Cabinets: waist-high stainless boxes, 1.4 m deep, a dark top with the indicator strip.
    const lights: EntityType[] = [];
    for (const x of cabinets) {
        box(root, 'Turnstile_Cabinet', steel, [x, 0.5, line], [0.2, 1, 1.4]);
        box(root, 'Turnstile_Top', top, [x, 1.01, line], [0.22, 0.03, 1.42]);
        lights.push(box(root, 'Turnstile_Light', red, [x, 1.04, line - 0.55], [0.16, 0.03, 0.16]));
        lights.push(box(root, 'Turnstile_Light', red, [x, 1.04, line + 0.55], [0.16, 0.03, 0.16]));
        solid(root, 'Turnstile_Cabinet_Collider', [x, 0.6, line], [0.2, 1.2, 1.4]);
    }
    // Flaps: two glass leaves per lane, hinged on the cabinets; closed they meet mid-lane, open they swing inward.
    const flaps: { pivot: EntityType; side: number }[] = [];
    const laneBlocks: EntityType[] = [];
    for (let i = 0; i < cabinets.length - 1; i++) {
        const left = cabinets[i] + 0.1,
            right = cabinets[i + 1] - 0.1;
        const width = right - left;
        for (const [hinge, side] of [
            [left, 1],
            [right, -1]
        ] as const) {
            const pivot = new Entity('Turnstile_Flap_Pivot');
            pivot.setLocalPosition(hinge, 0, line);
            root.addChild(pivot);
            box(pivot, 'Turnstile_Flap', glass, [(side * width) / 4, 0.75, 0], [width / 2 - 0.02, 0.7, 0.03]);
            flaps.push({ pivot, side });
        }
        laneBlocks.push(solid(root, 'Turnstile_Lane_Collider', [(left + right) / 2, 0.6, line], [width, 1.2, 0.12]));
    }

    // The waiting plaza: a floor over the forecourt and an invisible fence round it (the low gate fence and the
    // building's glazing are its visible edges).
    const { x0, x1, z0, z1 } = plaza;
    solid(root, 'Plaza_Floor', [(x0 + x1) / 2, -0.25, (z0 + z1) / 2 - 0.4], [x1 - x0 + 1, 0.5, z1 - z0 + 1.2]);
    solid(root, 'Plaza_Fence_West', [x0 - 0.15, 3, (z0 + z1) / 2], [0.3, 6, z1 - z0 + 1]);
    solid(root, 'Plaza_Fence_East', [x1 + 0.15, 3, (z0 + z1) / 2], [0.3, 6, z1 - z0 + 1]);
    solid(root, 'Plaza_Fence_South', [(x0 + x1) / 2, 3, z1 + 0.15], [x1 - x0 + 1, 6, 0.3]);

    let opening = 0;
    let open = false;
    let light: GateLight = 'red';
    let blink = 0;
    app.on('update', (dt: number) => {
        // Flaps swing 90° in about a third of a second.
        opening = Math.max(0, Math.min(1, opening + (open ? dt : -dt) * 3.2));
        const angle = 90 * opening * opening * (3 - 2 * opening);
        for (const { pivot, side } of flaps) pivot.setLocalEulerAngles(0, side * angle, 0);
        blink += dt;
        const lit = light === 'green' ? green : light === 'denied' ? (Math.floor(blink * 6) % 2 ? red : off) : red;
        for (const entity of lights)
            if (entity.render!.meshInstances[0].material !== lit) entity.render!.meshInstances[0].material = lit;
    });

    return {
        /** Applies one gate step: flaps open/closed (their colliders follow at once) and the indicator colour. */
        set(nextOpen: boolean, nextLight: GateLight) {
            if (nextOpen !== open) for (const block of laneBlocks) block.enabled = !nextOpen;
            open = nextOpen;
            if (nextLight !== light) blink = 0;
            light = nextLight;
        }
    };
};
