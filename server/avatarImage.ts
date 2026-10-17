/** Strict header-only gate for normalized static WebP; SVG and all other active/document formats are excluded. */
export const webpDimensions = (bytes: Uint8Array) => {
    const text = (offset: number, value: string) =>
        [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    const u24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    const u16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
    if (
        bytes.length < 30 ||
        !text(0, 'RIFF') ||
        !text(8, 'WEBP') ||
        new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true) + 8 !== bytes.length
    )
        return null;
    for (let offset = 12; offset + 8 <= bytes.length; ) {
        const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
        const data = offset + 8;
        if (data + size > bytes.length) return null;
        let width = 0;
        let height = 0;
        if (text(offset, 'VP8X') && size >= 10) {
            width = 1 + u24(data + 4);
            height = 1 + u24(data + 7);
        } else if (text(offset, 'VP8 ') && size >= 10 && text(data + 3, '\u009d\u0001\u002a')) {
            width = u16(data + 6) & 0x3fff;
            height = u16(data + 8) & 0x3fff;
        } else if (text(offset, 'VP8L') && size >= 5 && bytes[data] === 0x2f) {
            width = 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8);
            height = 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) + ((bytes[data + 4] & 0x0f) << 10);
        }
        if (width || height) return width > 0 && height > 0 ? { width, height } : null;
        offset = data + size + (size & 1);
    }
    return null;
};

export const AVATAR_IMAGE = { maxBytes: 250_000, maxWidth: 1024, maxHeight: 512, maxPixels: 524_288 } as const;
