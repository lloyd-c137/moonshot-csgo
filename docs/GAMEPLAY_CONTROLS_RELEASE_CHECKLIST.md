# Gameplay & Controls 2.0 — release checklist

**Current decision: DO NOT MERGE OR DEPLOY.** This feature branch is a work in progress. No production services or data have been changed.

## Required before release

- [~] Deterministic server gold-drop anchors are generated from audited FF-01 walkable floor and authored arena collision surfaces. Unit tests pass, and Chromium/Ammo now verifies support at four raised arena heights. Exhaustive anchor headroom/reachability, ordinary-disc drops, obstruction and through-floor pickup remain open.
- [~] Four-height support evidence is captured; drops and pickup still need browser coverage across every supported elevation and special elimination path.
- [~] Every registered action has a runtime press/hold/release test; browser tests verify all settings rows, remap, live hints, explicit conflict swap and reset. One context-owned router and the full chat/menu/cinematic/system-shortcut/IME matrix remain open.
- [~] Actual capsule behavior and a real Ammo low-ceiling fixture pass in browser; full campus furniture/slope/stairs/teleport/death/respawn/spectator/pause/cutscene matrix remains open.
- [~] Remote skeletal joints now change and return to neutral in two-client browser QA; repeated posture rotation no longer accumulates. Full animation/state and held-prop/nameplate visual review remains open.
- [~] Real two-client crouch/stand skeletal visualization passes; old/new capability contracts and legacy standing pose are unit-tested. Historical hit, reconnect integration and actual old/new binaries remain open.
- [ ] Full main-browser suite last completed with 27 passed, 11 failed and 2 skipped. Seven focused tests pass after the final fixes, but the full suite has not been rerun; remaining failures and campus Node browser coverage are open.
- [ ] Apply the shared implementation to `feat/gameplay-controls-campus`, run campus Node typecheck, lint, tests, build and real `ws` integration checks. Do not merge host runtimes.
- [ ] Review optional-field protocol rollout order with isolated staging. Keep production `PROTOCOL_VERSION`, Pages, Worker, account data and DO untouched until compatibility is proven.
- [ ] Get human gameplay acceptance for physical feel and visibility; unit tests cannot establish the intended game feel.

## Rollback

The work is isolated on feature branches. Revert the feature commit(s) or keep the base refs unchanged to roll back before merge. Do not run production migrations for this feature. Protocol version is still 15; if a future staged test requires a version change, ship server compatibility before enabling the client and retain a documented compatible rollback build.
