# Realtime Architecture 2.0 — implementation status

Date: 2026-10-19. Scope: isolated feature branches `perf/realtime-main` and `perf/realtime-campus`, based on origin/main `d5a23347` and origin/campus `69544775`. Production was not modified.

## Supersession note

The original Architecture 2.0 sections below are retained as history. Its one-unacknowledged-frame policy and ACK-based Delta-baseline description are superseded by the Architecture 2.1 addendum at the end of this file.

## Branch architecture

Both branches retain `Room` as the authoritative game state and share TypeScript protocol, metrics, outbound policy, snapshot delta publisher, and client delta application. `main` remains Cloudflare Worker + Durable Object; `campus` remains Node `ws` + `node:sqlite`. The adapters are intentionally separate. Protocol version remains 15 and the new snapshot mode is opt-in using hello capabilities; legacy clients continue receiving full `snapshot` messages.

## Message and state flow

Room emits authoritative full snapshots. The transport adapter applies recipient-specific visibility first, then selects legacy/full/delta output for that connection. A connection's Full/Delta baseline advances only after its application-level sequence acknowledgement. Delta contains updates and removals; stealth filtering is applied before publication, so hidden positions are never put into the recipient baseline. Epoch changes and sequence/base gaps cause a full resync. A periodic full frame resets accumulated state. Critical game messages remain independent reliable WebSocket messages and are never coalesced by snapshot policy. If a connection becomes unhealthy, it is closed and must recover from authoritative welcome/state.

## Tick and publication

`GAME_TICK_HZ`, `SNAPSHOT_HZ`, and `POSE_HZ` are explicit 20 Hz constants. They are not yet independently scheduled: Room still advances and produces snapshots on the existing 20 Hz timer. No gameplay frequency has been lowered. Tick drift and duration are measured. Catch-up does not run a burst of old snapshots; the existing timer samples current state.

## Backpressure

Node checks `ws.bufferedAmount` before enqueuing. Above 256 KiB, replaceable snapshots are coalesced; a connection continuously above 512 KiB for 2 seconds is closed; recovery watermark is 64 KiB. Critical messages are not silently dropped. Cloudflare's current WebSocket surface does not expose a trustworthy writable buffered-byte count, so the Worker bounds opted-in clients to one unacknowledged application snapshot; an acknowledgement timeout closes that connection. This is application receipt progress, not a claim about TCP/kernel buffering. Legacy Cloudflare clients do not advertise acknowledgements and therefore cannot receive this same application-level queue bound.

## Metrics and diagnostics

`RealtimeMetrics` uses bounded typed-array sample windows and computes percentiles only when exporting. Worker and Node log periodic structured metrics without names, account tokens, or IP addresses. Metrics include tick, serialization, message/snapshot bytes, inbound/outbound bytes, critical-event and disconnect-code counts, slow/coalesced snapshots, and SQLite duration. Node additionally samples event-loop delay/utilization, CPU, RSS/heap, GC, HTTP/static transfer. Cloudflare event-loop delay and socket writable buffer are marked unavailable. Client diagnostics are opt-in at `?netdiag=1` and report local RTT distribution/timeline, snapshot interarrival/gaps/bytes, browser frame time, Long Tasks when supported, and local buffered amount. Cross-machine clocks are not subtracted and the diagnostic panel does not expose server internals.

## Persistence

No persistence architecture migration was made. Node continues using synchronous `DatabaseSync`; measurements are now available, but moving Accounts/Room writes to a worker requires an idempotent durable event/transaction design and recovery tests. Cloudflare Durable Object SQLite remains in place. This is a release blocker for any claim that persistence is isolated from the real-time event loop.

## Verification and limits

See `REALTIME_PERFORMANCE_BENCHMARK.md` for measured local data. Existing combat, finisher, reconnect, visibility, and account tests remain in place. New tests exercise delta semantics, resync, snapshot coalescing, app acknowledgements, and Node static HTTP behavior. The existing two-client Playwright lobby-to-round test passed against local Wrangler and exercises the new opt-in client capability, though it does not assert each delta wire frame. The synthetic Room load tool covers 2/3/8/16/32 players in idle/movement with full-vs-delta output. It is not a real network or combat load test. No packet impairment, full combat stress, real slow-reader WebSocket integration, production staging deployment, or SQLite worker-failure recovery test was completed.


---

---

# Realtime Architecture 2.1 — Stabilization Addendum

This document describes the stabilization implemented on `perf/realtime-main` and the corresponding shared implementation on `perf/realtime-campus`. It is an implementation record, not a production deployment claim.

