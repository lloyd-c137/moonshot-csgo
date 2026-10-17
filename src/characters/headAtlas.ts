const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 32_000_000;
const WIDTH = 1024;
const HEIGHT = 512;

const toWebp = (canvas: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('浏览器无法生成头像图片'))),
            'image/webp',
            quality
        )
    );

/** Converts a user image into a complete 360-degree head UV atlas with no metadata or transparent gaps. */
export const createHeadAtlas = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
    if (file.size > MAX_SOURCE_BYTES) throw new Error('原始图片不能超过 8 MiB');
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
        if (image.width * image.height > MAX_SOURCE_PIXELS) throw new Error('图片像素过大，请选择较小的图片');
        const side = Math.min(image.width, image.height);
        const sx = (image.width - side) / 2;
        const sy = (image.height - side) / 2;
        const atlas = document.createElement('canvas');
        atlas.width = WIDTH;
        atlas.height = HEIGHT;
        const ctx = atlas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('无法处理头像图片');
        ctx.fillStyle = '#d8d8d8';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        // The front-facing half of the UV gets the complete square crop. The side/back halves extend its edge colors.
        ctx.drawImage(image, sx, sy, side, side, WIDTH / 4, 0, WIDTH / 2, HEIGHT);
        ctx.drawImage(image, sx, sy, side * 0.16, side, 0, 0, WIDTH / 4, HEIGHT);
        ctx.drawImage(image, sx + side * 0.84, sy, side * 0.16, side, WIDTH * 0.75, 0, WIDTH / 4, HEIGHT);
        // Blend the rear seam so the atlas closes without a hard vertical edge.
        const seam = 28;
        const pixels = ctx.getImageData(0, 0, seam, HEIGHT);
        const opposite = ctx.getImageData(WIDTH - seam, 0, seam, HEIGHT);
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < seam; x++) {
                const left = (y * seam + x) * 4;
                const right = (y * seam + seam - 1 - x) * 4;
                for (let channel = 0; channel < 3; channel++) {
                    const blend = Math.round((pixels.data[left + channel] + opposite.data[right + channel]) / 2);
                    pixels.data[left + channel] = blend;
                    opposite.data[right + channel] = blend;
                }
            }
        }
        ctx.putImageData(pixels, 0, 0);
        ctx.putImageData(opposite, WIDTH - seam, 0);
        let output = await toWebp(atlas, 0.86);
        for (const quality of [0.78, 0.68]) {
            if (output.size <= 250_000) break;
            output = await toWebp(atlas, quality);
        }
        if (output.size > 250_000) throw new Error('头像处理后仍超过 250 KiB，请使用更简单的图片');
        return output;
    } finally {
        image.close();
    }
};
