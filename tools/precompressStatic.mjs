import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const br = promisify(brotliCompress);
const gz = promisify(gzip);
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const compressible = new Set(['.js', '.css', '.json', '.wasm', '.svg', '.html']);

async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = join(directory, entry.name);
        if (entry.isDirectory()) await visit(filename);
        else if (compressible.has(extname(entry.name).toLowerCase())) {
            const bytes = await readFile(filename);
            if (bytes.length < 256) continue;
            const [brotli, gzipBytes] = await Promise.all([
                br(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }),
                gz(bytes)
            ]);
            await Promise.all([writeFile(`${filename}.br`, brotli), writeFile(`${filename}.gz`, gzipBytes)]);
        }
    }
}

await visit(root);
