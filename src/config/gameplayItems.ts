/** Shared GAMEPLAY_AUTHORED item/NPC tuning. X/Z points are checked against room polygons and navAudit. */
export const ITEM_RULES = {
    pickupRadius: 1.5,
    interactionIntervalMs: 300,
    droppedReturnMs: 90_000,
    frcCooldownMs: 60_000,
    stealthDurationMs: 3_000,
    stealthCooldownMs: 60_000,
    creationRefillMs: 30_000,
    respawnProtectionMs: 1_500
} as const;

/** GAMEPLAY_AUTHORED: each player has one active skill slot; Michael's capacity talent is independent. */
export const NPC_COLOURS = { michael: 210, mark: 145 } as const;

export type ItemKind = 'revive' | 'frc' | 'eye' | 'stealth' | 'creation';
export type ItemSpawn = { id: string; kind: ItemKind; room: string; name: string; at: [number, number, number] };

// X/Z are interior walkable points in the imported world frame (room records already use X east, Z south).
export const ITEM_SPAWNS: readonly ItemSpawn[] = [
    { id: 'item-revive', kind: 'revive', room: 'M116', name: '复活甲', at: [-64.68, 0.2, -8.64] },
    { id: 'item-frc', kind: 'frc', room: 'M103', name: 'FRC 飞盘', at: [-44.24, 0.2, 25.54] },
    { id: 'item-eye', kind: 'eye', room: 'S103', name: '监控室之眼', at: [-42.92, 0.2, 10.58] },
    { id: 'item-stealth', kind: 'stealth', room: 'S100', name: '静止之力', at: [-8.39, 0.2, 23.48] },
    { id: 'item-creation', kind: 'creation', room: 'M100', name: '创造之力', at: [-38.69, 0.2, 51.76] }
];

export const NPC_SPAWNS = [
    { id: 'coach-michael', room: 'S308', name: 'Michael 教练', hue: NPC_COLOURS.michael, at: [18.03, 0.92, -12.29] as [number, number, number] },
    { id: 'mark', room: 'M100', name: 'Mark', hue: NPC_COLOURS.mark, at: [-35.59, 0.92, 51.76] as [number, number, number] }
] as const;
