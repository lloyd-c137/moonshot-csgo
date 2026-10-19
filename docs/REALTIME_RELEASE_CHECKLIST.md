# Realtime Architecture 2.0 — Release Checklist

## Current state

Do not deploy or merge as a completed architecture release. These are isolated feature-branch changes; main/campus production code, Cloudflare Worker, Pages, campus server data, and Windows machine were not modified.

## Gates completed

- [x] Server remains authoritative; protocol remains version 15.
- [x] Legacy full snapshot fallback remains available.
- [x] Per-recipient delta baseline, epoch/sequence/base checks, explicit remove, acknowledgement, and full resync are implemented.
- [x] Stealth visibility remains recipient-filtered before snapshot encoding.
- [x] Node static assets use precompressed Brotli/Gzip sidecars, streaming reads, MIME/cache/Vary/ETag handling, and HEAD metadata path.
- [x] Node bufferedAmount backpressure and Cloudflare application-ack policy have unit coverage.
- [x] Existing room/combat/account tests retained; new metrics/outbound tests added.
- [x] Cloudflare and campus branches have distinct runtime adapters.

## Blocking gates

- [ ] Resolve or reproduce the origin main CI revive-armor failure under the exact CI runtime/workflow. Local Node 22 targeted test passed, so result remains NOT REPRODUCED.
- [x] Existing two-client lobby-to-round Playwright test passes against a local Worker; client opts into delta capabilities.
- [ ] Browser assertions for exact Full/Delta frames, stealth removal, sequence gap/resync, interpolation, spectator and finisher camera.
- [ ] Real multi-client WebSocket load and slow-reader isolation, including critical combat/finisher behavior.
- [ ] Cross-machine timeline correlation from browser diagnostics to server metrics with a protected diagnostic workflow.
- [ ] Node SQLite Worker Thread isolation, durable idempotent persistence, crash/restart and transaction recovery tests.
- [ ] Separate scheduler implementation and timing regression tests; constants are split but still share existing cadence.
- [ ] Staging rollout with isolated Cloudflare Durable Object and isolated campus test service; verify old/new protocol interop and rollback.
- [ ] Re-run the full matrix without concurrent CPU-heavy runs and archive raw outputs.

## Deployment order / rollback

1. Keep production protocol at version 15 until staging verifies mixed-client behavior.
2. Deploy server support for legacy full frames and opt-in new capability before any client turns the capability on by default.
3. Observe metrics and preserve the ability to disable delta capability without a protocol bump.
4. Roll back by deploying the previous server and client build; no schema migration or account-data movement is included in this change.
5. Production deployment remains explicitly unauthorized in this task and was not performed.


---

# Realtime Architecture 2.1 — Release Gate Addendum

## Verified locally

- [x] Full and Delta server/client tests pass, including skipped frame sequence handling, recipient visibility removal/reappearance, resync epochs, old-client full fallback, cumulative ACKs, and periodic Full deadline.
- [x] RTT/window simulation passes at 20/50/100/200/400 ms; at 200 ms ACK-aware delivery remains 20 Hz with a five-frame window.
- [x] Browser E2E inspects actual Full/Delta wire frames, verifies Delta base sequence, sends resync, observes a new Full epoch/pose, and confirms client remote pose recovery.
- [x] Campus local `ws` test isolates a paused reader while healthy clients receive ordinary hit and global finisher events.
- [x] Campus static compression comparison uses same asset, complete response count, byte totals and equivalent async-read/synchronous-compression baseline.
- [x] Typecheck, lint, unit tests and builds pass on each branch before push.

## Required before merge or deployment

- [ ] Both post-push GitHub Actions runs finish green. The CI runs at the original branch heads had failures in broad existing `tests/browser/audio-lab.spec.ts`, scene navigation, avatar and multiplayer E2E tests; see the actual actions URLs in the final handoff. A targeted local delta/resync E2E passes, but this does not clear the full-suite failure.
- [ ] Validate RTT and snapshot delivery from a real school/public network; all RTT values in `realtime-rtt-matrix.jsonl` are simulated.
- [ ] Validate the Cloudflare Worker build/run and staging Durable Object behavior; no production Durable Object was touched.
- [ ] Validate the campus Worker Thread PoC under the deployment's Node 22 runtime before considering account persistence migration. The service remains on synchronous SQLite; no migration has been made.
- [ ] Review branch CI artifacts and re-run the whole browser suite after any unrelated E2E fixture repair.

## Deployment and rollback

- This task does not merge to `main`/`campus` and does not deploy Cloudflare or campus production.
- Keep the old protocol-compatible full snapshot path. `PROTOCOL_VERSION` remains unchanged.
- If an isolated staging test fails, revert the feature branch commits; no data migration or room-name change is involved.
- Do not expose detailed Node diagnostics publicly; the current metrics are internal/test-only.

## Status

Local checks can be PASS only after their final command exits successfully. CI status is separate. Production readiness remains blocked until the full required CI/E2E runs and real-network/staging checks complete.
