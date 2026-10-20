# George Protocol test report

## Verification record

This report records the isolated `feat/george-protocol-main` worktree on 2026-10-20. Unit, browser, and build evidence are reported separately.

| Check | Result | Evidence |
|---|---|---|
| George Room unit tests | PASS (7/7) | `node --test test/george-protocol.test.js` |
| Main/client and Worker TypeScript | PASS | `npm run typecheck` (after the final source changes) |
| ESLint | PASS | `npx eslint src server test tests/browser/george-protocol.spec.ts tests/browser/campus-game.spec.ts playwright.config.ts` |
| George two-client browser E2E | PASS (2/2) | `npx playwright test tests/browser/george-protocol.spec.ts --reporter=line` |
| Full unit suite | PASS (235/235 at latest full run) | `npm test`; rerun after the additional API URL selector test is recorded below |
| Production build | PASS before the final API URL selector adjustment; rerun required | `npm run build` |
| Complete browser suite | RUNNING; earlier audio-lab failure observed | `npm run test:e2e`; full log at `/tmp/msa-george-main-e2e.log` |
| Campus Node build/tests | NOT RUN | Campus implementation/port and verification remain required |
| Production network or player acceptance | NOT RUN | No production deployment was performed |

The George browser tests use separate local Durable Object names selected only while `COMBAT_TEST=1`; production continues to use `campus-v2`. A signed-in local fixture prepares the attacker at 9/10. The final elimination is a real PlayCanvas frisbee throw resolved as a lethal hit by `Room`. The browser tests then prove owner-only code reveal, terminal authentication, synchronized reboot state, defender abort, and the no-abort blackout/victory outcome.

The full browser run's first observed unrelated failure is `tests/browser/audio-lab.spec.ts:236`: the fixed practice dummy remained at 2 HP after a shot expected to reduce it. The run is still being completed; this is not counted as a George failure or a full-suite pass.

## Local browser evidence

`tests/browser/george-protocol.spec.ts` captures local screenshots during the 10/10 reward, MakerSpace server room, terminal authentication, reboot countdown, abort, and George victory flows. The test run output directory is ephemeral/cleaned by Playwright, so screenshots must be captured from a retained run artifact before they can be delivered as stable files.

## Outstanding coverage and limits

- Server unit coverage exercises ten genuine lethal `Room` hit events; the browser E2E accelerates only the first nine to avoid flaky repeated headless throws.
- Separate unit paths cover ordinary hits, revive armor, execution settlement, reconnect identity, authentication, abort, and once-only shutdown settlement. Gold/FRC and THE BOOMERANG tenth-kill source combinations need more targeted assertions.
- Reported-pose terminal proximity is not full server-side geometry, line-of-sight, or anti-cheat proof.
- The exact MakerSpace server-room location is authored; source geometry does not verify an existing closet there.
- No isolated Cloudflare compatibility matrix, campus Windows server, or human visual review has been completed.
- Protocol 16 requires coordinated client/server staging; protocol-15 clients are intentionally rejected.
