# George Protocol test report — main feature branch

Verification recorded for `feat/george-protocol-main` on 2026-10-20. This report separates unit, build, targeted browser, full browser, and production evidence.

| Check | Result | Evidence |
|---|---|---|
| George Room tests | PASS (7/7) | `node --test test/george-protocol.test.js` |
| Full unit suite | PASS (236/236) | `npm test` |
| TypeScript | PASS | `npm run typecheck` (app and Worker projects) |
| ESLint | PASS | touched client/server/test files |
| Cloudflare Pages/Worker build | PASS | `npm run build` |
| George two-client browser E2E | PASS (2/2) | `npx playwright test tests/browser/george-protocol.spec.ts --reporter=line`; includes actual final frisbee elimination and abort/shutdown paths |
| Complete browser E2E suite | FAIL (17 passed, 15 failed, 2 skipped of 34) | `/tmp/msa-george-main-e2e.log`; failures span pre-existing audio, geometry, execution, multiplayer, power and visual-QA specs, plus one George shutdown UI timing assertion under suite load |
| Staging/production compatibility and human acceptance | NOT RUN | No external deployment or production changes |

The focused George E2E suite passed after the shutdown assertion was changed to wait for the authoritative `round.outcome === 'george-reboot'` before checking the result card. The test-only setup advances the signed-in player to 9/10; the last elimination remains a real frisbee throw and server-validated lethal hit. The other browser proves owner-private credential handling, terminal login, shared countdown, abort, and result synchronization. The setup endpoint exists only with `COMBAT_TEST=1`.

The full suite is not a pass. It also reported failures such as the offline dummy remaining at 2 HP, missed authored-room navigation/interaction checks, execution and outage flows, and one `ERR_CONNECTION_REFUSED` from a test navigating to a fixed `5173` URL after the long run. Those failures were not hidden or represented as George regressions without evidence. Ammo.js emits its existing scaled-mesh capability warning in local browser runs.

## Evidence and limitations

- The focused browser spec records screenshots under `test-results/` for the credential, MakerSpace terminal, countdown, abort, and shutdown flow; Playwright may clean these artifacts on a later run.
- The exact M103 server alcove is gameplay-authored; source geometry does not establish that it is a real existing closet.
- Server terminal checks use the authoritative reported pose, round/phase state, and bounds; they do not provide full server-side physics or line-of-sight validation.
- Unit tests cover genuine lethal Room events, revive armor, death/revocation, authentication, abort, reconnect ownership, and once-only settlement. Dedicated per-weapon tests for every eligible 10th-kill source remain incomplete.
- Protocol 16 requires coordinated client/server staging. Protocol-15 clients are rejected; no old/new client matrix or isolated staging deployment has been verified.
- No real server reboot, infrastructure credential, production account, production Worker, or production database is accessed by this feature.
