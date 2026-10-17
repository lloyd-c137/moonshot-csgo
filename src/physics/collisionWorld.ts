import type { AppBase, GraphNode } from 'playcanvas';
import { Entity, Mesh, Vec3 } from 'playcanvas';

import { SURFACE_RESTITUTION } from '../config/bounce';
import { BARRIER_TOP_Y } from '../config/gameplay';

import type { Triangle, Vec3Tuple } from './boundaryBarriers';
import { barrierMeshData, campusBarrierWalls } from './boundaryBarriers';

export const COLLISION_SOURCE_NODES = [
    'Floor_Slab',
    'Walls',
    'Glazing',
    'Arena_Court',
    'Arena_StandBase',
    ...Array.from({ length: 8 }, (_, index) => `Arena_Seats_Row${String(index).padStart(2, '0')}`)
];

export const BARRIER_ENTITY_NAME = 'GameplayAuthored_Barriers';

const renderEntity = (campus: Entity, name: string) => {
    const entity = campus.findByName(name) as Entity | null;
    if (!entity?.render?.meshInstances.length) throw new Error(`Missing source geometry for campus collision: ${name}`);
    return entity;
};

/** World-space triangles of a source render entity, read from its GPU mesh without modifying it. */
export const worldTriangles = (entity: Entity): Triangle[] => {
    const triangles: Triangle[] = [];
    const local = new Vec3();
    const world = new Vec3();
    for (const instance of entity.render!.meshInstances) {
        const mesh = instance.mesh;
        if (!mesh) continue;
        const positions: number[] = [];
        const indices: number[] = [];
        mesh.getPositions(positions);
        mesh.getIndices(indices);
        const transform = (instance.node as GraphNode).getWorldTransform();
        const vertex = (index: number): Vec3Tuple => {
            local.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
            transform.transformPoint(local, world);
            return [world.x, world.y, world.z];
        };
        const order = indices.length ? indices : Array.from({ length: positions.length / 3 }, (_, index) => index);
        for (let index = 0; index + 2 < order.length; index += 3) {
            triangles.push([vertex(order[index]), vertex(order[index + 1]), vertex(order[index + 2])]);
        }
    }
    return triangles;
};

/**
 * GAMEPLAY_AUTHORED invisible barriers derived from (not replacing) source geometry: the floor-slab outline and the
 * wall/glazing top outlines are extruded to BARRIER_TOP_Y as one static, unrendered triangle-mesh collider.
 */
const addBarriers = (app: AppBase, campus: Entity) => {
    const walls = campusBarrierWalls(
        {
            floor: worldTriangles(renderEntity(campus, 'Floor_Slab')),
            wallTops: worldTriangles(renderEntity(campus, 'Walls_Top')),
            glazing: worldTriangles(renderEntity(campus, 'Glazing'))
        },
        BARRIER_TOP_Y
    );
    if (!walls.length) throw new Error('Barrier generation produced no walls');
    const { positions, indices } = barrierMeshData(walls);
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setIndices(indices);
    mesh.update();
    const barrier = new Entity(BARRIER_ENTITY_NAME);
    barrier.addComponent('collision', { type: 'mesh', render: { meshes: [mesh] } });
    barrier.addComponent('rigidbody', { type: 'static', friction: 0, restitution: SURFACE_RESTITUTION.wall });
    campus.addChild(barrier);
    return walls.length;
};

export const addCampusCollisions = (app: AppBase, campus: Entity) => {
    for (const name of COLLISION_SOURCE_NODES) {
        const entity = renderEntity(campus, name);
        entity.addComponent('collision', {
            type: 'mesh',
            render: { meshes: entity.render!.meshInstances.map((instance) => instance.mesh) }
        });
        entity.addComponent('rigidbody', {
            type: 'static',
            friction: 0.8,
            restitution: name === 'Walls' || name === 'Glazing' ? SURFACE_RESTITUTION.wall : SURFACE_RESTITUTION.floor
        });
    }
    const barrierWalls = addBarriers(app, campus);
    return { sourceBodies: COLLISION_SOURCE_NODES.length, barrierWalls };
};
