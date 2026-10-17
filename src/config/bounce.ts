// GAMEPLAY_AUTHORED surface bounciness. Ammo multiplies the two bodies' restitution on contact, so a static surface
// at 0 stops every disc dead (the cause of "discs never bounce" before 2026-10-17). Players use restitution 0, so
// their contacts with these surfaces stay non-bouncy whatever the surface value.
export const SURFACE_RESTITUTION = {
    /** Walls, glazing, the arena perimeter wall and boundary barriers: crisp bank shots. */
    wall: 0.85,
    /** Floors, court and stands: discs skip rather than bounce high. */
    floor: 0.3,
    /** Tables, counters and authored room furniture. */
    furniture: 0.55
} as const;

/** The disc's own contact response (combined with the surface value above). */
export const DISC_CONTACT = { restitution: 0.78, friction: 0.18 } as const;

/** A reported bounce point higher than this (m) is a wall/furniture bounce, not the disc skidding on the floor. */
export const WALL_BOUNCE_MIN_Y = 0.35;
/** A hit after travelling at least this far (m, along the flight path) counts as a long shot. */
export const LONG_SHOT_METRES = 20;
