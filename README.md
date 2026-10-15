# Moonshot Open World

Browser-first first-person exploration game based on the Moonshot Academy FF-01 architectural model.

> **In development: M0.1–M0.3.** The actual FF-01 GLB, a static collision layer, the official PlayCanvas first-person controller, entry/pause/recovery controls, and room recognition are implemented. Automated browser checks cover control input; corridor/classroom/arena route and doorway traversal acceptance remain in progress. This is not yet declared PLAYABLE.

## Requirements

- Node.js `>=22.23.2` (bootstrap verified with Node `24.16.0` and npm `11.13.0`)
- npm

## Install and run

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally <http://localhost:5173>), wait for **校园与碰撞已准备**, then click **Enter Campus**. Use WASD to walk, Shift to sprint, Space to jump, mouse to look, Escape to pause/release the pointer, R to return to the safe spawn, and the pause menu to resume or recover.

## Checks and production preview

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run start
npm run test:e2e:prod
```

`npm run build` writes a static site to `dist/`; `npm run start` previews it locally. The two Playwright suites cover actual movement/jump/pause/recovery in development and asset loading/entry/pause in the production preview. GitHub Actions runs them after unit, lint, typecheck and production-build checks.

## Runtime architecture

- `src/main.ts` initializes Ammo/PlayCanvas, gates entry on campus, room and collision readiness, and updates the location tracker.
- `src/world/campusLoader.ts` loads the source GLB as a PlayCanvas container, preserves its hierarchy and root scale, and hides room color patches, linework and label anchors.
- `src/physics/collisionWorld.ts` adds static mesh colliders only to the floor, walls, glazing, court, stand base and seat rows.
- `src/player/playerController.ts` uses PlayCanvas Engine's upstream First-Person Controller for movement, sprint, jump, look and pointer lock.
- `src/world/roomIndex.ts` validates room data and performs polygon/hole lookup with deterministic overlap and boundary hysteresis.
- `src/ui/gameHud.ts` exposes loading/error states, entry, crosshair/location display, pause and recovery.
- `vite.config.ts` injects the PlayCanvas Inspector only for development. It is excluded from production builds.
- `public/assets/campus/` contains the original GLB and a minimal rooms derivative. The original export archive, access/capacity fields, sensor bindings, source plans and web-map configuration are excluded. See [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md).
- `public/ammo/` holds the static physics runtime.

## Physics runtime

The official Ammo.js glue, WebAssembly binary, and JavaScript fallback are stored under `public/ammo/`; Vite copies them to `dist/ammo/` without bundling or renaming. The app gates movement until Ammo is initialized. Source commit and SHA-256 values are recorded in `public/ammo/SOURCE.md`, and the zlib license is in `public/ammo/LICENSE`. `npm test` checks those hashes and notices.

## Bootstrap provenance

Scaffolded in a temporary directory with the official `create-playcanvas@0.10.1` generator, Engine format, First-Person Controller starter. The generated scene and controller code remain unchanged. The generator source was `playcanvas/create-playcanvas` commit `95333d74952eb816a32c42235004c64b071a10a4`; its MIT license is in `licenses/create-playcanvas-MIT.txt`.

## Verification state

- PASS: exact source GLB hash, node set, coordinate frame, root scale and computed world bounds validated; actual GLB loads in development and production browser.
- PASS: 13 structural static collision bodies initialize; east-entrance candidate passes floor support and capsule headroom ray probes.
- PASS: browser test verifies Enter/pointer lock, WASD displacement, mouse look, jump/landing, Escape pause, Resume and R recovery.
- PASS: pure geometry tests cover all 165 records, all 159 polygons and six label-only rooms, holes, concavity, overlaps and boundary hysteresis.
- NOT RUN: end-to-end traversal through three doorways, classroom entry, corridor route to Lotus Arena, manual playtest, representative desktop performance benchmark.

The source geometries remain unverified derivations from drawings; no source mesh or room polygon was modified. The detailed checklist is in [docs/COLLISION_AUDIT.md](docs/COLLISION_AUDIT.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
