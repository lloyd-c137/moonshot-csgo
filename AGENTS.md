# AGENTS.md — Moonshot Open World

> Binding engineering instructions for coding agents working in this repository. Read this file **before** modifying the project. Read [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the authoritative roadmap.
>
> State as of 2026-10-15: **M0.1–M0.4 in progress** (scene, collision, controls, room HUD and browser tests exist; see README "Verification state"). No milestone, asset, test or performance result may be claimed as complete merely because it is described here.

## 1. Mission and operating mode

Build a browser-playable, first-person, single-player exploration game based on the Moonshot Academy FF-01 campus export. Preserve the campus geometry and spatial identity; create a game, not a conventional map viewer or administrative dashboard.

- Prioritize **a playable vertical slice**: load the FF-01 model, enter at a safe spawn, walk/sprint/jump/look around, collide correctly, enter rooms and see their identity.
- Favor adopting and adapting **mature upstream open-source implementations** over recreating movement, physics, loaders, or scene fundamentals.
- Ship one verifiable milestone at a time. Make the smallest complete change that satisfies the current milestone.
- Keep the game immediately usable offline after local assets have been obtained; do not make campus sensor APIs, authentication, hosted services, or multiplayer a prerequisite.
- Do not introduce React, a second physics engine, a backend, or a custom ECS without a documented architectural reason and approval.

## 2. Canonical stack

- Runtime: **PlayCanvas Engine**, code-first **TypeScript**, **Vite**, targeting desktop browsers first.
- Bootstrap: official [create-playcanvas](https://github.com/playcanvas/create-playcanvas), **Engine** format, **First-Person Controller** starter. The starter must be scaffolded into a temporary **new directory** and merged selectively into this repository.
- Player: reuse the upstream first-person controller and its configured physics capsule, movement, camera, pointer lock, sprint and jump. Extend rather than rewrite.
- Physics: PlayCanvas **Ammo.js**, initialized and verified before the player becomes controllable. Verify production bundling/hosting of WASM/glue/fallback assets; do not assume physics works because rendering works.
- Scene: import the original glTF 2.0 **GLB** via PlayCanvas container asset handling.
- UI: minimal DOM/CSS overlay. Rendering and gameplay logic remain framework-agnostic.
- Model tooling: Blender and optional glTF-Transform, with a reversible, documented asset pipeline.
- Testing: TypeScript checks + lint + production build + unit tests for pure world geometry/data + browser smoke tests. Add scripts and a CI workflow during M0; never report an unrun check as PASS.
- Multiplayer (Colyseus), NPC navigation (Recast/NavMesh), and advanced visual effects are **deferred**, not current dependencies.

## 3. Source-of-truth and factual integrity

Input package: **MAC_Campus_FF01_3D_Export.zip** supplied separately, not currently committed to this repository. Expected version: **FF01-CAMPUS-3D-V1**. Its embedded status is **SOURCE_DERIVED_3D_UNVERIFIED**.

Canonical inputs inside the archive:
- models/MAC_Campus_FF01.glb — immutable visual source.
- data/rooms.json — authoritative imported room records.
- data/source/ff01-campus-core.json and ff01-campus-detail.json — optional geometry/detail source for further processing.
- reference/FF-01_source_plan.png — visual alignment only, not a new measured survey.
- README.md inside the archive — provenance, coordinate documentation, limitations.

Verified archive facts: 165 room/space records, of which **159 have inferred region polygons** and **6 are label-only**. The room JSON wraps data under a top-level **rooms** array; each polygon uses **polygon.outer** and may include holes. Do not confuse it with a flat room array or the differently shaped core JSON.

Coordinate contract:
- **Metres**. Preserve root scale **(1, 1, 1)** unless a documented calibration test disproves it.
- 3D: **X east, Y up, Z south**, hence **−Z north**.
- 2D source records: **X east and Y north**; map 2D northing to **−Z**.
- Floor top at **Y = 0**, source slab extends toward **Y = −0.3**.
- Do not add hardcoded coordinate flips or arbitrary centering offsets. Any transform must be a named, tested import adapter.
- All wall/glass heights, seating elevations, room boundaries and access records are **illustrative or inferred**, NOT field-verified. Never describe them as measured reality.

Preserve original input files as immutable data. Derived render assets, collider assets and gameplay decorations live separately, with versions, hashes, and provenance. Do not silently edit spatial geometry to fix gameplay; record changes as overrides and test them.

## 4. Hard architecture boundaries

Recommended module ownership once code exists:

| Module | Owns | Must not own |
| --- | --- | --- |
| src/app | Boot, lifecycle, failure UI | Level geometry or movement algorithms |
| src/world | GLB loading, transforms, room lookup | Player input or DOM layout |
| src/physics | Collision layers, collider creation, physics readiness | UI state |
| src/player | First-person controller integration, spawn, reset | Building source data |
| src/gameplay | Interactions, discoverable locations, event dispatch | Raw GLB parsing |
| src/ui | Crosshair, room HUD, loading/errors, settings | Game physics |
| src/config | Spawn candidates, tuning parameters, manifest schemas | Secret credentials |
| tools | Offline input validation and derived asset generation | Browser runtime logic |
| tests | Unit/integration/smoke validations | Production behavior |

Rules:
1. **Language Boundary**: TypeScript is the only application/gameplay logic language. Python/Blender may be used for **offline asset conversion only**. Do not duplicate gameplay or world-state logic in Python and TS.
2. Distinguish three layers: **visual meshes**, **physics colliders**, and **semantic room/trigger regions**. Never make every GLB mesh collide automatically.
3. GLB hierarchy and named semantic IDs must survive optimization. Do not flatten/merge meshes if that destroys collision classification, room mapping, or debugging.
4. Room detection is a pure, testable X/Z point-in-polygon-with-holes function with explicit boundary/overlap handling. The 6 label-only spaces require separate trigger-volume candidates or return unknown; **never invent polygons**.
5. Game interaction data is additive. Authored doors/furniture/quests are **GAMEPLAY_AUTHORED**, not verified geometry. Retain origin IDs and statuses.
6. Lazy-load optional world decorations. Define dispose/unload behavior for GPU assets and physics bodies.
7. No runtime fetching of the existing MAC sensor endpoint. Do not include campus-config sensor URLs or live environment/occupancy demo values in the public build.
8. For a new external dependency, record its purpose, maintainer, version, license, and replacement cost in a PR.

## 5. Collision and player safety rules

- Use **static simplified collision shapes** for floors and straightforward walls where possible. Use static triangle meshes selectively for concave structure, actual door apertures, stairs/stands; never use dynamic triangle-mesh physics for moving objects.
- Exclude floor plan decorative lines, room color surfaces, labels, and other non-solid helpers from collision.
- Doors must pass the capsule-width clearance test and must never be accidentally sealed by a collider. Test glass partitions explicitly.
- Camera and capsule positions are separately configured; avoid camera clipping through walls and near-plane clipping.
- Spawn requires a verified clear floor/support surface and capsule headroom. Add a safe fallback/reset action for falling out of bounds or getting stuck.
- Gate gameplay on **asset readiness AND physics readiness AND collider readiness**, with visible recoverable errors.
- Input should not be captured until the user initiates play. Escape releases pointer lock; page visibility loss pauses/clears movement input.
- Target **keyboard + mouse on desktop** for M0. Mobile/controller may be supported by the upstream starter but are not accepted as tested without device checks.

## 6. Privacy, licensing and publication

This is a real-campus-derived asset, not a fictional generic level.
- The repository is currently **private**; privacy is not equivalent to permission to publicly distribute original plans.
- Before uploading any GLB, floor plan, original metadata, source files, or room access details, review whether they reveal restricted room locations, security-sensitive details, student/staff information, private metadata, or unlicensed source material. **Do not automatically commit the entire ZIP**.
- Do not invent or leak personal information; no player tracking, cameras, credentials, real-time room occupancy or sensor data in M0.
- Public release requires explicit review of assets, copyright/third-party attribution and sensitive-space redaction. Use curated derivatives if necessary.
- Respect third-party licenses and preserve required notices. Engine and starter licenses do not grant rights to separately sourced textures or campus plans.
- Do not add secrets, private API endpoints, analytics trackers or remote telemetry by default.

## 7. Milestone order (do not skip gates)

- **M0.0 — Bootstrap**: scaffold official engine FPS starter in temp dir, copy without overwriting planning files; install, run unchanged, inspect upstream docs. Verify development and production builds.
- **M0.1 — Scene**: load exact FF01 GLB with real scale/orientation, proper loading/error states and reproducible asset mapping.
- **M0.2 — Physics/controls**: initialization gating, static colliders, spawn, pointer lock, walk/sprint/jump, solid doors/walls/floors and safe recovery.
- **M0.3 — Semantics**: parse rooms.json, handle polygons + holes + missing regions; display current room, make an initial discovery trigger.
- **M0.4 — Hardening**: browser acceptance route, unit/smoke tests, profiling, asset verification, reproducible deploy preview.
- **M1 — World presentation**: authored decorations, material/lighting/audio, starting with a **single polished area**.
- **M2 — Exploration gameplay**: interactables, discoverables, save/load schema, accessibility.
- **M3 — Social/multiplayer (only after approved)**: server-authoritative synchronization and abuse/privacy design.

Detailed acceptance tests, performance targets and risks: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

## 8. Mandatory agent workflow

Before each change:
1. Inspect repository state and the nearest AGENTS.md. Read the current implementation plan and actual source asset README if available.
2. State the **current milestone**, its acceptance criteria, the source files to be changed and exact test commands.
3. Check upstream PlayCanvas starter/scripts/docs **before** implementing a comparable system manually.
4. Make a small, reviewable implementation. Preserve public/semantics-facing APIs and original geometry.
5. Run existing checks; at minimum build and typecheck, then targeted tests and a browser/manual acceptance path appropriate to the milestone.
6. Report **PASS / FAIL / BLOCKED / NOT RUN** per check, with concrete evidence. Do not use fabricated FPS, build success, screenshots or playtests.
7. Summarize files changed, remaining risks, and **the single next recommended milestone**.

When an asset/package is missing: mark it **BLOCKED_ASSET**; provide exact filename, expected hash, import destination and fallback development fixture. Do not generate a fake replica and claim it is the real campus.

For unresolved source ambiguity: annotate **SOURCE_UNVERIFIED**. For added game content: annotate **GAMEPLAY_AUTHORED**. No fictional facts presented as verified real-world campus facts.

## 9. Definition of done: first playable slice

M0 is complete only when: FF01 GLB is loading; a player can move, sprint, jump and look using mouse; real-scale wall/floor/glass/stand collisions work; at least a validated safe route between spawn and arena exists; several tested doorways remain traversable; the 159 region records and 6 unknowns behave correctly; room HUD updates; Escape and recovery work; visible load failures are actionable; production build passes and browser smoke/manual tests are recorded. No backend or multiplayer required.

**Never equate a successful npm build with a playable game.**

## 10. Authoritative references

- PlayCanvas create project: https://github.com/playcanvas/create-playcanvas
- PlayCanvas getting started: https://developer.playcanvas.com/user-manual/getting-started/start-with-create-playcanvas/
- First-person controller supplied by engine: https://github.com/playcanvas/engine/blob/main/scripts/esm/first-person-controller.mjs
- PlayCanvas physics setup: https://developer.playcanvas.com/user-manual/physics/physics-basics/
- Model loading: https://developer.playcanvas.com/user-manual/web-components/loading-models/
- Model optimization: https://gltf-transform.dev/cli

This file sets repository engineering policy. It does not declare any milestone completed.
