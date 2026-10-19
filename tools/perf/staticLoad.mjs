import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { createCampusServer } from '../../server/node/main.ts';

const mode = process.env.MODE === 'baseline' ? 'baseline-sync-zlib' : 'optimized-precompressed-stream';
const requests = Math.max(20, Number(process.env.REQUESTS ?? 160));
const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 4));
const dist = resolve(process.env.DIST_DIR ?? 'dist');
const findJavaScript = async (directory) => {
    let largest = null;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = join(directory, entry.name);
        if (entry.isDirectory()) {
            const found = await findJavaScript(filename);
            if (found && (!largest || found.bytes > largest.bytes)) largest = found;
        } else if (extname(entry.name) === '.js' && !entry.name.endsWith('.br') && !entry.name.endsWith('.gz')) {
            const bytes = (await stat(filename)).size;
            if (!largest || bytes > largest.bytes) largest = { filename, bytes };
        }
    }
    return largest;
};

const largest = await findJavaScript(dist);
if (!largest) throw new Error(`No JavaScript asset found under ${dist}`);
const target = largest.filename;
const relativeTarget = target.slice(dist.length).replaceAll('\\', '/');
const urlPath = relativeTarget.startsWith('/') ? relativeTarget : `/${relativeTarget}`;
const temp = await mkdtemp(join(tmpdir(), 'moonshot-static-perf-'));
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let server;
let campusServer;

try {
    if (mode === 'baseline-sync-zlib') {
        server = createServer((request, response) => {
            const bytes = readFileSync(target);
            const accept = String(request.headers['accept-encoding'] ?? '');
            const body = /(?:^|,)\s*br(?:\s*,|$)/i.test(accept)
                ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })
                : /(?:^|,)\s*gzip(?:\s*,|$)/i.test(accept) ? gzipSync(bytes) : bytes;
            response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-encoding': body === bytes ? 'identity' : /br/i.test(accept) ? 'br' : 'gzip' });
            response.end(body);
        });
        await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    } else {
        campusServer = await createCampusServer({ config: { PORT: 0, HOST: '127.0.0.1', DATA_DIR: join(temp, 'data'), DIST_DIR: dist } });
        server = campusServer.httpServer;
        await campusServer.listen();
    }
    const port = server.address().port;
    const cpuStart = process.cpuUsage();
    const rssStart = process.memoryUsage().rss;
    const started = performance.now();
    const drift = [];
    let expected = performance.now() + 50;
    const timer = setInterval(() => {
        const now = performance.now();
        drift.push(Math.max(0, now - expected));
        expected = now + 50;
    }, 50);
    let completed = 0;
    let wireBytes = 0;
    const worker = async () => {
        while (completed < requests) {
            completed++;
            wireBytes += await new Promise((resolveRequest, rejectRequest) => {
                const req = request({ hostname: '127.0.0.1', port, path: urlPath, headers: { 'accept-encoding': 'br,gzip' } });
                let bytes = 0;
                req.on('response', (response) => {
                    response.on('data', (chunk) => { bytes += chunk.byteLength; });
                    response.on('end', () => resolveRequest(bytes));
                });
                req.on('error', rejectRequest);
                req.end();
            });
        }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
    clearInterval(timer);
    delay.disable();
    const elapsed = performance.now() - started;
    const cpu = process.cpuUsage(cpuStart);
    const sortedDrift = drift.sort((a, b) => a - b);
    const percentile = (p) => sortedDrift[Math.max(0, Math.ceil(sortedDrift.length * p) - 1)] ?? 0;
    console.log(JSON.stringify({ mode, requests, concurrency, path: urlPath, elapsedMs: +elapsed.toFixed(1), wireBytes, cpuMs: +((cpu.user + cpu.system) / 1000).toFixed(1), eventLoopDelayP95Ms: +(delay.percentile(95) / 1e6).toFixed(2), eventLoopDelayMaxMs: +(delay.max / 1e6).toFixed(2), timerDriftP95Ms: +percentile(.95).toFixed(2), timerDriftMaxMs: +(sortedDrift.at(-1) ?? 0).toFixed(2), rssDeltaBytes: process.memoryUsage().rss - rssStart }));
} finally {
    if (campusServer) await campusServer.close();
    else if (server?.listening) await new Promise((resolveClose) => server.close(() => resolveClose()));
    await rm(temp, { recursive: true, force: true });
}
