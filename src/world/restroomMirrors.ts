import { pointInRoom } from './roomIndex.ts';
import type { CampusRoom } from './roomIndex.ts';

export type RestroomMirrorLayout = {
    roomId: string;
    position: [number, number, number];
    yaw: number;
    normal: [number, number, number];
    width: number;
    height: number;
};

/** GAMEPLAY_AUTHORED mounting candidates, derived from each polygonal restroom region's bounds. */
export const restroomMirrorLayouts = (rooms: CampusRoom[]): RestroomMirrorLayout[] =>
    rooms
        .filter((room) => room.kind === 'restroom' && room.hasRegion && (room.polygon?.outer.length ?? 0) >= 3)
        .flatMap((room) => {
            const points = room.polygon!.outer;
            const candidates = points.flatMap(([ax, az], index) => {
                const [bx, bz] = points[(index + 1) % points.length];
                const dx = bx - ax;
                const dz = bz - az;
                const length = Math.hypot(dx, dz);
                if (length < 1) return [];
                const mx = (ax + bx) / 2;
                const mz = (az + bz) / 2;
                const perpendicular: [number, number] = [-dz / length, dx / length];
                const normal = [perpendicular[0], perpendicular[1]] as [number, number];
                if (!pointInRoom([mx + normal[0] * 0.14, mz + normal[1] * 0.14], room)) {
                    normal[0] *= -1;
                    normal[1] *= -1;
                }
                const x = mx + normal[0] * 0.14;
                const z = mz + normal[1] * 0.14;
                if (!pointInRoom([x, z], room)) return [];
                const yaw = Math.atan2(-normal[0], normal[1]);
                return [
                    {
                        length,
                        position: [x, 0.22, z] as [number, number, number],
                        normal: [normal[0], 0, normal[1]] as [number, number, number],
                        yaw
                    }
                ];
            });
            candidates.sort((a, b) => b.length - a.length);
            const selected = candidates[0];
            if (!selected) return [];
            return [
                {
                    roomId: room.id,
                    position: selected.position,
                    yaw: selected.yaw,
                    normal: selected.normal,
                    width: Math.min(0.82, selected.length * 0.68),
                    height: 1.78
                }
            ];
        });
