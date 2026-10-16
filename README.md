# Moonshot Open World

Browser-first first-person exploration game based on the Moonshot Academy FF-01 architectural model.

> **In development: M0.1–M0.4.** The actual FF-01 GLB, a static collision layer with authored boundary barriers, the official PlayCanvas first-person controller, entry/pause/automatic fall recovery, room recognition (including anchor triggers for the six label-only spaces), a browser-tested route from the east entry through S308 to S309, and a first presentation pass (3.6 m walls, ceilings, open-air Lotus Arena with a 10 m perimeter wall, doors and furniture interpreted from the source linework, light fixtures, materials, sky and a circular minimap) are implemented. Arena traversal on foot, glass-blocking and manual playtesting remain open. This is not yet declared PLAYABLE.

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

Open the URL printed by Vite (normally <http://localhost:5173>), wait for the four loading stages to finish, then click **进入校园**. Use WASD to walk, Shift to sprint, Space to jump, mouse to look, M for the full-floor map, Escape to pause, and R to return to the east entrance (position and heading). Leaving the level (falling below Y = −3 m) returns the player there automatically.

The top-left plate names the current location (room number, name, kind colour). Entering a location for the first time marks it **新发现**, shows a toast and lifts the hatching from that room on the minimap and full map; the tally counts discovered locations out of 166 (165 source records plus the arena). Discoveries, mouse sensitivity and field of view (pause menu) are saved in the browser's local storage only.

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
npm run derive:world         # regenerate public/assets/campus/derived/ after source or presentation changes
```

`npm run build` writes a static site to `dist/`; `npm run start` previews it locally. The two Playwright suites cover actual movement/jump/pause/recovery, boundary barriers and the S308/S309 route in development, and asset loading/entry/pause in the production preview. GitHub Actions runs them after unit, lint, typecheck and production-build checks.

The development browser tests run the game on Playwright's virtual clock with drawing disabled (`tests/browser/support.ts`): the clock is installed before navigation and paused once the campus is ready, so game time only advances through `page.clock.runFor` and movement assertions do not depend on the test machine's GPU. Tests reset to the spawn pose after entry, because the CI headless shell delivers a pointer-lock movement delta that turns the camera. Headless CI renders with software WebGL at about 1 FPS, where the engine's 0.1 s frame-time clamp previously slowed the simulation roughly tenfold and made wall-clock waits fail. Rendering is still exercised by the production smoke test.

## Runtime architecture

- `src/main.ts` initializes Ammo/PlayCanvas, gates entry on campus, room and collision readiness, and updates the location tracker.
- `src/world/campusLoader.ts` loads the source GLB as a PlayCanvas container, preserves its hierarchy and root scale, and hides room color patches, linework and label anchors.
- `src/physics/collisionWorld.ts` adds static mesh colliders only to the floor, walls, glazing, court, stand base and seat rows, plus one unrendered `GAMEPLAY_AUTHORED` barrier mesh built by `src/physics/boundaryBarriers.ts` from the floor-slab outline and wall/glazing top outlines.
- `src/config/gameplay.ts` holds the spawn, capsule size, fall-recovery height, barrier height and label-only trigger radius.
- `src/config/presentation.ts` holds the presentation parameters (wall/ceiling height, arena perimeter wall, door height, derived-asset paths). `src/world/presentation.ts` is the named wall-height adapter: it scales the source `Walls`, `Walls_Top` and `Glazing` entities from 2.8 m to 3.6 m before colliders are built; the GLB is untouched.
- `src/world/dressing.ts` builds the `GAMEPLAY_AUTHORED` dressing: floor finishes per room kind (on the source room patches), a ceiling cut away over the open-air arena and courtyards by a derived mask, the arena perimeter wall (with collision), door lintels and open leaves, furniture (tables/counters collide), restroom partitions, court/stair markings and emissive light panels. Textures are procedural canvas textures (`src/render/textures.ts`), with no external image assets.
- `src/world/rooms/` holds photo-referenced `GAMEPLAY_AUTHORED` room interiors. `m104.ts` rebuilds M104 一小步空间 from photos of the real room supplied by the project owner, using geometry and flat colours only (no textures): an oak plank floor, frosted whiteboard glass on the long walls, lavender end walls with sticky notes and posters, a T-bar ceiling with linear LED pendants, a folding partition, bookcases, olive floor sofas, beanbags, a mobile TV, an armchair, height-adjustable desk clusters with chairs and desk clutter. Positions and sizes are read from photos and fitted to the source outline; they are not surveyed. `src/render/shapes.ts` provides the procedural shapes; `src/world/authoredRoom.ts` builds one mesh per material and one collider body. The derivation leaves authored rooms empty of generic furniture and lights.
- `src/render/atmosphere.ts` sets ambient/sun light, ACES tone mapping, light bloom and vignette through the engine's upstream `CameraFrame` script, and a pool of 14 omni lights re-assigned to the light fixtures nearest the player. `src/render/sky.ts` draws an unlit gradient sky dome. SSAO is off: it blacked out whole distant wall faces in testing.
- `src/ui/shell.ts` + `src/ui/theme.css` are the whole UI (wayfinding-signage style): title/loading screen with staged progress and the floor plan as backdrop, HUD (location plate, crosshair, circular north-up minimap with discovery tally, key hints, toasts), full-floor map, and pause menu with discovery progress and settings. `src/ui/minimap.ts` draws both maps with a hatch over undiscovered rooms. `src/gameplay/discovery.ts` is the discovery log; `src/ui/settings.ts` persists settings. `src/app/debugHooks.ts` defines the development-only test hooks.
- `src/world/doorwayCutter.ts` cuts the derived `GAMEPLAY_AUTHORED` doorways out of the source `Walls`/`Glazing` meshes at load (render and collider), lining each opening with jambs and a head; `src/world/doorways.ts` holds the shared clipping geometry.
- `src/player/playerController.ts` uses PlayCanvas Engine's upstream First-Person Controller for movement, sprint, jump, look and pointer lock.
- `src/world/roomIndex.ts` validates room data and performs polygon/hole lookup with deterministic overlap and boundary hysteresis; label-only spaces use circular triggers at their source label anchors, only where no polygon applies.
- `src/ui/gameHud.ts` exposes loading/error states, entry, crosshair/location display, pause and recovery.
- `vite.config.ts` injects the PlayCanvas Inspector only for development. It is excluded from production builds.
- `public/assets/campus/` contains the original GLB and a minimal rooms derivative. The original export archive, access/capacity fields, sensor bindings, source plans and web-map configuration are excluded. See [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md).
- `public/ammo/` holds the static physics runtime.
- `tools/glb.ts` and `tools/navAudit.ts` are offline, dependency-free validation tools (not part of the browser bundle): a GLB reader and a 2D capsule reachability audit used by `npm test` and `npm run audit:nav`.
- `tools/deriveWorld.ts` derives `public/assets/campus/derived/` (`world.json`, `ceiling-mask.png`, `minimap.png`, `manifest.json`) from the source GLB and rooms: the arena outline, door swings, furniture outlines, light positions, the ceiling mask and the minimap. `npm test` re-derives in memory and requires the committed files to match exactly. See [docs/ASSET_PIPELINE.md](docs/ASSET_PIPELINE.md).

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
- PASS (static audit, not physics): with a 0.28 m capsule, barriers, all furniture and the 14 authored doorways, all 159 source regions are reachable from the spawn and no reachable floor ends at an open edge. Without the doorways exactly the 14 rooms listed in `test/navigation-audit.test.js` are sealed by the source walls.
- PASS: browser test walks the capsule through each of the 14 authored doorways in both directions.
- PASS: browser raycasts confirm the presented walls collide at 3.3 m (above the 2.8 m source height) and not at 3.75 m, and the arena perimeter wall collides at 8 m. The 2,749 derived furniture items (906 colliding) and the 26 M104 authored colliders leave every room reachable.
- PASS: browser tests cover the new UI flow (staged loading, 进入校园, location plate, discovery toast/tally, M map toggle, pause progress, recovery toast).
- PASS (visual, software WebGL screenshots only): ceilings indoors, sky above the arena and courtyards, 10 m arena wall, doors, furnished classrooms/labs/dining/library, UI screens at desktop and 390 px width. Real-GPU appearance and frame rate are NOT RUN.
- NOT RUN: glass blocking probe, corridor route to Lotus Arena, manual playtest, representative desktop performance benchmark.
- History: before these fixes the GitHub Actions browser job failed on every push from `feat: add FF01 exploration controls` onwards; the earlier S308/S309 PASS was observed only on a local GPU.

The source geometries remain unverified derivations from drawings; no source mesh or room polygon was modified. Barriers, the capsule size and anchor triggers are `GAMEPLAY_AUTHORED` overrides. The detailed checklist is in [docs/COLLISION_AUDIT.md](docs/COLLISION_AUDIT.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).
