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

## Follow-up remediation — 2026-10-20

This follow-up corrected concrete omissions that the earlier report had only called out as release blockers:

- `tools/goldDropSurfacesCli.ts` derives 18,980 server drop anchors from the FF-01 source floor audit and the same authored arena stand/stair/bowl collision meshes used by the runtime. 7,835 anchors are elevated. Base samples must pass reachability and inflated capsule-clearance checks; raised samples require upward collision support across the capsule footprint. `Room.dropGold()` now selects by both X/Z and Y and relocates unsupported positions to a nearby indexed anchor, then to the audited spawn if none is close. It does not change pickup distance or delay.
- `PoseBuffer.sample()` had been dropping `crouched` while reconstructing interpolated poses. A raw network snapshot showed crouch, while the remote avatar stayed standing. Stance now switches discretely at the authoritative pose sample; this is covered by a unit test and a two-client browser assertion against the remote skeletal joint rotations.
- `CharacterAssetLoader.setCrouch()` multiplied the full posture rotation onto the prior frame every call. It now removes the prior overlay before applying the new blend. A 300-frame quaternion regression test checks no accumulated bend and return to neutral.
- `INPUT_ACTION_MATRIX` and `test/input-coverage.test.js` cover every registered action, default binding, dispatch consumer, context and press/hold semantics. Intro skip and chat no longer have hard-coded Enter fallbacks that bypass remapping. Browser coverage now checks all rows, live hint update, explicit conflict swap and reset persistence.
- `canUseCrouch()` and `test/crouch-compatibility.test.js` cover offline, new/new, new-client/old-server capability absence, and an old standing-pose payload accepted by the new server. This is a contract/harness matrix, not a deployed old-server wire test.

Verification in this follow-up:

- `npx tsc --noEmit -p .`, `npx tsc --noEmit -p server/tsconfig.json`, and `npx eslint src test server tools tests/browser`: PASS.
- Focused Node suite: 47 passed, 0 failed before the final whole-suite run.
- Focused Chromium: 6 passed. This includes a real Ammo ceiling fixture, physically supported raised arena drop anchor, all-action settings/conflict UI, and real two-client remote crouch skeletal pose/standing restoration. The browser console still reports the known Ammo build limitation for scaled mesh colliders.
- Full Node suite: 253 tests, 252 passed, 1 obsolete exact-position assertion failed because safe resolution correctly relocates the test drop by 0.42 m. The assertion now checks the actual safe resolver result; a fresh full run is pending.
- Full Chromium suite: running now; no result is claimed until it exits.

Still not proven: every elevated anchor's headroom/reachability by exhaustive physics traversal; every crouch state/animation transition (walk, sprint, throw, hit, death, finisher, spectator); physical old-client/new-server and new-client/old-server against actual older binaries; the entire input context/system-shortcut/IME matrix; full browser E2E on campus Node hosting; human feel acceptance. Production and campus services remain unchanged.

## Follow-up diagnostics and fixes — 2026-10-20

The prior handoff left the above gates open because it relied on unit contracts and a single raised-anchor check. It did not run the complete browser suite; it also missed that `PoseBuffer.sample()` discarded the crouch flag and that the input coverage table did not test every action's real press/hold/release lifecycle. Those are verification gaps, not completed features.

- Generated gold-drop support data now has 18,980 candidate capsule-centre anchors, including 7,835 elevated samples. The real Chromium/Ammo test settled a player at four separate arena heights and raycast support at every height. This verifies those four scene samples; it does not prove every generated point is clear/reachable or cover all campus elevations and pickup occlusion.
- Actual Ammo low-ceiling browser test confirms crouching fits and stand-up stays blocked until clearance returns. Unit tests cover support and capsule-perimeter clearance. Full traversal across all campus furniture, stairs, death/respawn and cutscene states remains open.
- A two-client browser test verifies the remote stance transitions, checks six rig joints change and restore, and captures `test-results/multiplayer-remote-crouch.png`. The source GLB has no authored crouch clips; the current joint overlay is visible in the capture but still needs a close human animation/prop/nameplate review across locomotion and finisher states.
- Every registered Action now has a runtime `InputManager` press/hold/release test, plus UI remap/conflict/reset browser coverage. A real bug found during this audit swallowed an immediate long-press after a short execute tap; the retry guard now resets on the cancelled short tap. The focused browser regression for that flow passes. Browser-wide chat/menu/IME/system-shortcut combinations are still not exhaustive.
- Compatibility contracts cover new client with a capability-less server, new server with a legacy standing pose, and new/new capability. No old binary was available, so actual old/new build pairing remains NOT MEASURED.
- Full main Chromium run: **27 passed, 11 failed, 2 skipped**. Failures included offline practice dummy height/respawn assertions, campus location/navigation tolerances, one multiplayer hit prediction and the long V0.26 visual flow. After that run, the execute retry bug was fixed and its specific browser test now passes; the respawn expectation was corrected to the configured 3/3 target health. The full suite was not rerun after those last fixes, so there is no final full-suite PASS.
- Current final focused Chromium set after the fixes: **7 passed** (practice execute/respawn, physical crouch, ceiling clearance, four-height gold support, FPS/rebinding, full action settings matrix, and remote two-client crouch/stand). The full run's remaining unrelated failures still block a complete browser acceptance claim.
- Current main checks: `node --test test/*.test.js` **254 passed, 0 failed**; both TypeScript projects **PASS**; ESLint **PASS**; `npm run build` **PASS**. The known Ammo scaled-mesh capability warning and large client bundle warning remain.

