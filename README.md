# Moonshot Open World

Browser-first first-person exploration game based on the Moonshot Academy FF-01 architectural model.

> **In development: M0.1–M0.4.** The actual FF-01 GLB, a static collision layer with authored boundary barriers, the official PlayCanvas first-person controller, entry/pause/automatic fall recovery, room recognition (including anchor triggers for the six label-only spaces), and a browser-tested route from the east entry through S308 to S309 are implemented. Arena traversal, glass-blocking and manual playtesting remain open. This is not yet declared PLAYABLE.

## Cloudflare Pages

The public production build is available at <https://moonshot-csgo.pages.dev/>. The Pages project is connected to the private `lloyd-c137/moonshot-csgo` GitHub repository: pushes to `main` build and deploy production, and other branches receive preview deployments. Cloudflare runs `npm run build` with `dist/` as the output directory and Node.js `24.16.0` (pinned in `.nvmrc`).

The repository owner explicitly approved public hosting of the FF-01 runtime GLB and curated room data on 2026-10-15. This remains an in-development game; deployment does not imply that unverified classroom/arena routes are playable.

## Requirements

- Node.js `>=22.23.2` (bootstrap verified with Node `24.16.0` and npm `11.13.0`)
- npm

## Install and run

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally <http://localhost:5173>), wait for **校园与碰撞已准备**, then click **Enter Campus**. Use WASD to walk, Shift to sprint, Space to jump, mouse to look, Escape to pause/release the pointer, R to return to the safe spawn, and the pause menu to resume or recover. Leaving the level (falling below Y = −3 m) returns the player to the safe spawn automatically.

## Checks and production preview

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run start
npm run test:e2e:prod
npm run audit:nav            # offline reachability audit; add -- --png nav.png for a top-down map
```

`npm run build` writes a static site to `dist/`; `npm run start` previews it locally. The two Playwright suites cover actual movement/jump/pause/recovery, boundary barriers and the S308/S309 route in development, and asset loading/entry/pause in the production preview. GitHub Actions runs them after unit, lint, typecheck and production-build checks.

The development browser tests run the game on Playwright's virtual clock with drawing disabled (`tests/browser/support.ts`): game time only advances through `page.clock.runFor`, so movement assertions do not depend on the test machine's GPU. Headless CI renders with software WebGL at about 1 FPS, where the engine's 0.1 s frame-time clamp previously slowed the simulation roughly tenfold and made wall-clock waits fail. Rendering is still exercised by the production smoke test.

## Runtime architecture

- `src/main.ts` initializes Ammo/PlayCanvas, gates entry on campus, room and collision readiness, and updates the location tracker.
- `src/world/campusLoader.ts` loads the source GLB as a PlayCanvas container, preserves its hierarchy and root scale, and hides room color patches, linework and label anchors.
- `src/physics/collisionWorld.ts` adds static mesh colliders only to the floor, walls, glazing, court, stand base and seat rows, plus one unrendered `GAMEPLAY_AUTHORED` barrier mesh built by `src/physics/boundaryBarriers.ts` from the floor-slab outline and wall/glazing top outlines.
- `src/config/gameplay.ts` holds the spawn, capsule size, fall-recovery height, barrier height and label-only trigger radius.
- `src/player/playerController.ts` uses PlayCanvas Engine's upstream First-Person Controller for movement, sprint, jump, look and pointer lock.
- `src/world/roomIndex.ts` validates room data and performs polygon/hole lookup with deterministic overlap and boundary hysteresis; label-only spaces use circular triggers at their source label anchors, only where no polygon applies.
- `src/ui/gameHud.ts` exposes loading/error states, entry, crosshair/location display, pause and recovery.
- `vite.config.ts` injects the PlayCanvas Inspector only for development. It is excluded from production builds.
- `public/assets/campus/` contains the original GLB and a minimal rooms derivative. The original export archive, access/capacity fields, sensor bindings, source plans and web-map configuration are excluded. See [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md).
- `public/ammo/` holds the static physics runtime.
- `tools/glb.ts` and `tools/navAudit.ts` are offline, dependency-free validation tools (not part of the browser bundle): a GLB reader and a 2D capsule reachability audit used by `npm test` and `npm run audit:nav`.

## Physics runtime

The official Ammo.js glue, WebAssembly binary, and JavaScript fallback are stored under `public/ammo/`; Vite copies them to `dist/ammo/` without bundling or renaming. The app gates movement until Ammo is initialized. Source commit and SHA-256 values are recorded in `public/ammo/SOURCE.md`, and the zlib license is in `public/ammo/LICENSE`. `npm test` checks those hashes and notices.

## Bootstrap provenance

Scaffolded in a temporary directory with the official `create-playcanvas@0.10.1` generator, Engine format, First-Person Controller starter. The generated scene and controller code remain unchanged. The generator source was `playcanvas/create-playcanvas` commit `95333d74952eb816a32c42235004c64b071a10a4`; its MIT license is in `licenses/create-playcanvas-MIT.txt`.

## Verification state

- PASS: exact source GLB hash, node set, coordinate frame, root scale and computed world bounds validated; actual GLB loads in development and production browser.
- PASS: 13 structural static collision bodies and 9,708 authored barrier faces initialize; the east-entrance spawn passes floor support and capsule headroom ray probes.
- PASS: browser test verifies Enter/pointer lock, east-lobby HUD, WASD displacement, sprint, a camera turn from a standard PointerEvent movement delta, jump/landing, Escape pause, Resume and R recovery. Manual hardware-mouse playtesting is NOT RUN.
- PASS: browser test walks out of the open east entrance and is stopped by the barrier; pushing west from the 3.11 m top seat row does not cross the 2.8 m wall behind it; a player placed outside the level is recovered automatically.
- PASS: browser route test walks from the entry corridor through S308 and S309 along navigation-grid waypoints; it checks wall blocking and both room HUD transitions.
- PASS: pure geometry tests cover all 165 records, all 159 polygons, label-only anchor triggers, holes, concavity, overlaps and boundary hysteresis.
- PASS (static audit, not physics): with a 0.28 m capsule and barriers, 145 of 159 source regions are reachable from the spawn and no reachable floor ends at an open edge; 14 rooms remain unreachable because their source door gaps are narrower than 0.56 m or absent (listed in `test/navigation-audit.test.js`).
- NOT RUN: glass blocking probe, corridor route to Lotus Arena, manual playtest, representative desktop performance benchmark.
- History: before these fixes the GitHub Actions browser job failed on every push from `feat: add FF01 exploration controls` onwards; the earlier S308/S309 PASS was observed only on a local GPU.

The source geometries remain unverified derivations from drawings; no source mesh or room polygon was modified. Barriers, the capsule size and anchor triggers are `GAMEPLAY_AUTHORED` overrides. The detailed checklist is in [docs/COLLISION_AUDIT.md](docs/COLLISION_AUDIT.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
