// Gameplay tuning and authored overrides. Every value here is GAMEPLAY_AUTHORED: it is a game decision layered on
// top of the SOURCE_DERIVED_3D_UNVERIFIED campus model, never a measured property of the real building.

/** Safe spawn, at the source label anchor of the south entrance lobby (capsule centre height), facing north. */
export const SAFE_SPAWN = { x: -8.7, y: 0.92, z: 46.3 };

/** The previous spawn, the east entrance lobby anchor (kept for routes and tests that start there). */
export const EAST_ENTRANCE = { x: 50.85, y: 0.92, z: -2.86 };

export const PLAYER = {
    /**
     * Capsule radius. 0.34 m could not pass 14 source door gaps narrower than 0.68 m (see docs/COLLISION_AUDIT.md);
     * 0.28 m keeps a person-sized footprint while clearing every gap of at least 0.56 m.
     */
    radius: 0.28,
    height: 1.8,
    eyeOffset: 0.66,
    mass: 80,
    gravity: -18
} as const;

/** Below this capsule-centre height the player is out of the world and is returned to the safe spawn. */
export const FALL_RECOVERY_Y = -3;

/**
 * Invisible barrier ceiling. Barriers extrude the floor-slab outline from the floor and the wall/glazing tops from
 * their source height up to this level, so neither open entrances nor jumps from the 3.11 m top seat row lead out of the level.
 */
export const BARRIER_TOP_Y = 7;

/**
 * Circular triggers for the six label-only spaces, centred on their source label anchors. The radius is authored;
 * these spaces have no source polygon and the trigger only applies where no source polygon contains the player.
 */
export const LABEL_ONLY_TRIGGER_RADIUS = 4;