No production deployment was performed. The branch is not merge/deploy ready until the remaining full-browser failures and the explicitly incomplete matrices are resolved and rerun.

## Unified production-candidate integration — 2026-10-20

The public-main release candidate also includes George Protocol and the gate-pass audio change. The final merged candidate ran `npm test`: **263 passed, 0 failed**; `npm run typecheck`, `npm run lint`, and `npm run build` passed. A targeted Chromium run covered gate entry/audio, crouch physics, FPS and keybinding UI, George's two-client flow, Full/Delta multiplayer, remote crouch, and combat flows: **16/17 passed**. The remaining account/combat hit-prediction case passed when rerun alone (1/1); the initial multi-spec run's intermittent failure is recorded rather than hidden.

The known full Chromium suite remains incomplete/red (the latest branch-wide recorded run was 27 passed, 11 failed, 2 skipped). Protocol compatibility against deployed old binaries and human animation review remain unverified. The associated audio asset `public/assets/audio/gate-pass.m4a` is included and the gate-audio browser check passed. This report does not claim that these results are production-network or human acceptance.

## Final acceptance audit — 2026-10-20

- Full Chromium run immediately before the final resolver-only guard: **27 passed, 11 failed, 2 skipped**. It is a real full-suite result, not a PASS. The final guard is covered by the focused gold resolver tests and browser subset, but the complete browser suite was not rerun on that exact tree. Remaining failures are in offline practice target damage/execute, several source-campus location/navigation assertions, item pickup, a multiplayer hit-prediction assertion, and a legacy visual-QA power-lab action. The complete failure list is recorded in `/tmp/msa-main-e2e-final.log` for that run.
- The focused post-fix Chromium set passed **6/6** after the final vertical relocation guard: real capsule posture, low-ceiling stand blocking, four elevated physics support samples, FPS/settings, all-action remap/conflict UI, and two-client remote crouch/stand skeletal change.
- A final resolver audit found that the first nearest-anchor fallback ranked only X/Z. It could choose a lower level when no anchor was close enough at the holder's Y. Relocation now also enforces a 2.25 m vertical bound, weights vertical distance, and falls back to the audited spawn if no plausible same-level support exists. `test/gold-drop.test.js` covers same-XZ stacked surfaces, airborne recovery, and no-reachable-level fallback; targeted server/input/posture suite passes **15/15**.
- Exact final-tree checks after the resolver guard: `node --test test/*.test.js` **255 passed, 0 failed**; client and Worker TypeScript checks **PASS**; ESLint **PASS**; `npm run build` **PASS** (large bundle warning remains).
- Campus Node host: `test/node-server.test.js` **2/2 passed**, including two-client room flow and 3-client slow-reader isolation. The isolated run reported 20 Hz, Tick drift P95 1.57 ms / P99 1.86 ms / max 2.64 ms, Tick duration P95 0.81 ms / max 6.00 ms, one slow client isolated, 37 coalesced snapshots and max `bufferedAmount` 5,360 bytes. Local-machine measurements only.
- The previous campus report text saying no multi-height resolver exists is stale and superseded by this follow-up: the generated server index is present in both branches. It still derives only the source-audited FF-01 base floor and runtime-authored arena tiers; the campus source itself is marked `SOURCE_DERIVED_3D_UNVERIFIED`, so it does not prove every real-world building floor.

Remaining acceptance blockers: full Chromium is red; no full campus browser-suite run; no deployed older client/server binaries for wire-pairing tests; no exhaustive route/ceiling/animation-state visual review; and no human gameplay-feel acceptance. Therefore neither feature branch is ready to merge or deploy. No production service or account data changed.
