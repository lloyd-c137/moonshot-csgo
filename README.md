# Moonshot Frisbee Games

Browser-first first-person exploration game based on the Moonshot Academy FF-01 architectural model.

> **In development: M0.1–M0.4.** The actual FF-01 GLB, a static collision layer with authored boundary barriers, the official PlayCanvas first-person controller, entry/pause/automatic fall recovery, room recognition (including anchor triggers for the six label-only spaces), a browser-tested route from the east entry through S308 to S309, and a first presentation pass (3.6 m walls, ceilings, open-air Lotus Arena with a 10 m perimeter wall, doors and furniture interpreted from the source linework, light fixtures, materials, sky and a circular minimap) are implemented. Arena traversal on foot, glass-blocking and manual playtesting remain open. This is not yet declared PLAYABLE.

## Cloudflare Pages

The public production build is available at <https://moonshot-csgo.pages.dev/>. The Pages project is connected to the private `lloyd-c137/moonshot-csgo` GitHub repository: pushes to `main` build and deploy production, and other branches receive preview deployments. Cloudflare runs `npm run build` with `dist/` as the output directory and Node.js `24.16.0` (pinned in `.nvmrc`).

The repository owner explicitly approved public hosting of the FF-01 runtime GLB and curated room data on 2026-10-15. This remains an in-development game; deployment does not imply that unverified classroom/arena routes are playable.

## Shared world: frisbee play

Everyone who opens the game joins one shared campus (GAMEPLAY_AUTHORED, approved by the owner on 2026-10-15).

