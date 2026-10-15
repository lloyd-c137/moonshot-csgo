export type Point2 = [number, number];
export type RoomRegion = { outer: Point2[]; holes?: Point2[][] };
export type CampusRoom = {
    id: string;
    name: string;
    nameEnglish: string | null;
    kind: string;
    kindLabel: string;
    hasRegion: boolean;
    geometryStatus: string;
    polygon?: RoomRegion;
};
export type CampusRooms = {
    model: string;
    status: string;
    frame: { units: string; axes: { x: string; y: string; z: string } };
    rooms: CampusRoom[];
};

const readRing = (value: unknown, label: string): Point2[] => {
    if (!Array.isArray(value) || value.length < 3) throw new Error(`${label} must contain at least three points`);
    return value.map((point, index) => {
        if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
            throw new Error(`${label}[${index}] must be a finite [x, z] point`);
        }
        return [point[0], point[1]];
    });
};

export const parseCampusRooms = (value: unknown): CampusRooms => {
    if (!value || typeof value !== 'object') throw new Error('rooms.json must be an object');
    const file = value as Record<string, unknown>;
    if (file.model !== 'FF01-CAMPUS-3D-V1' || file.status !== 'SOURCE_DERIVED_3D_UNVERIFIED') {
        throw new Error('rooms.json model identity or source status is invalid');
    }
    const frame = file.frame as CampusRooms['frame'] | undefined;
    if (frame?.units !== 'm' || frame.axes?.x !== 'east' || frame.axes?.y !== 'up' || frame.axes?.z !== 'south') {
        throw new Error('rooms.json coordinate frame is invalid');
    }
    if (!Array.isArray(file.rooms)) throw new Error('rooms.json rooms must be an array');

    const ids = new Set<string>();
    const rooms = file.rooms.map((record, index): CampusRoom => {
        if (!record || typeof record !== 'object') throw new Error(`rooms[${index}] must be an object`);
        const source = record as Record<string, unknown>;
        if (typeof source.id !== 'string' || !source.id || ids.has(source.id)) {
            throw new Error(`rooms[${index}] has a missing or duplicate id`);
        }
        ids.add(source.id);
        if (
            typeof source.name !== 'string' ||
            typeof source.kind !== 'string' ||
            typeof source.hasRegion !== 'boolean'
        ) {
            throw new Error(`rooms[${index}] is missing display or region fields`);
        }
        if (!source.hasRegion) {
            if ('polygon' in source) throw new Error(`${source.id} is label-only but has a polygon`);
            return {
                id: source.id,
                name: source.name,
                nameEnglish: typeof source.nameEnglish === 'string' ? source.nameEnglish : null,
                kind: source.kind,
                kindLabel: typeof source.kindLabel === 'string' ? source.kindLabel : '',
                hasRegion: false,
                geometryStatus: String(source.geometryStatus ?? 'NO_POLYGON_LABEL_ONLY')
            };
        }
        const polygon = source.polygon as Record<string, unknown> | undefined;
        if (!polygon) throw new Error(`${source.id} is marked regional but has no polygon`);
        const outer = readRing(polygon.outer, `${source.id}.polygon.outer`);
        const holes =
            polygon.holes === undefined
                ? []
                : (polygon.holes as unknown[]).map((ring, hole) =>
                      readRing(ring, `${source.id}.polygon.holes[${hole}]`)
                  );
        return {
            id: source.id,
            name: source.name,
            nameEnglish: typeof source.nameEnglish === 'string' ? source.nameEnglish : null,
            kind: source.kind,
            kindLabel: typeof source.kindLabel === 'string' ? source.kindLabel : '',
            hasRegion: true,
            geometryStatus: String(source.geometryStatus ?? 'SOURCE_UNVERIFIED'),
            polygon: { outer, holes }
        };
    });
    return { model: file.model, status: file.status, frame, rooms };
};

const ringRelation = (point: Point2, ring: Point2[], epsilon: number) => {
    let inside = false;
    const [x, z] = point;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j];
        const [bx, bz] = ring[i];
        const dx = bx - ax;
        const dz = bz - az;
        const lengthSquared = dx * dx + dz * dz;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
        if (Math.hypot(x - (ax + t * dx), z - (az + t * dz)) <= epsilon) return 'boundary';
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside ? 'inside' : 'outside';
};

export const pointInRoom = (point: Point2, room: CampusRoom, epsilon = 1e-5) => {
    const polygon = room.polygon;
    if (!room.hasRegion || !polygon) return false;
    const outer = ringRelation(point, polygon.outer, epsilon);
    if (outer === 'outside') return false;
    return !(polygon.holes ?? []).some((hole) => ringRelation(point, hole, epsilon) !== 'outside');
};

const polygonArea = (ring: Point2[]) =>
    Math.abs(
        ring.reduce((area, [x, z], index) => {
            const [nextX, nextZ] = ring[(index + 1) % ring.length];
            return area + x * nextZ - nextX * z;
        }, 0) / 2
    );

export const findRoomAt = (point: Point2, rooms: CampusRoom[]) =>
    rooms
        .filter((room) => pointInRoom(point, room))
        .sort((a, b) => polygonArea(a.polygon!.outer) - polygonArea(b.polygon!.outer) || a.id.localeCompare(b.id))[0];

const nearOuterBoundary = (point: Point2, room: CampusRoom, margin: number) => {
    const polygon = room.polygon;
    if (!polygon || (polygon.holes ?? []).some((hole) => ringRelation(point, hole, 1e-5) !== 'outside')) return false;
    const [x, z] = point;
    return polygon.outer.some(([ax, az], index) => {
        const [bx, bz] = polygon.outer[(index + 1) % polygon.outer.length];
        const dx = bx - ax;
        const dz = bz - az;
        const lengthSquared = dx * dx + dz * dz;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared)) : 0;
        return Math.hypot(x - (ax + t * dx), z - (az + t * dz)) <= margin;
    });
};

export class RoomTracker {
    current: CampusRoom | undefined;
    private candidate: CampusRoom | undefined;
    private candidateKey = '';
    private candidateDuration = 0;
    private sampleTime = 0;
    private readonly rooms: CampusRoom[];
    private readonly onChange: (room: CampusRoom | undefined) => void;
    private readonly hysteresis: number;
    private readonly dwell: number;

    constructor(rooms: CampusRoom[], onChange: (room: CampusRoom | undefined) => void, hysteresis = 0.35, dwell = 0.2) {
        this.rooms = rooms;
        this.onChange = onChange;
        this.hysteresis = hysteresis;
        this.dwell = dwell;
    }

    update(point: Point2, deltaSeconds: number) {
        this.sampleTime += deltaSeconds;
        if (this.sampleTime < 0.15) return;
        const dt = this.sampleTime;
        this.sampleTime = 0;
        let next = findRoomAt(point, this.rooms);
        if (
            this.current &&
            (pointInRoom(point, this.current) || nearOuterBoundary(point, this.current, this.hysteresis))
        ) {
            next = this.current;
        }
        const key = next?.id ?? '';
        if (key === this.current?.id || (!this.current && !next)) {
            this.candidate = undefined;
            this.candidateKey = '';
            this.candidateDuration = 0;
            return;
        }
        if (key !== this.candidateKey) {
            this.candidate = next;
            this.candidateKey = key;
            this.candidateDuration = 0;
        } else {
            this.candidateDuration += dt;
        }
        if (this.candidateDuration >= this.dwell) {
            this.current = this.candidate;
            this.candidate = undefined;
            this.candidateKey = '';
            this.candidateDuration = 0;
            this.onChange(this.current);
        }
    }
}
