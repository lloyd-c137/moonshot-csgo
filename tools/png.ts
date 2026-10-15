// Minimal PNG encode/decode for derived assets (8-bit greyscale or RGBA, filter 0). Offline tooling only.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
};

export type Image = { width: number; height: number; channels: 1 | 3 | 4; data: Uint8Array };

export const encodePng = ({ width, height, channels, data }: Image) => {
    const colourType = { 1: 0, 3: 2, 4: 6 }[channels];
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, colourType, 0, 0, 0], 8);
    const stride = width * channels;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let row = 0; row < height; row++) {
        raw.set(data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
    }
    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
};

/** Decodes PNGs written by `encodePng` (filter type 0 only). */
export const decodePng = (file: Buffer): Image => {
    if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
    let offset = 8;
    let width = 0;
    let height = 0;
    let channels: 1 | 3 | 4 = 4;
    const idat: Buffer[] = [];
    while (offset < file.length) {
        const length = file.readUInt32BE(offset);
        const type = file.subarray(offset + 4, offset + 8).toString('ascii');
        const body = file.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            channels = ({ 0: 1, 2: 3, 6: 4 } as Record<number, 1 | 3 | 4>)[body[9]];
        } else if (type === 'IDAT') idat.push(body);
        offset += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const data = new Uint8Array(stride * height);
    for (let row = 0; row < height; row++) {
        if (raw[row * (stride + 1)] !== 0) throw new Error('Unsupported PNG filter');
        data.set(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)), row * stride);
    }
    return { width, height, channels, data };
};
