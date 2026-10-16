import { defineConfig } from 'vite';

// Build identity for the in-game "new version available" prompt: the commit on Cloudflare Pages, else the build time.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const BUILD_ID = env.CF_PAGES_COMMIT_SHA?.slice(0, 12) || `local-${Date.now().toString(36)}`;

// https://vite.dev/config/
export default defineConfig({
    define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
    plugins: [
        {
            // Dev only: install the PlayCanvas Inspector before the app starts (press ` to toggle)
            name: 'playcanvas-inspector',
            apply: 'serve',
            config: () => ({ optimizeDeps: { include: ['@playcanvas/inspector'] } }),
            transformIndexHtml: () => [
                { tag: 'script', attrs: { type: 'module', src: '/src/inspector.ts' }, injectTo: 'head-prepend' }
            ]
        },
        {
            // Production: publish the build id so running games can notice a newer deployment.
            name: 'build-version',
            apply: 'build',
            generateBundle() {
                this.emitFile({
                    type: 'asset',
                    fileName: 'version.json',
                    source: JSON.stringify({ build: BUILD_ID })
                });
            }
        }
    ]
});
