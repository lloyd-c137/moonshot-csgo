# Gameplay & Controls 2.0 — implementation record

Status: feature work in progress on `feat/gameplay-controls-campus`, based on `perf/realtime-campus`. This document records implemented code and known gaps; it is not a release approval.

## Scope and architecture

This branch adds a persistent FPS preference/HUD, an action-based keyboard/mouse input layer, physical local crouching, crouch presentation for avatars, and optional crouch state in network poses and historical hit validation. Protocol version stays at 15; the new pose property is optional. `crouch-v1` is negotiated so an online client does not lower its collision body when the server has not announced support. Offline play can use local crouch.

`InputManager` translates physical `KeyboardEvent.code` / mouse button state into named actions and press/release edges. The PlayCanvas 2.23.2 keyboard source is adapted in place for remapped movement axes; mouse look and existing gamepad/mobile paths remain with the engine controller. Gameplay listeners query actions for their bound controls. Blur, hidden-page and pointer-lock loss release held actions. The settings page validates and persists bindings, rejects reserved browser/system keys, offers explicit conflict swap, single-action reset and reset-all.

The current input layer is a shared state source, not a complete centralized context router. Menus, cutscenes, chat, execution and spectator handlers still enforce some context gates at their owners. Escape/pause and browser system shortcuts are intentionally not remappable. That is a known gap against the full context-priority target.

## Input inventory

| Action | Default | Source | Context / interaction | Remappable |
|---|---|---|---|---|
| Move forward/back, strafe left/right | W/S/A/D | `src/input/controllerAdapter.ts` | Gameplay, held axes | Yes |
| Sprint | Left Shift | controller adapter / match | Gameplay, held; disabled while crouched | Yes |
| Jump | Space | controller adapter / crouch controller | Gameplay, press; disabled while crouched | Yes |
| Crouch | C | `src/player/crouch.ts`, match | Gameplay, hold by default; optional toggle | Yes |
| Charge / throw | Mouse 1 | `src/gameplay/match.ts` | Hold to charge, release throws | Yes |
| Cancel throw | Mouse 2 | match | Press | Yes |
| Spectator next | Mouse 1 | match | Spectator context; context-safe sharing with throw | Yes |
| Inspect disc | F | match | Press | Yes |
| Interact / breaker | E | match | Press; contextual prompt | Yes |
| Execute | V | match | Hold / release protocol | Yes |
| Active skill | Enter | match | Press, gameplay-only | Yes |
| Chat | T | match / shell | Open then text entry | Yes |
| Map | M | match / shell | Toggle | Yes |
| Scoreboard | Tab | match | Hold / release | Yes |
| Recover | R | match | Press | Yes |
| Unstuck | G | match | Press | Yes |
| Emotes 1–3 | 1/2/3 | match | Press | Yes |
| Skip cutscene | Space | `src/gameplay/intro.ts` | Press; context-safe sharing with jump | Yes |
| Pause / settings | Escape | shell/main | Toggle and pointer-lock release | No |
| Audio lab shortcut | P / F8 | `src/ui/audioLab.ts` | Audio test utility only | No |
| Click to enter / pointer lock | Mouse 1 | shell / browser | Start interaction; browser API | No |
| Mouse look | Mouse movement | PlayCanvas controller | Pointer-locked gameplay | Sensitivity setting |

The table is derived from current code paths; mobile/controller behavior has not been device-tested in this work.

## FPS HUD

`src/main.ts` samples a monotonic `performance.now()` interval for each rendered frame and updates the DOM at roughly 500 ms cadence. A long pause is treated as a new sample window. The HUD reports average measured FPS and frame interval, lives at the upper right, and follows `showFps`. The setting defaults on, persists in the existing settings record, and `?fps=1` remains a debug force-on alias.

## Crouch physics and presentation

`CrouchController` changes the PlayCanvas capsule height from 1.8 m to 1.2 m while preserving the foot position by lowering the rigidbody centre by 0.3 m. It keeps linear velocity, checks ground support before entering, and checks nine upward clearance probes around the capsule before standing. If clearance fails it retains the crouched shape and camera offset. Camera height transitions from 0.66 m to 0.43 m over 150 ms; horizontal speed is 55%; sprint and jump are blocked. Hold is default, toggle is configurable.

Remote poses drive a procedural crouch pose on existing character bones. The source GLB has no crouch animation clip. The implementation blends hip/leg/spine offsets while preserving the running animation's current local joint rotations. Visual fidelity, animation-priority interactions, and foot planting still require rendered review.

## Network and hit validation

`PlayerPose.crouched` is optional; omitted means standing. The server rejects non-boolean values and rate-limits stance changes. Snapshot Full/Delta pose data includes stance; crouch-only changes are considered a pose change. The client enables networked posture only when the server advertises `crouch-v1`, otherwise online collision remains standing. Pose history stores discrete stance along with position and uses the stance at the rewound hit timestamp. Server and client collision geometry use shorter crouched body/head thresholds.

This remains client-reported movement with server validation, not server-authoritative physics. No staged old-client/new-server live compatibility matrix has been run. The branch keeps protocol version 15 and adds optional data, but production compatibility is not approved by this document.

## Golden disc drop finding and limitation

The previous `dropGold()` forced the vertical coordinate to 0.92 m. It now preserves the latest server-accepted carrier capsule-centre pose, falling back to the prior gold anchor; ordinary death drops use the crouched/standing centre-to-foot offset. A regression test verifies that a carrier on an elevated authored stand does not have the drop flattened to first-floor height.

This is a narrow correction, not the requested safe-surface resolver. The Cloudflare room has no PlayCanvas/Ammo world and there is no authoritative multi-level walkable-surface index in the server bundle. A preserved pose can still be airborne, embedded, outside bounds, or above an inaccessible surface. The existing horizontal/vertical pickup tolerances can still confuse overlapping floors. Therefore gold safe-drop/recovery is **not complete**, and no automatic relocation is implemented. Do not deploy this code as proof that every drop is reachable.

## Tests and boundaries

Relevant checks are listed in `GAMEPLAY_CONTROLS_TEST_REPORT.md`. This branch currently covers capsule geometry and reconnect/network data with unit tests plus a browser smoke for local physical capsule changes, FPS display/settings, and remapping crouch. It does not yet prove every spatial drop case, all movement remaps, blocked-ceiling physics under the real campus mesh, all animation priorities, or the complete two-client gameplay matrix.
