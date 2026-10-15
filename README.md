# Moonshot Open World

Browser-first first-person exploration game based on the Moonshot Academy FF-01 architectural model.

> **In development: M0.1 scene ingestion.** The real FF-01 source GLB is now loaded at its original 1:1 scale. First-person play, collision, room HUD and route acceptance remain in progress; the start screen is not yet a playable entry flow.

## Requirements

- Node.js `>=22.23.2` (bootstrap verified with Node `24.16.0` and npm `11.13.0`)
- npm

## Install and run

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally <http://localhost:5173>). M0.1 currently presents the actual model in a scene overview; player controls are being implemented in M0.2.

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

- `src/main.ts` initializes Ammo and renders the FF-01 scene using the PlayCanvas Engine.
- `src/world/campusLoader.ts` loads the source GLB as a PlayCanvas container, preserves its hierarchy and root scale, and hides room color patches, linework and label anchors.
- `src/ui/loadingScreen.ts` exposes loading progress, a non-playable M0.1 entry panel and actionable load errors.
- `vite.config.ts` injects the PlayCanvas Inspector only for development. It is excluded from production builds.
- `public/assets/campus/` contains the original GLB and a minimal rooms derivative. The original export archive, access/capacity fields, sensor bindings, source plans and web-map configuration are excluded. See [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md).
- `public/ammo/` holds the static physics runtime; the full player/collision scene is not implemented yet.

## Physics runtime

The starter initializes Ammo before starting the PlayCanvas app. The official Ammo.js glue, WebAssembly binary, and JavaScript fallback are stored under `public/ammo/`; Vite copies them to `dist/ammo/` without bundling or renaming. `src/main.ts` configures these same root-relative paths. The source commit and SHA-256 values are recorded in `public/ammo/SOURCE.md`, and the zlib license is in `public/ammo/LICENSE`. `npm test` checks those exact hashes and notices.

## Bootstrap provenance

Scaffolded in a temporary directory with the official `create-playcanvas@0.10.1` generator, Engine format, First-Person Controller starter. The generated scene and controller code remain unchanged. The generator source was `playcanvas/create-playcanvas` commit `95333d74952eb816a32c42235004c64b071a10a4`; its MIT license is in `licenses/create-playcanvas-MIT.txt`.

This milestone does not claim that FF01 geometry, collision, room semantics, or campus navigation are implemented or verified. Continue with M0.1 only after reviewing and curating the separately supplied campus archive.
