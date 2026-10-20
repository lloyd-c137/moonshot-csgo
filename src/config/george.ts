/**
 * GAMEPLAY_AUTHORED M103 interaction point, placed inside the source-derived M103 polygon near the existing FRC
 * pickup at [-44.24, 25.54]. This is a gameplay anchor, not a surveyed server-room coordinate.
 */
export const GEORGE_SERVER_ROOM = {
    x: -42.2,
    z: 25.54
} as const;

export const GEORGE_TERMINAL = {
    room: 'M103',
    // In front of the GAMEPLAY_AUTHORED console, outside its collision boxes.
    x: -40.9,
    y: 0.92,
    z: 25.54,
    radius: 2.4,
    rebootMs: 10_000,
    disarmMs: 2_000
} as const;
