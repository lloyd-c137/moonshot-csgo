// Applies the generated room naming layer (src/config/roomNaming.ts, from tools/roomNaming.ts) to the FF-01 rooms.
// Owner decision 2026-10-17: room names and division follow the 2026-08-06 drawing model; geometry, scale and walls
// stay FF-01. Pure: used by the browser and the node tests.
import type { CampusRoom, Point2 } from './roomIndex.ts';

export type RoomNamingData = {
    rooms: readonly {
        readonly id: string;
        readonly name: string;
        readonly kind: string;
        readonly kindLabel: string;
        readonly pieces: readonly string[];
        readonly polygon?: readonly (readonly [number, number])[];
    }[];
    readonly kept: readonly string[];
    readonly unnumbered: readonly { readonly piece: string; readonly name: string }[];
    readonly retired: readonly string[];
};

/**
 * Door signs are mounted per FF-01 region (`sign.room`); each shows the room that region now belongs to. A room made
 * of several regions keeps one sign, on its primary (largest) region when that region has one.
 */
export const chooseSigns = <S extends { room: string }>(signs: readonly S[], rooms: readonly CampusRoom[]) => {
    const bySource = new Map(rooms.map((room) => [room.sourceId ?? room.id, room]));
    const chosen = new Map<string, { sign: S; room: CampusRoom }>();
    for (const sign of signs) {
        const room = bySource.get(sign.room);
        if (!room) continue;
        const held = chosen.get(room.id);
        if (!held || (room.primary && !held.room.primary)) chosen.set(room.id, { sign, room });
    }
    return signs.flatMap((sign) => {
        const entry = [...chosen.values()].find((candidate) => candidate.sign === sign);
        return entry ? [entry] : [];
    });
};

/** Drawing numbers (M123, S308-1, A209…) are shown; app-internal ids (M-WC1, A-TEA…) are not. */
export const drawingCode = (id: string) => (/^[MSA]\d/.test(id) ? id : '');

/**
 * The effective room list. A room made of several FF-01 regions appears once per region (same id, name and kind;
 * `primary` on the largest). Rooms with no FF-01 region carry their fitted outline. FF-01 regions the newer model
 * does not cover keep their identity; superseded label-only spaces are dropped.
 */
export const applyRoomNaming = (ff01: readonly CampusRoom[], naming: RoomNamingData): CampusRoom[] => {
    const byId = new Map(ff01.map((room) => [room.id, room]));
    const out: CampusRoom[] = [];
    const used = new Set<string>();
    for (const room of naming.rooms) {
        const base = {
            id: room.id,
            name: room.name,
            nameEnglish: null,
            kind: room.kind,
            kindLabel: room.kindLabel,
            code: drawingCode(room.id)
        };
        if (room.pieces.length) {
            room.pieces.forEach((pieceId, index) => {
                const piece = byId.get(pieceId);
                if (!piece?.polygon) throw new Error(`Room naming piece ${pieceId} is not an FF-01 region`);
                used.add(pieceId);
                out.push({
                    ...base,
                    // The FF-01 English name still fits when number and Chinese name are unchanged.
                    nameEnglish: pieceId === room.id && piece.name === room.name ? piece.nameEnglish : null,
                    hasRegion: true,
                    geometryStatus: 'FF01_REGION_RENAMED_20260806',
                    polygon: piece.polygon,
                    sourceId: pieceId,
                    primary: index === 0
                });
            });
        } else if (room.polygon) {
            out.push({
                ...base,
                hasRegion: true,
                geometryStatus: 'FITTED_FROM_20260806_PLAN',
                polygon: { outer: room.polygon.map(([x, z]) => [x, z] as Point2), holes: [] },
                primary: true
            });
        }
    }
    for (const id of naming.kept) {
        const room = byId.get(id);
        if (!room) throw new Error(`Room naming keeps unknown FF-01 room ${id}`);
        used.add(id);
        out.push({ ...room, sourceId: id, primary: true });
    }
    for (const { piece } of naming.unnumbered) {
        const room = byId.get(piece);
        if (!room) throw new Error(`Room naming unnumbers unknown FF-01 room ${piece}`);
        used.add(piece);
        out.push({
            ...room,
            id: `FF01:${piece}`,
            name: '未编号房间',
            nameEnglish: null,
            kind: 'room',
            kindLabel: '其他房间',
            code: '',
            sourceId: piece,
            primary: true,
            geometryStatus: 'FF01_REGION_NOT_IN_20260806'
        });
    }
    // Label-only FF-01 spaces (entrances…) that the newer model does not supersede.
    for (const room of ff01)
        if (!room.hasRegion && !naming.retired.includes(room.id) && !used.has(room.id)) out.push({ ...room });
    return out;
};
