import type { Entity } from 'playcanvas';

export const COLLISION_SOURCE_NODES = [
    'Floor_Slab',
    'Walls',
    'Glazing',
    'Arena_Court',
    'Arena_StandBase',
    ...Array.from({ length: 8 }, (_, index) => `Arena_Seats_Row${String(index).padStart(2, '0')}`)
];

export const addCampusCollisions = (campus: Entity) => {
    const missing: string[] = [];
    for (const name of COLLISION_SOURCE_NODES) {
        const entity = campus.findByName(name) as Entity | null;
        if (!entity?.render?.meshInstances.length) {
            missing.push(name);
            continue;
        }
        entity.addComponent('collision', {
            type: 'mesh',
            render: { meshes: entity.render.meshInstances.map((instance) => instance.mesh) }
        });
        entity.addComponent('rigidbody', { type: 'static', friction: 0.8, restitution: 0 });
    }
    if (missing.length) throw new Error(`Missing source geometry for campus collision: ${missing.join(', ')}`);
    return COLLISION_SOURCE_NODES.length;
};