- **Play**: hold the left mouse button to charge and release to throw a frisbee; two body hits or one head hit eliminate a player, who respawns 2.5 s later at one of 24 spread corridor spawn points (`src/config/spawns.ts`, from `npm run spawns`). Damaged players heal after 10 s without a hit. Live standings show eliminations at top left; Tab opens the full round table.
- **Flight**: discs are Ammo rigid bodies that collide with the level only, steered by a two-coefficient flying-disc lift/drag model (`src/gameplay/frisbee.ts`), with continuous collision against walls.
- **Feedback**: synthesised Web Audio sounds (throw whoosh, bounces, hit confirmation, being hit, eliminations, respawn; other players' sounds positioned in 3D) plus two owner-supplied clips in `public/assets/audio/` (`defeat.mp3` when you are eliminated, `kill.mp3` when you eliminate someone); an in-hand disc that winds up while charging, FOV punch on release, hit markers, camera shake, knock-back and a damage-direction arc when hit, health pips, elimination broadcasts with streaks (双杀, N 连淘汰), in-world hit sparks (gold for headshots, a ring on eliminations), every headshot (contact more than 0.45 m above the target's centre) instantly eliminates the victim with explicit feedback, and the standing 淘汰王 is marked on the board and over their head. Players are protected for 1.5 s after spawning.
- **Smoothness**: the room stamps every pose with its receive time and clients draw others 130 ms behind an estimated server clock, so repeated or bunched snapshots no longer make players jerk; replayed discs are advanced by their age; at most 24 discs exist and settled ones are cleared; the first throw no longer pays for physics set-up.
- **Accounts and 淘汰王**: every player signs in with a username (2–16 characters) and a password (6–64); there is no guest entry. An unknown username is registered on the spot, a known one is logged in (`POST /api/signin`). Rooms with accounts refuse connections without a valid session. Passwords are stored as PBKDF2-SHA256 hashes (100k iterations, per-user salt) in the room's SQLite storage; sessions are 30-day random tokens kept in `localStorage`. Registered players' lifetime eliminations, hits, deaths and legacy points are preserved. The lifetime board shows eliminations and win rate (wins / completed participated rounds); wins and rounds are recorded from this update onward, never reconstructed from historical hits or kills. At the owner's request on 2026-10-16, all win-rate counters restart once (old counters backed up in server metadata). Before the first newly completed round, win rate displays 100%; from that first result onward it is the actual wins / completed rounds. Other account stats are preserved, and later restarts never repeat the reset. Participants who leave are still counted if the round finishes; pure spectators and rounds abandoned when the room empties are excluded. The 淘汰王 is the registered player with the most lifetime eliminations; the title stays on the start screen and in the HUD whether or not they are online, until someone strictly exceeds their count. `GET /api/king`, `/api/leaderboard`, `/api/me`; `POST /api/signin`, `/api/register`, `/api/login`, `/api/logout`.
- **Rounds and the 金飞盘**: a round lasts 10 minutes; the golden disc spawns at a random spawn point and its position (lying or carried) is shown all round on the minimap, the full map and an on-screen marker with distance. Walk onto it to take it (it replaces your disc, with its own inspect); an eliminated holder drops it. Whoever holds it when the clock runs out wins; a new round starts 10 s later. Eliminations score 1 point, hits none.
- **纪老师**: a resident discipline teacher patrols the ring corridor on a fixed schedule (route from `tools/patrolCli.ts`, GAMEPLAY_AUTHORED), with the 10 m circle he watches painted on the floor and on the maps; inside it a warning reads 禁止打飞盘, and throwing there means standing still for 4 s with a "室内不准打飞盘" warning.
- **Blackout and the night guard**: a guard stands at the south gate; with 3 minutes left the lights go out (night sky, indoor lights off) and he walks the outer corridors (route from `tools/patrolCli.ts guard`) with a flashlight (spot light and visible beam). Anyone in the beam with a clear line to the torch is out for the rest of the round and watches others (click to switch). From then on every elimination is final; when only one player is left standing they win at once. Golden-disc throws leave an ordinary disc only 35 % of the time; every elimination drops a disc where the player fell. R teleports to the 莲花球场. Stepping into 纪老师's circle means standing still for 4 s, throw or not (then a few seconds' grace to walk out).
- **Disc ammunition**: you carry at most 3 discs and start with all 3, refilled on every respawn. A thrown disc lies where it lands until someone walks over it; the PE office (S308 体育组) puts out a fresh disc every minute (up to 3 waiting there). The golden disc is never used up: its throws flash gold and it flies back to its holder; an elimination with it gets a gold kill banner.
- **监控室 (S103)**: walking in shows every player on the minimap and full map for 30 s.
- **配电室 (SVC-10)**: enter the west-side power room and press E beside the cabinet. One shared pull per round cuts campus lights; the guard walks over, restores power after roughly 35 s, then returns to his original post at roughly 67 s. Temporary outages preserve normal respawns; the final-three-minute night remains permanent. See [power-switch implementation and checks](docs/POWER_SWITCH.md).
- **Selected combat audio**: body/kill/head confirmations use video clips 10/12/16; golden eliminations use 06 split 01 (0.93 s), and ordinary/sniper releases use whoosh candidate 05 (1.26 s), all at gain 0.35 before the existing master. Only the five owner-authorized derivatives are published; see `public/assets/audio/combat-provenance.json`.
- **Latency**: round-trip time to the room, bottom left.
- **Sniper mode**: hold the throw button past a quick flick (0.18 s) and the view zooms in gradually (to 36 % of the field of view over 0.85 s) behind a scope overlay; mouse sensitivity and walking speed drop with the zoom, the in-hand disc drops out of view, and a lock click plus a red reticle mark **狙击就绪**. Releasing then throws a sniper disc: 34 m/s from the line of sight, flying dead straight (no drop or lift) for 1.6 s with a tracer. A sniper disc to the head eliminates outright (the room only honours the flag on a full-speed launch); the shooter gets a gold marker, bass-and-bell sound and a 狙击爆头 banner, the victim's view is thrown back. Right-click cancels. Aiming players show a gold scope glint at their visor to everyone else.
- **Weapon inspect**: press F with the disc in hand: cock the wrist, flick the disc up over the centre of view where it tumbles three times end over end and spins (with afterimages and a racing stripe so the spin reads), snap-catch it with a small view kick, show its face and settle. Synthesised flick, whirr and catch sounds; attacking cancels it.
- **Smoothness**: every gameplay visual (thrown and in-hand discs, inspect afterimages, hit sparks, other players) is drawn once behind the title screen so no shader compiles mid-game; HUD animations restart without forcing layout; the minimap repaints only when the view changes; poses carry the sender's clock so other players move evenly despite network jitter. Add `?fps=1` to the URL for a frame-time readout.
- **World chat**: press Enter (or T) in game to type; messages (≤120 characters, 4 per 6 s) reach everyone in the room immediately, and new 淘汰王 are announced there.
- **Server**: a Cloudflare Worker with one Durable Object room (`server/`), deployed at `wss://moonshot-csgo-multiplayer.lloyd666.workers.dev/ws`. Clients own their movement; the thrower's client detects hits and the room validates every claim (throw exists and is recent, one hit per disc, both players alive, target within reach of the throw and of the claimed contact point), then alone decides damage, eliminations and respawns. Only page origins on `moonshot-csgo.pages.dev` may connect; messages are size-checked and rate-limited.
- **Privacy**: no login; only the nickname the player types (or a random one) is shown. Nothing is stored: the room lives in memory and forgets everyone on disconnect; no addresses are logged by the game.
- **Offline**: without a reachable server (and always in `npm run dev` unless `?server=ws://127.0.0.1:8787/ws` is given) the game is single-player frisbee practice. `npm run server:dev` runs the room locally; the browser spec `tests/browser/multiplayer.spec.ts` plays a two-player round against it.
- **Known limits**: client-authoritative movement and thrower-side hit detection can be cheated by a modified client (claims are plausibility-checked, not simulated server-side); very slow clients (well under 10 FPS) may see hits rejected after the 8 s claim window. Deploy: `npm run server:deploy` (CI deploys from main when the Cloudflare secrets are set).

## Requirements

- Node.js `>=22.23.2` (bootstrap verified with Node `24.16.0` and npm `11.13.0`)
- npm

