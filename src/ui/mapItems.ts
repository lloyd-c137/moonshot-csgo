import type { WorldItem } from '../net/protocol';

export type MapItemMarker = { id: string; short: string; name: string; x: number; z: number; colour: string };

/** Projects the latest authoritative pickup state, so a dropped skill is mapped at its current world position. */
export const worldItemMapMarkers = (items: readonly WorldItem[]): MapItemMarker[] =>
    items.filter((item) => item.available).map((item) => ({
        id: item.id,
        short:
            item.kind === 'revive' ? '甲' :
            item.kind === 'frc' ? 'F' :
            item.kind === 'eye' ? '眼' :
            item.kind === 'stealth' ? '假' :
            item.kind === 'creation' ? '创' : '筒',
        name: item.name,
        x: item.at[0],
        z: item.at[2],
        colour:
            item.kind === 'revive' ? '#ff9f9a' :
            item.kind === 'frc' ? '#ff5b4d' :
            item.kind === 'eye' ? '#65d8e8' :
            item.kind === 'stealth' ? '#b49aff' :
            item.kind === 'creation' ? '#b8d879' : '#ffe19a'
    }));
