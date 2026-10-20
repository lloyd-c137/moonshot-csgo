# Gameplay & Controls 2.0 — verification report

Date: 2026-10-20. Worktree: `msa-gameplay-main`, branch `feat/gameplay-controls-main`, based on `origin/perf/realtime-main` (`07aca7a`). Production deployment was not modified.

## Results

| Check | Result | Evidence |
|---|---|---|
| Unit / integration suite | PASS | `npm test`: 243 passed, 0 failed |
| Focused gameplay/network/input suite | PASS | 83 passed, 0 failed |
| TypeScript client + Worker | PASS | `npx tsc --noEmit -p .` and `npx tsc --noEmit -p server/tsconfig.json` exited 0 |
| ESLint | PASS | `npm run lint` exited 0 |
| Production build | PASS | `npm run build`; Vite + Wrangler compilation succeeded. Existing >500 kB chunk-size advisory remains. |
| Gameplay-controls browser smoke | PASS | Chromium: 3 passed; actual capsule height/centre/camera, FPS HUD, settings persistence and crouch rebinding checked |
| Multiplayer browser slice | PASS | 4 passed, including two-client crouch/stand wire state and Full/Delta resync |
| Full multiplayer browser suite | NOT PASS / NOT COMPLETED | A contaminated initial run hit another service on port 8787 and stale test clients; after isolated port and context cleanup, the complete suite was not rerun. |
| Full staged compatibility matrix | NOT MEASURED | No old/new server-client matrix was provisioned |
| Full spatial golden-drop matrix | FAIL / INCOMPLETE | Only elevated-anchor preservation is covered; no server walkable-surface index exists |
| Rendered crouch animation visual review | NOT MEASURED | The browser run verifies state synchronization but does not establish convincing crouch silhouette or animation coverage |

## Evidence artifacts

- FPS HUD screenshot: `test-results/gameplay-controls-fps.png` (captured in Chromium; HUD displayed at top right without overlapping the minimap).
- Keybinding screenshot: `test-results/gameplay-controls-keybindings.png` (crouch remapped from C to X).
- Multiplayer stance screenshot: `test-results/multiplayer-remote-crouch.png` (the standing/crouching wire state is independently asserted; screenshot is not accepted as clear animation proof).
- The local control test screenshot `test-results/gameplay-controls-crouched.png` captures first-person view only and is not evidence of remote avatar posture.

## NOT MEASURED / NOT PASS

No representative-device FPS/CPU comparison, no production-network or real-player evidence, no server-side multi-floor gold recovery, no clear rendered crouch animation review, and no full old/new protocol matrix. Full multiplayer browser E2E is incomplete. An existing Ammo.js scaled triangle mesh capability warning appeared in browser runs. These omissions block a production-ready PASS.