## Install and run

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally <http://localhost:5173>), wait for the four loading stages to finish, then click **进入校园**. Use WASD to walk, Shift to sprint, Space to jump, mouse to look, M for the full-floor map, Escape to pause, and R to return to the south entrance, the spawn (position and heading). Leaving the level (falling below Y = −3 m) returns the player there automatically. If movement keys are held for 2 s without progress (or the player sinks into the floor), a **脱离卡死** offer appears: press G (or click it when paused) to return to the spawn. A production build polls `/version.json` (written at build time with the Pages commit) every minute and offers a reload when a newer version is deployed; a room that rejects an outdated client does the same.

The top plate names the current location (room number, name, kind colour). There is no exploration log. Mouse sensitivity and field of view (pause menu) and the sign-in session are saved in the browser's local storage only.

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
- `src/world/dressing.ts` builds the `GAMEPLAY_AUTHORED` dressing: floor finishes per room kind (on the source room patches), a ceiling cut away over the open-air arena and courtyards by a derived mask, the arena perimeter wall (with collision), door lintels and open leaves, furniture (tables/counters collide), restroom partitions, court/stair markings and emissive light panels. Textures are procedural canvas textures (`src/render/textures.ts`), with no external image assets. Corridors (the slab outside room patches) use a glossy grey-blue epoxy finish after the owner's reference photo; room floors keep their per-kind finishes. Rendering uses 4× MSAA in the camera frame, and thin laid-on surfaces (markings, seams, wall paint, posters, plaques) use a depth bias so they do not z-fight or shimmer at a distance.
- `src/world/rooms/` holds photo-referenced `GAMEPLAY_AUTHORED` room interiors. `m104.ts` rebuilds M104 一小步空间 from photos of the real room supplied by the project owner, using geometry and flat colours only (no textures): an oak plank floor, frosted whiteboard glass on the long walls, lavender end walls with sticky notes and posters, a T-bar ceiling with linear LED pendants, a folding partition, bookcases, olive floor sofas, beanbags, a mobile TV, an armchair, height-adjustable desk clusters with chairs and desk clutter. Positions and sizes are read from photos and fitted to the source outline; they are not surveyed. `src/render/shapes.ts` provides the procedural shapes; `src/world/authoredRoom.ts` builds one mesh per material and one collider body. The derivation leaves authored rooms empty of generic furniture and lights. A second photo set fixed the orientation: the lounge (bookcases, sofas, TV) is at the west end and the workspace at the east end, with the folding-partition stack between the two north doors.
- `tools/signage.ts` derives one door sign per room (`world.json` → `signs`, 156 rooms; the two open-air courtyards and the open plant room SVC-31 have none): entrances are the wall gaps that a morphological closing of the wall raster seals between the room and the outside, preferring openings onto corridors. `src/world/signage.ts` builds them after the photographed M104 signs: a kraft blade sign with stencil lettering (code, Chinese name, English name) projecting from the wall beside the door at 2.22–2.84 m, and a red plaque at eye height on the other side of the door. Lettering is drawn into two canvas atlases at load time.
- `src/render/atmosphere.ts` sets ambient/sun light, ACES tone mapping, light bloom and vignette through the engine's upstream `CameraFrame` script, and a pool of 14 omni lights re-assigned to the light fixtures nearest the player. `src/render/sky.ts` draws an unlit gradient sky dome. SSAO is off: it blacked out whole distant wall faces in testing.
- `src/ui/shell.ts` + `src/ui/theme.css` are the whole UI (wayfinding-signage style): title/loading screen with staged progress and the floor plan as backdrop, HUD (location plate, crosshair, circular north-up minimap, key hints, toasts), full-floor map, and pause menu with settings. `src/ui/minimap.ts` draws both maps. `src/app/storage.ts` wraps optional local storage; `src/ui/settings.ts` persists settings. `src/app/debugHooks.ts` defines the development-only test hooks.
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
- PASS: browser tests cover the new UI flow (staged loading, 进入校园, location plate, M map toggle, pause menu, recovery toast, weapon inspect).
- PASS (visual, software WebGL screenshots only): ceilings indoors, sky above the arena and courtyards, 10 m arena wall, doors, furnished classrooms/labs/dining/library, UI screens at desktop and 390 px width. Real-GPU appearance and frame rate are NOT RUN.
- NOT RUN: glass blocking probe, corridor route to Lotus Arena, manual playtest, representative desktop performance benchmark.
- History: before these fixes the GitHub Actions browser job failed on every push from `feat: add FF01 exploration controls` onwards; the earlier S308/S309 PASS was observed only on a local GPU.

The source geometries remain unverified derivations from drawings; no source mesh or room polygon was modified. Barriers, the capsule size and anchor triggers are `GAMEPLAY_AUTHORED` overrides. The detailed checklist is in [docs/COLLISION_AUDIT.md](docs/COLLISION_AUDIT.md) and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## Combat audit

See [combat and audio audit](docs/COMBAT_AUDIT.md) for current validation gaps, prioritized feedback improvements, and licensed sound-library candidates.
