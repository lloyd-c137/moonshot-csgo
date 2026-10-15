# FF-01 collision audit

**Status: in progress.** This audit records runtime evidence, not source-plan certainty. The GLB and room boundaries remain `SOURCE_DERIVED_3D_UNVERIFIED`.

## Collision source groups

The PlayCanvas runtime creates 13 static triangle-mesh bodies from source entities:

- `Floor_Slab`
- `Walls`
- `Glazing`
- `Arena_Court`
- `Arena_StandBase`
- `Arena_Seats_Row00` through `Arena_Seats_Row07`

`Walls_Top` contains top-face/poché surfaces and is not used as a collider. Room color patches, `FloorLines` and `LabelAnchors` are hidden and have no collision. No source geometry was changed. The 13 bodies are static; no seat body is dynamic.

## Authored barriers (`GAMEPLAY_AUTHORED`)

One additional static, unrendered triangle-mesh body (`GameplayAuthored_Barriers`, 9,708 vertical quads) is derived at load time from the source meshes by `src/physics/boundaryBarriers.ts`. Source meshes are only read.

| Barrier | Source | Height | Reason |
| --- | --- | --- | --- |
| Floor-slab outline | Boundary edges of the `Floor_Slab` top face (Y = 0) | 0 → 6 m | 32 reachable slab edges have no source wall, including the east, west and south entrances (≈45 m in total). The player walked off the east entrance and fell indefinitely. |
| Wall-top outline | Boundary edges of `Walls_Top` (Y = 2.8 m) | 2.8 → 6 m | The top seat row is 3.11 m high and 0.32 m from a 2.8 m wall. Jumping row to row, the player could step over the wall into the neighbouring room. |
| Glazing-top outline | Boundary edges of the `Glazing` top faces (Y = 2.58 m) | 2.58 → 6 m | Same elevated-escape risk over glass. |

Barriers are a game boundary decision, not modelled doors or glass. Entrances read as invisible walls until authored doors or exterior ground exist.

## Presentation adapter and authored colliders

- The source `Walls`, `Walls_Top` and `Glazing` entities are scaled vertically by 3.6 / 2.8 before colliders are built (`src/world/presentation.ts`). Ammo logs that its build lacks `btScaledBvhTriangleMeshShape`; browser raycasts nevertheless hit `Walls` at 3.3 m and not at 3.75 m, so the scale is applied at collider creation. Rescaling at runtime is not supported and is not done.
- `GameplayAuthored_ArenaWallCollider`: the 10 m arena perimeter wall along the derived arena outline (from 3.55 m), static mesh. Raycast at 8 m hits it.
- `GameplayAuthored_FurnitureColliders`: tables and counters (≥0.7 m) from the derived furniture, static mesh. Seats, door leaves, lintels and partitions are visual only. With furniture rasterised into the static audit, reachable floor drops from 10,464 m² to 10,383 m² and the reachable room set is unchanged (145/159).

## Player capsule

The capsule radius is 0.28 m (height 1.8 m), down from 0.34 m. The static audit showed 14 source door gaps between 0.56 m and 0.68 m wide, including S308 and S309: a 0.68 m capsule could only pass them by penetrating the wall mesh. These widths come from the unverified 2D-derived walls, not from measured doors.

## Static navigation audit

`tools/navAudit.ts` (run by `npm test` and `npm run audit:nav`) rasterises walls, glazing, stands and barriers at body height (0.25–1.85 m) on a 5 cm X/Z grid, inflates them by the capsule radius and flood-fills from the spawn. It is a conservative approximation of the Ammo capsule, not a physics simulation.

| Configuration | Reachable source regions | Reachable floor ending at open edge |
| --- | --- | --- |
| r = 0.34 m, no barriers (previous) | 132 / 159 (several only by falling out first) | 1,268 m² |
| r = 0.34 m, barriers | 131 / 159 | 0 |
| r = 0.28 m, barriers (current) | 145 / 159 | 0 |

At stand height (capsule on the 3.11 m top row), the reachable area over wall or glazing tops falls from 2,117 m² without barriers to 0 with them.

Still unreachable at r = 0.28 m: `A203`, `M124`, `SVC-03`, `SVC-15` (source gaps 0.30–0.55 m) and `A106`, `S204`, `S205`, `S206`, `S207`, `S406`, `SVC-01`, `SVC-05`, `SVC-11`, `COURTYARD-02` (no gap in the source walls at any radius). Opening them requires reviewed `GAMEPLAY_AUTHORED` door overrides; the test locks this list so that it can only shrink.

## Spawn probe

Candidate: `[50.85, 0.92, -2.86]` metres, at the source label anchor of the label-only east entrance. At boot, PlayCanvas Ammo raycasts require floor support from `Floor_Slab` or `Arena_Court`; five vertical capsule-clearance samples (centre and ±0.8 × radius) must have no obstruction through 2.15 m. The candidate passes both checks.

## Runtime checks

Browser checks run on Playwright's virtual clock with drawing disabled (see README), in headless Chromium with software WebGL.

| Test | Expected | Actual | State |
| --- | --- | --- | --- |
| Spawn support ray | Hits floor or court | Hits source floor mesh | PASS |
| Spawn headroom samples | No solid obstruction | Clear at five points across capsule footprint | PASS |
| WASD displacement | Player moves while locked | >0.8 m in 0.5 s simulated | PASS |
| Sprint | Faster than walking | >1.25 × walking distance | PASS |
| Jump and land | Rise and return to supported floor | Rise >0.2 m, lands at 0.72–1.1 m | PASS |
| Pointer look event | Camera changes rotation while pointer locked | Standard mouse `PointerEvent` with movement delta changes yaw | PASS (event path) |
| Hardware mouse look | Camera follows physical mouse movement | Not manually playtested | NOT RUN |
| Solid wall stop | Capsule cannot pass through | East-entry corridor walk stops at X≈21.3 m | PASS |
| Open east entrance | Player cannot leave the slab | 15 s walking east stops at 65 < X < 67.5 m, Y stays on floor | PASS |
| Top seat row over wall | Player cannot cross the 2.8 m wall | Barrier on: stays at X≈−30.6 m. Control run with barrier disabled: crossed to X≈−33.3 m and dropped into the next space | PASS |
| Automatic fall recovery | Out-of-level player returns to spawn | Placed at X = 80 m; recovered once to spawn, toast shown | PASS |
| S308 doorway | Opening traversable by capsule | Waypoint route enters S308; room HUD changes | PASS |
| S308 to S309 route | Connected corridor/room traversal | Waypoint route enters S309; room HUD changes | PASS |
| Glass stop | Capsule cannot pass through glazing | No named in-game probe has yet been exercised | NOT RUN |
| Third doorway passage | Three openings traversable by capsule | Two verified (S308, S309) | NOT RUN |
| Spawn-to-arena route | Continuous walkable path | Static audit reaches the court; no browser route yet | NOT RUN |
| Arena stands/seats | Traversable where intended; no trapping | Jump onto top row verified only as a barrier test | NOT RUN |

The next collision checks are a glass probe, a browser route to the arena court, and reviewed door overrides for the 14 unreachable rooms.
