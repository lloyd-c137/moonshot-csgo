# Gameplay & Controls 2.0 — verification report

Date: 2026-10-20. Worktree: `msa-gameplay-campus`, branch `feat/gameplay-controls-campus`, based on `origin/perf/realtime-campus` (`c82fc3b`). Production services and data were not modified.

## Results

| Check | Result | Evidence |
|---|---|---|
| Unit / integration suite | PASS | `npm test`: 251 passed, 0 failed |
| Focused gameplay/network/input suite | PASS | 85 passed, 0 failed |
| TypeScript client + Worker + Node | PASS | `npm run typecheck` exited 0 |
| ESLint | PASS | `npm run lint` exited 0 |
| Campus production bundle | PASS | `npm run campus:build`; Vite and Node 22 esbuild bundle completed |
| Cloudflare-compatible build | PASS | `npm run build`; Vite + Wrangler compilation succeeded |
| Campus control browser smoke | PASS | `MOONSHOT_TEST_VITE_PORT=5176 MOONSHOT_TEST_SERVER_PORT=8887 npx playwright test tests/browser/gameplay-controls.spec.ts`: 4 passed; Chromium exercised capsule height/centre/camera, FPS HUD, settings, crouch rebinding and real W→ArrowUp movement remapping |
| Real Node host WebSocket | PASS | `test/node-server.test.js` verifies two clients receive crouch/stand snapshot state; server HTTP/API, combat, origin and persistence checks also pass |
| Slow-client isolation | PASS (local simulated WS) | Three real `ws` clients: one slow reader, two healthy clients; 20Hz tick and combat/finisher exercised. Healthy ping RTT samples [1,1,1,1,1] ms; Tick drift P95 1.73ms, P99 3.86ms, max 15.60ms; tick duration P95 0.752ms, max 6.47ms; event-loop delay P95 21.41ms, max 41.68ms; SQLite op P95 0.297ms; max bufferedAmount 5,360 bytes; 37 coalesced snapshots, one slow connection isolated. Local test evidence only, not real network evidence. |
| Full browser suite | NOT MEASURED / INVALID FIRST RUN | An initial 36-test run reused another worktree’s Vite service and is discarded; after per-worktree frontend/backend ports and unique Wrangler state were introduced, only the 4-case controls suite was rerun. Do not infer cinematic or all-game E2E coverage. |
| Full staged compatibility matrix | NOT MEASURED | No old/new client-server matrix was provisioned |
| Full spatial golden-drop matrix | FAIL / INCOMPLETE | Elevated anchor preservation is covered; no authoritative walkable-surface index or multi-level recovery exists |
| Rendered crouch animation visual review | NOT MEASURED | Network stance state is tested, but no clear visual crouch acceptance evidence across avatar animation states |

## Relevant tests

The campus Node-host test runs real WebSocket clients against the Node server and confirms crouch-only state changes are delivered. The Worker room suite covers validated/rate-limited stance, stance-aware Full/Delta encoding, reconnect state, historical combat stance and elevated gold anchor preservation.

The test harness now owns its Vite/Worker ports and uses a fresh per-run Wrangler Durable Object store to avoid stale accounts/rounds and cross-worktree service reuse. The slow-client measurement above came from an in-process localhost load test with real `ws` sockets. RTT is the test's local ping measurement and must not be represented as public-network latency.

## NOT MEASURED / NOT PASS

No production-network or real-player evidence, no multi-floor server collision/recovery proof, no clear rendered crouch animation review, no old/new protocol matrix, and no full multiplayer browser suite result are available. Main-thread SQLite is still synchronous; this run did not establish it as a source of a user-visible stall, and no database worker migration was performed. An existing Ammo.js scaled triangle mesh capability warning appeared in browser runs. These omissions prevent a production-ready PASS.

## Follow-up verification — 2026-10-20

Commit `0d7100a` fixes authoritative respawn publication and stabilizes browser test setup. After respawn the room restores the selected spawn pose and pose history before emitting the respawn event, so peers receive the player in snapshots immediately instead of waiting for a client acknowledgement. The browser account scenario now waits for the remote pose to converge before throwing.

- Lint, client/Worker/Node typecheck, Cloudflare build, and `npm run campus:build`: PASS.
- `node --test test/*.test.js`: PASS, including Node HTTP/API, account persistence, and local real-WebSocket slow-client isolation.
- Focused Chromium: account/combat flow passed; Full/Delta resync, remote crouch, and final entrance ceremony passed (3/3); global finisher and power-room flows passed (3/3 after correcting the hidden-button startup assumption).
- The campus power-room test first exposed that the shared browser helper assumed the “continue” button must be visible even when the app was already ready. The helper now waits for either the visible button or ready state; the failing test passed on rerun.
- GitHub Actions for `0d7100a` was in progress when this report was updated: [run 39360362105](https://github.com/lloyd-c137/moonshot-csgo/actions/runs/39360362105). This is not a CI PASS.

The safe multi-level gold-drop resolver and the broader release checklist remain incomplete. No production service or data was changed; production deployment remains blocked by those documented gates.
