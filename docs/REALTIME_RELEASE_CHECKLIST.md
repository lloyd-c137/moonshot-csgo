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
