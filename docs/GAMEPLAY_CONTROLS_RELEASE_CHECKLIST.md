# Gameplay & Controls 2.0 — release checklist

**Current decision: DO NOT MERGE OR DEPLOY.** This feature branch is a work in progress. No production services or data have been changed.

## Required before release

- [ ] Implement and test a deterministic, server-side walkable-surface query for gold and ordinary disc drops. Cover actual multi-level support, stairs, bounds, obstruction, reachable pickup space and relocation limits. Confirm floors cannot be picked up through.
- [ ] Browser-verify drops and pickup on every supported elevation and special elimination path; include screenshots or captured test evidence.
- [ ] Complete a context-owned action router so chat, menu, cinematic, execution and spectator state cannot race gameplay input. Test all remappable movement and hold/release actions, system shortcuts and IME.
- [ ] Verify crouch physics in the actual campus scene under low ceilings, furniture, slopes, stairs, stands, teleport, death, respawn, spectator, pause and cutscenes. Verify no capsule/camera desynchronization.
- [ ] Review crouch skeleton pose in idle, walk, sprint transitions, throw, hit, death and THE BOOMERANG; verify remote player nameplates and held props.
- [ ] Add/finish real two-client E2E for remote crouch/stand, Full/Delta update, historical head/body hit, reconnect, and old/new client-server capability combinations.
- [ ] Run and record the full browser suite on both runtime branches; identify unrelated or baseline failures rather than treating an unrun suite as pass.
- [x] Shared gameplay changes are ported to `feat/gameplay-controls-campus` while retaining the Node host adapter. Campus typecheck, lint, tests, build and real `ws` checks pass; see the test report. Do not merge host runtimes.
- [ ] Review optional-field protocol rollout order with isolated staging. Keep production `PROTOCOL_VERSION`, Pages, Worker, account data and DO untouched until compatibility is proven.
- [ ] Get human gameplay acceptance for physical feel and visibility; unit tests cannot establish the intended game feel.

## Rollback

The work is isolated on feature branches. Revert the feature commit(s) or keep the base refs unchanged to roll back before merge. Do not run production migrations for this feature. Protocol version is still 15; if a future staged test requires a version change, ship server compatibility before enabling the client and retain a documented compatible rollback build.
