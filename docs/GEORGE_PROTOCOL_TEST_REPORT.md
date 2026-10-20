# George Protocol test report — campus feature branch

Verification recorded for `feat/george-protocol-campus` on 2026-10-20. This branch hosts the shared George Room rules in the campus Node.js server; the production Windows server was not contacted.

| Check | Result | Evidence |
|---|---|---|
| Full unit and Node service suite | PASS (244/244) | `npm test`; includes `test/node-server.test.js` WebSocket/API/persistence coverage and George Room tests |
| TypeScript | PASS | `npm run typecheck` (app, Worker-compatible shared server, and Node host projects) |
| ESLint | PASS | `npx eslint src server test tools functions deploy tests/browser/george-protocol.spec.ts` |
| Campus production build | PASS | `npm run campus:build`; Vite static assets and bundled Node 22 server emitted |
| George two-client Playwright E2E | PASS (2/2) against the local Wrangler test adapter | `npx playwright test tests/browser/george-protocol.spec.ts --reporter=line` |
| Full browser E2E suite | NOT RUN on campus | Playwright configuration starts the Cloudflare Worker adapter, not the campus Node host; Node runtime is covered by the service tests above |
| Campus Node process/browser end-to-end | NOT RUN | No two-browser run against a started campus Node server was performed in this verification pass |
| Staging/production compatibility and human acceptance | NOT RUN | No external deployment or production changes |

The browser E2E uses a signed-in test fixture to prepare 9/10; the final elimination is a real frisbee throw validated by the shared authoritative Room. It then exercises credential reveal, terminal authentication, synchronized reboot state, disarm and shutdown outcome. This verifies the shared rules through the local Worker adapter, while campus-specific HTTP, WebSocket, account persistence and process behavior are covered by the Node service tests.

The test-only George fixture is inaccessible unless `COMBAT_TEST=1` and also requires an authenticated account in a live round. It cannot set a production streak or trigger a real host operation. The Node host routes the same shared Room state machine and has no OS reboot integration.

## Evidence and limitations

- Local browser screenshots are written under `test-results/` and may be removed by later Playwright runs.
- The exact M103 server alcove is gameplay-authored; source geometry does not establish a real existing closet.
- Terminal access validates reported pose, phase, and bounds, but not complete server-side collision or line-of-sight. Campus host uses client-reported movement poses, as before.
- Unit coverage includes genuine lethal Room events, revive armor, credential revocation, authenticated terminal flow, abort, reconnect ownership, and idempotent special-round settlement. Dedicated tests for every eligible 10th-kill source remain incomplete.
- Protocol 16 requires coordinated client/server staging. No protocol-15 compatibility matrix or staging deployment was verified.
- No school Windows host, production account, production SQLite database, or real machine control was accessed.
