// Presentation adapter and derived-world parameters. Every value here is GAMEPLAY_AUTHORED: a visual/game decision
// layered on the SOURCE_DERIVED_3D_UNVERIFIED model. Source files are never modified; the adapter is applied to
// entity transforms at load time and, identically, to geometry in the offline tools.

/** Source wall height in the GLB (illustrative, not surveyed). */
export const SOURCE_WALL_HEIGHT = 2.8;

/** Presented wall/ceiling height. The source 2.8 m read as cramped at first-person eye height. */
export const WALL_HEIGHT = 3.6;

/** Vertical scale applied to the vertical structure (walls, wall tops, glazing) about the floor (Y = 0). */
export const WALL_SCALE_Y = WALL_HEIGHT / SOURCE_WALL_HEIGHT;

/** Source nodes the vertical scale applies to. Floor, rooms, arena and linework keep their source transforms. */
export const WALL_SCALED_NODES = ['Walls', 'Walls_Top', 'Glazing'] as const;

/** Ceiling height everywhere indoors (not over the open-air arena or courtyards), flush with the wall tops. */
export const CEILING_HEIGHT = WALL_HEIGHT;

/**
 * The arena (court + stands) is open-air: the ceiling is cut away over it and the sky shows above the walls.
 * The arena region is flood-filled from the court centre between walls and room polygons. Its north/south
 * corridors open into the ring corridor, so the fill is clipped to this radius (m) around the court centre.
 */
export const ARENA_CLIP_RADIUS = 26;

/**
 * The open-air arena is enclosed by a tall perimeter wall built along the derived arena outline, from the ceiling
 * height up to this level (the source walls stop at the presented wall height).
 */
export const ARENA_WALL_HEIGHT = 10;

/** Door lintel underside and door leaf height. */
export const DOOR_HEIGHT = 2.15;

/** Conservative jump apex above the take-off surface (jumpForce 500 N·s, 80 kg, g = 18 m/s² gives ≈1.08 m). */
export const JUMP_APEX = 1.0;

/** Raster used for derived masks (ceiling, minimap): metres per pixel and the world origin of pixel (0, 0). */
export const DERIVED_GRID = { x0: -69, z0: -62, width: 140, depth: 122, resolution: 0.1 } as const;

export const DERIVED_WORLD_URL = '/assets/campus/derived/world.json';
export const CEILING_MASK_URL = '/assets/campus/derived/ceiling-mask.png';
export const MINIMAP_URL = '/assets/campus/derived/minimap.png';
export const MINIMAP_RESOLUTION = 0.2;

/** Applies the presentation scale to a source vertex of a wall-scaled node. */
export const scaleWallVertex = ([x, y, z]: [number, number, number]): [number, number, number] => [
    x,
    y * WALL_SCALE_Y,
    z
];
