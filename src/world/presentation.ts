import type { Entity } from 'playcanvas';

import { WALL_SCALE_Y, WALL_SCALED_NODES } from '../config/presentation';

/**
 * Named import adapter (GAMEPLAY_AUTHORED): scales the source vertical structure about the floor so walls read at
 * WALL_HEIGHT instead of the source 2.8 m. Applied to entity transforms before colliders are built, so collision,
 * barriers and rendering agree; the GLB data itself is untouched. Offline tools apply `scaleWallVertex` identically.
 */
export const applyWallHeightAdapter = (campus: Entity) => {
    for (const name of WALL_SCALED_NODES) {
        const entity = campus.findByName(name) as Entity | null;
        if (!entity) throw new Error(`Wall height adapter: missing source node ${name}`);
        const scale = entity.getLocalScale();
        const position = entity.getLocalPosition();
        if (scale.x !== 1 || scale.y !== 1 || scale.z !== 1 || position.y !== 0) {
            throw new Error(`Wall height adapter expects an identity transform on ${name}`);
        }
        entity.setLocalScale(1, WALL_SCALE_Y, 1);
    }
};