## Runtime boundaries

- `main`: Cloudflare Worker and Durable Object remain authoritative for room state. The Worker uses application ACK progress because the adapter does not expose a trustworthy per-client socket send-buffer measurement.
- `campus`: the Node.js host uses the same room policy and additionally observes `ws.bufferedAmount`, Node event-loop delay/utilization, SQLite operation latency, and process memory.
- The client protocol version did not change. Old clients without `snapshotDelta` continue receiving the legacy full `snapshot`; new clients only ACK the new Full/Delta frame kinds.
- Neither branch enables a public diagnostics endpoint. Node diagnostics are returned only by the in-process object used by tests.

## Tick and snapshot path

The room remains the single authority and continues advancing at 20 Hz. Each recipient has a separate visibility-filtered pose set. The outbound adapter classifies position snapshots as replaceable and gameplay/account/round/finisher messages as critical.

For ACK-capable connections the send window is derived from smoothed ACK RTT at 20 Hz, starts with three frames, and is clamped to 12. A single prepared frame may exist per recipient; a frame skipped before preparation consumes no sequence number. Persistent missing ACK progress closes the unhealthy connection after the existing bounded timeout. Legacy connections without snapshot ACK support retain their previous full-snapshot behavior.

The Worker/Node adapter calls `send`, then commits the ACK sequence and Delta publisher state only if `send` returned successfully; a thrown send aborts the prepared state. A skipped or aborted frame therefore never becomes a Delta base. WebSocket ordering means the next Delta uses the last successfully accepted frame as `baseSeq`. If the client detects a gap, wrong epoch, or absent base, it requests resynchronization; the server advances the epoch and sends a new Full frame. Hidden players are represented as removals in the per-recipient Delta, and become updates again only when visible.

Full snapshots are periodically recalibrated 10 seconds after a full frame is acknowledged. ACKs for ordinary Delta frames no longer move that deadline. ACKs are cumulative, matching the ordered WebSocket stream; stale, future, duplicate, and mismatched-epoch ACKs are ignored.

## Backpressure and event ordering

Before a replaceable frame is queued, the Node adapter checks actual `bufferedAmount`; the Worker has no asserted transport-buffer byte metric and instead uses the bounded application ACK window. Pressure coalesces position state. Critical messages are not coalesced. If a connection cannot make bounded progress, the connection is closed and the client must restore from authoritative state on reconnect.

Critical events and snapshots share the same ordered WebSocket. Already-sent frames are never removed or overtaken. The policy prevents stale snapshots from entering a queue once pressure is visible; it does not claim delivery over a connection that has been closed.

## Adaptive Full/Delta selection

The existing protocol stays JSON. For low pose-change counts, Delta reuses the committed per-recipient baseline. The adaptive path counts changes up to a 25% threshold before allocating delta maps and selects Full when the change density is higher. Benchmarks show clear bandwidth savings for idle/sparse scenes; at high movement density the CPU and bandwidth advantage is mixed. Auto mode is retained because it avoids the worst dense-Delta case at 32 players in repeated local simulation; it is not represented as a universal CPU win.

## Persistence

Campus still uses `node:sqlite` `DatabaseSync` on the main thread. The real local WebSocket test observed 58 SQLite operations with P95 about 0.31 ms and maximum about 0.67 ms. This sample does not demonstrate SQLite as the cause of tick spikes, so the account path was not migrated. `tools/perf/sqlite-worker-poc.mjs` is a separate feasibility probe: it uses a worker-owned SQLite connection, serial RPC, transactional event IDs, and duplicate replay after a worker restart. It does not read or modify campus account data and is not used by the service.

## Evidence boundaries

- RTT matrix: deterministic virtual network schedule; local Room CPU and JSON serialization are measured, but RTT, packet delivery, and tick drift are simulated/not measured.
- Slow campus peer: real local `ws` connections on loopback; the OS/network is local, not a public or school network.
- Static campus benchmark: local HTTP loopback against the same Vite build artifact; the baseline is async `readFile` plus synchronous compression, matching the previous implementation. The optimized path serves build-time `.br` data.
- No production Worker, Pages, campus server, account database, or live-player network was changed or used.

See [REALTIME_PERFORMANCE_BENCHMARK.md](./REALTIME_PERFORMANCE_BENCHMARK.md) and [REALTIME_RELEASE_CHECKLIST.md](./REALTIME_RELEASE_CHECKLIST.md) for measurements and release blockers.
