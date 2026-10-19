# Realtime Architecture 2.0 — implementation status

Date: 2026-10-19. Scope: isolated feature branches `perf/realtime-main` and `perf/realtime-campus`, based on origin/main `d5a23347` and origin/campus `69544775`. Production was not modified.

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
