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
| Gameplay-controls browser smoke | PASS | Chromium: 4 passed; actual capsule height/centre/camera, FPS HUD, settings persistence, crouch rebinding and actual W→ArrowUp movement rebinding checked |
| Multiplayer browser slice | PASS | 4 passed, including two-client crouch/stand wire state and Full/Delta resync |
| Full browser suite | FAIL / NOT RELEASE-READY | Isolated-port run: 19 passed, 15 failed, 2 skipped. Failures include audio-lab dummy hits/execution, login fixture, campus room/movement assertions, and a long round-clock test. That run reused Wrangler persistence; a unique per-run Durable Object store was added afterward, but the full suite has not yet been rerun. Focused gameplay-controls is 4/4 and focused multiplayer cases pass. |
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

## Follow-up verification — 2026-10-20

Commit `b890b12` fixes authoritative respawn publication and stabilizes browser test setup. After respawn the room now restores the selected spawn pose and pose history before emitting the respawn event, so peers receive the player in snapshots immediately instead of waiting for a client acknowledgement. The browser account scenario now waits for the remote pose to converge before throwing.

- Lint, client/Worker typecheck, and `npm run build`: PASS.
- `node --test test/*.test.js`: 243 passed, 0 failed.
- Focused Chromium: account/combat flow passed; Full/Delta resync, remote crouch, and final entrance ceremony passed (3/3); global finisher and power-room flows passed (3/3).
- The campus-derived browser startup helper now accepts either the visible “continue” button or an already-ready app. A campus power-room test first exposed the hidden-button assumption; it passed after the helper fix.
- GitHub Actions for `b890b12` was in progress when this report was updated: [run 39360354532](https://github.com/lloyd-c137/moonshot-csgo/actions/runs/39360354532). This is not a CI PASS.

The safe multi-level gold-drop resolver and the broader release checklist remain incomplete. No production service or data was changed; production deployment remains blocked by those documented gates.
