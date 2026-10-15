// Usage: npm run audit:nav [-- --radius 0.28 --no-barriers --png nav.png]
// Prints the floor/stand audit summary and optionally writes a top-down PNG of the reachability map.
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

import { PLAYER } from '../src/config/gameplay.ts';

import { auditFloor, auditTopSeats, CELL, loadCampusGeometry } from './navAudit.ts';

const args = process.argv.slice(2);
const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const radius = Number(option('--radius') ?? PLAYER.radius);
const barriers = !args.includes('--no-barriers');
const pngPath = option('--png');

const geometry = loadCampusGeometry();
const floor = auditFloor(geometry, { radius, barriers });
const seats = auditTopSeats(geometry, { radius, barriers });

console.log(
    JSON.stringify(
        {
            radius,
            barriers,
            reachableArea_m2: Math.round(floor.reachableArea),
            fallArea_m2: Math.round(floor.fallArea),
            regionRooms: floor.rooms.length,
            reachableRooms: floor.reachableRooms.length,
            unreachableRooms: floor.unreachableRooms,
            topSeatWallTopArea_m2: Math.round(seats.wallTopArea)
        },
        null,
        2
    )
);

const png = (width: number, height: number, rgb: Uint8Array) => {
    const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body));
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let row = 0; row < height; row++) {
        raw[row * (width * 3 + 1)] = 0;
        raw.set(rgb.subarray(row * width * 3, (row + 1) * width * 3), row * (width * 3 + 1) + 1);
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
};

if (pngPath) {
    const { grid } = floor;
    const step = 2;
    const width = Math.floor(grid.width / step);
    const height = Math.floor(grid.height / step);
    const rgb = new Uint8Array(width * height * 3);
    const colours: Record<number, number[]> = {
        [CELL.WALL]: [30, 30, 30],
        [CELL.GLASS]: [40, 120, 220],
        [CELL.STAND]: [200, 120, 40],
        [CELL.BARRIER]: [200, 40, 200]
    };
    for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
            const k = j * step * grid.width + i * step;
            const colour =
                colours[floor.solid[k]] ??
                (floor.reached[k]
                    ? floor.floor[k]
                        ? [150, 220, 150]
                        : [255, 60, 60]
                    : floor.floor[k]
                      ? [240, 170, 170]
                      : [245, 245, 245]);
            rgb.set(colour, (j * width + i) * 3);
        }
    }
    writeFileSync(pngPath, png(width, height, rgb));
    console.log(`wrote ${pngPath} (green reachable, pink unreachable floor, red reachable void, magenta barrier)`);
}
