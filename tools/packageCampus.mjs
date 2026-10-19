import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { RELEASE_ITEMS } from '../deploy/campus/release-contract.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });
const short = stdout.trim();
const output = resolve(root, `campus-release-${short}.zip`);
const stage = await mkdtemp(join(tmpdir(), 'moonshot-campus-release-'));
try {
    for (const item of RELEASE_ITEMS) {
        const source = join(root, item);
        await stat(source).catch(() => {
            throw new Error(`Build artifact missing: ${item}. Run npm run campus:build first.`);
        });
        await cp(source, join(stage, item), { recursive: true });
    }
    const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    await writeFile(
        join(stage, 'package.json'),
        `${JSON.stringify({
            name: 'moonshot-campus-server',
            version: rootPackage.version,
            private: true,
            type: 'module',
            engines: rootPackage.engines,
            scripts: { start: 'node dist-server/campus-server.mjs' }
        }, null, 2)}\n`
    );
    await rm(output, { force: true });
    await execFileAsync('zip', ['-qr', output, '.'], { cwd: stage });
    const info = await stat(output);
    console.log(`${output}\n${info.size} bytes`);
} finally {
    await rm(stage, { recursive: true, force: true });
}
