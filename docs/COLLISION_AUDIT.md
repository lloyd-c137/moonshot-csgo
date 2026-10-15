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

## Spawn probe

Candidate: `[50.85, 0.92, -2.86]` metres, near the source's label-only east entrance point. At boot, PlayCanvas Ammo raycasts require floor support from `Floor_Slab` or `Arena_Court`; five vertical capsule-clearance samples must have no obstruction through 2.15 m. The candidate passes both checks. A browser control test moved the player north from this position without falling. This does not yet prove a verified corridor route from the entrance.

## Runtime checks completed

| Test | Expected | Actual | State |
| --- | --- | --- | --- |
| Spawn support ray | Hits floor or court | Hits source floor mesh | PASS |
| Spawn headroom samples | No solid obstruction | Clear at five points across capsule footprint | PASS |
| WASD displacement | Player moves while locked | Browser test observed >0.8 m displacement | PASS |
| Jump and land | Rise and return to supported floor | Browser test verified rise and grounded-height recovery | PASS |
| Solid wall stop | Capsule cannot pass through | East-entry corridor walk stopped at X≈21.4 m against source wall | PASS |
| S308 doorway | Opening traversable by capsule | From the observed corridor stop, walked north and west into S308; room HUD changed | PASS |
| S308 to S309 route | Connected corridor/room traversal | Walked east, north, west and southwest around the source geometry; room HUD changed to S309 | PASS |
| Glass stop | Capsule cannot pass through glazing | No named in-game probe has yet been exercised | NOT RUN |
| Three doorway passages | Three openings traversable by capsule | One doorway passage has been named and verified; two more remain | NOT RUN |
| Spawn-to-classroom-to-arena route | Continuous walkable path | Corridor, S308 and S309 path verified; accessible classroom and arena not yet reached | NOT RUN |
| Arena stands/seats | Traversable where intended; no trapping | Static colliders exist; traversal not yet tested | NOT RUN |

The next collision check is to exercise identified glazing, find two additional source door openings, and trace the arena approach through the source geometry with the actual capsule. Do not treat polygon proximity as proof that an opening is physically accessible.
