/**
 * Large GLBs ship with a gzip copy beside them (`<file>.glb.gz`, made by `npm run assets:compress`): Cloudflare
 * Pages does not compress `model/gltf-binary`, and the campus and character models shrink 4–7× gzipped.
 * Returns the GLB bytes, or null when the copy is missing or the browser cannot decompress it (the caller then
 * loads the plain file).
 */
export const fetchGlb = async (url: string): Promise<ArrayBuffer | null> => {
    if (typeof DecompressionStream !== 'function') return null;
    try {
        const response = await fetch(`${url}.gz`);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        const head = new Uint8Array(bytes, 0, 4);
        // A server that already decoded it (Content-Encoding: gzip) hands back the GLB itself.
        if (head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) return bytes; // "glTF"
        if (head[0] !== 0x1f || head[1] !== 0x8b) return null;
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).arrayBuffer();
    } catch {
        return null;
    }
};
