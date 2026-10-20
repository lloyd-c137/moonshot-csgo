# George Protocol test report — production release candidate

Recorded on 2026-10-20 for the integration candidate based on `origin/main` `3122001`. This report separates automated checks from production evidence.

| Check | Result | Evidence |
|---|---|---|
| Room and George tests | PASS (39/39) | `node --test test/george-protocol.test.js test/multiplayer-room.test.js` |
| Full unit suite | PASS (236/236) | `npm test` |
| TypeScript | PASS | `npm run typecheck` |
| ESLint | PASS | `npm run lint` |
| Cloudflare Pages/Worker build | PASS | `npm run build` |
| George two-client browser E2E | PASS (2/2) | `MOONSHOT_TEST_ROOM_PORT=8791 npx playwright test tests/browser/george-protocol.spec.ts --workers=1` |
| Full browser E2E / CI | FAIL | Feature-branch Actions run `39372630284`: 20 of 34 browser tests failed, 12 passed, 2 skipped. The failures are broad browser/scene/connection failures; they have not been represented as a pass. |
| Production Pages/Worker smoke | PENDING | To be recorded after deployment. |
| Old/new client compatibility matrix | NOT RUN | Protocol 16 requires coordinated client and Worker rollout. |

The focused browser spec uses two browser clients and a real local Worker. A protected test fixture prepares the first player at 9/10; the tenth elimination is still a real frisbee throw and server-validated lethal hit. It then verifies the private credential, MakerSpace terminal login, shared countdown and abort/shutdown outcomes. The setup endpoint is available only with `COMBAT_TEST=1`.

The full browser suite remains a release limitation. The earlier feature-branch CI run failed across multiple existing browser flows and long-running scene/connection checks. A local Playwright run also exposed that port 8787 was occupied by an unrelated Workerd process, so the Playwright room port is now configurable and the focused George run used 8791. That unrelated process was not modified.

The M103 server alcove is gameplay-authored; source geometry does not establish that it is a real existing closet. Server terminal checks use the authoritative reported pose, round/phase state and bounds, but do not provide full server-side physics or line-of-sight validation. Dedicated per-weapon tests for every eligible tenth-kill source remain incomplete.

Protocol 16 clients are not compatible with protocol-15 servers. Deployment must publish the matching Pages client and Worker together; no old/new client matrix or isolated staging deployment has been verified. The reboot is an in-game simulation only: no infrastructure credential, operating-system reboot, production account or production database is used.
