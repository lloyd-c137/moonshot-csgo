import type { AppBase, GraphNode } from 'playcanvas';
import { Entity, Mesh, Vec3 } from 'playcanvas';

import { SURFACE_RESTITUTION } from '../config/bounce';
import { BARRIER_TOP_Y } from '../config/gameplay';
import type { ColliderMesh } from '../world/arenaAccess';
import {
    bowlCollider,
    standBlocks,
    standBlocksCollider,
    standStair,
    standStairCollider,
    tierRadiusAt,
    underBowl
} from '../world/arenaAccess';
import type { Point2 } from '../world/stadiumLayout';
import { STADIUM, intersectRadius, ringRadii  } from '../world/stadiumLayout';


import type { Triangle, Vec3Tuple } from './boundaryBarriers';
import { barrierMeshData, campusBarrierWalls, clipUnderBowl, southGateBarriers } from './boundaryBarriers';

/**
 * Source nodes that collide as triangle meshes. The court-level seat rows (Arena_Seats_Row00–07) do not: their
 * pedestals left 0.33 m gaps that trapped the capsule, so they collide as solid stepped rows (world/arenaAccess).
 */
export const COLLISION_SOURCE_NODES = ['Floor_Slab', 'Walls', 'Glazing', 'Arena_Court', 'Arena_StandBase'];

export const ARENA_ACCESS_ENTITY_NAME = 'GameplayAuthored_ArenaAccess';
type Arena = { outline: readonly Point2[]; center: Point2 };

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
const addBarriers = (app: AppBase, campus: Entity, arena: Arena) => {
    const radii = ringRadii(arena.outline, arena.center);
    // Preserve the source outer entrance, then create the new turnstile boundary at the pillar line.
    const walls = southGateBarriers(
        campusBarrierWalls(
            {
                floor: worldTriangles(renderEntity(campus, 'Floor_Slab')),
                wallTops: worldTriangles(renderEntity(campus, 'Walls_Top')),
                glazing: worldTriangles(renderEntity(campus, 'Glazing'))
            },
            BARRIER_TOP_Y
        )
    );
    const clipped = clipUnderBowl(walls, (x, z) => underBowl(radii, arena.center, x, z), STADIUM.fasciaTop - 0.05);
    walls.length = 0;
    walls.push(...clipped);
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

const staticMesh = (app: AppBase, name: string, data: ColliderMesh) => {
    const mesh = new Mesh(app.graphicsDevice);
    mesh.setPositions(data.positions);
    mesh.setIndices(data.indices);
    mesh.update();
    const entity = new Entity(name);
    entity.addComponent('collision', { type: 'mesh', render: { meshes: [mesh] } });
    entity.addComponent('rigidbody', { type: 'static', friction: 0.8, restitution: SURFACE_RESTITUTION.floor });
    return entity;
};

const merge = (parts: readonly ColliderMesh[]): ColliderMesh => {
    const out: ColliderMesh = { positions: [], indices: [] };
    for (const part of parts) {
        const base = out.positions.length / 3;
        out.positions.push(...part.positions);
        out.indices.push(...part.indices.map((index) => index + base));
    }
    return out;
};

/** Solid court-level stand rows, their two central stairs, and the upper bowl, as one static collider. */
const addArenaAccess = (app: AppBase, campus: Entity, arena: Arena) => {
    const radii = ringRadii(arena.outline, arena.center);
    const [cx] = arena.center;
    const parts: ColliderMesh[] = [bowlCollider(radii, arena.center)];
    for (const [side, angle] of [
        ['west', Math.PI],
        ['east', 0]
    ] as const) {
        const wall = intersectRadius(arena.outline, arena.center, angle);
        const dir = side === 'west' ? -1 : 1;
        parts.push(standBlocksCollider(standBlocks(side, cx + dir * wall)));
        parts.push(standStairCollider(standStair(side, arena.center, wall, tierRadiusAt(radii, angle, 0))));
    }
    campus.addChild(staticMesh(app, ARENA_ACCESS_ENTITY_NAME, merge(parts)));
};

export const addCampusCollisions = (app: AppBase, campus: Entity, arena: Arena) => {
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
    addArenaAccess(app, campus, arena);
    const barrierWalls = addBarriers(app, campus, arena);
    return { sourceBodies: COLLISION_SOURCE_NODES.length + 1, barrierWalls };
};
