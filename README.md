# Moonshot Open World

Browser-first first-person exploration game based on the Moonshot Academy FF-01 architectural model.

> **M0.0 bootstrap only.** This checkout currently contains the unmodified official PlayCanvas First-Person Controller demo. Its obstacle course is starter content, not a substitute for the FF01 source model. The supplied campus ZIP and game assets are intentionally not included; M0.1 requires asset review before import.

## Requirements

- Node.js `>=22.23.2` (bootstrap verified with Node `24.16.0` and npm `11.13.0`)
- npm

## Install and run

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally <http://localhost:5173>). Click the scene to lock the pointer; use **WASD** to move, the mouse to look, and **Space** to jump. Press Escape to release the pointer.

## Checks and production preview

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

`npm run build` writes a static site to `dist/`. `npm run start` serves that output locally. GitHub Actions runs typecheck, lint, tests, and the production build on pushes and pull requests.

## M0.0 architecture

- `src/main.ts` initializes Ammo, registers PlayCanvas render/camera/light/script/collision/rigidbody systems, and builds the unchanged starter obstacle course.
- `src/controller.ts` adapts the Engine's built-in First-Person Controller script; movement and physics behavior are upstream code.
- `vite.config.ts` injects the PlayCanvas Inspector only for development. It is excluded from production builds.
- `public/ammo/` holds the static physics runtime; no FF01 model, room data, backend, or campus sensor endpoint is loaded in this milestone.

## Physics runtime

The starter initializes Ammo before starting the PlayCanvas app. The official Ammo.js glue, WebAssembly binary, and JavaScript fallback are stored under `public/ammo/`; Vite copies them to `dist/ammo/` without bundling or renaming. `src/main.ts` configures these same root-relative paths. The source commit and SHA-256 values are recorded in `public/ammo/SOURCE.md`, and the zlib license is in `public/ammo/LICENSE`. `npm test` checks those exact hashes and notices.

## Bootstrap provenance

Scaffolded in a temporary directory with the official `create-playcanvas@0.10.1` generator, Engine format, First-Person Controller starter. The generated scene and controller code remain unchanged. The generator source was `playcanvas/create-playcanvas` commit `95333d74952eb816a32c42235004c64b071a10a4`; its MIT license is in `licenses/create-playcanvas-MIT.txt`.

This milestone does not claim that FF01 geometry, collision, room semantics, or campus navigation are implemented or verified. Continue with M0.1 only after reviewing and curating the separately supplied campus archive.
