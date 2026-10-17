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

/**
 * South gate turnstiles and the waiting plaza outside them (owner brief 2026-10-17). The opening is the real gap in
 * the FF-01 south-lobby glazing (x −10.25…−6.25 at z ≈ 57.12); the plaza is the forecourt outside, fenced in.
 */
export const SOUTH_GATE = {
    x0: -10.25,
    x1: -6.25,
    /** The turnstile line (the glazing line). Inside is z < line. */
    line: 57.12,
    /** Cabinets across the opening (centres); lanes run between neighbours. */
    cabinets: [-10.15, -9.2, -8.25, -7.3, -6.35],
    /** How close (m) a player must come for the flaps to react. */
    approach: 1.8,
    /** Crossing this far past the line counts as through. */
    through: 0.45,
    plaza: { x0: -29.5, x1: 12.5, z0: 57.3, z1: 62.6 },
    /** Where a new player waits, facing the gate. */
    spawn: { x: -8.25, y: 0.92, z: 61 }
} as const;
