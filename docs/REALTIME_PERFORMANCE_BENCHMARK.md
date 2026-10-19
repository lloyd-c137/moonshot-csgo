# Realtime Performance Benchmark

Date: 2026-10-19. All results are local Mac measurements, not production traffic. Room load is deterministic synthetic 20 Hz `Room` execution, 5 seconds / 100 ticks per case. The static test uses the same 2.086 MB JS asset, 160 GETs, concurrency 4, loopback HTTP. `baseline` synchronously compresses each request with Brotli/Gzip (former behavior); `optimized` serves build-time compressed sidecars through the Node static stream path.

## Campus static asset load

| Metric | Baseline sync compression | Optimized precompressed stream | Change |
|---|---:|---:|---:|
| Wall time | 3072.3 ms | 146.3 ms | -95.2% |
| Process CPU | 3253.8 ms | 273.7 ms | -91.6% |
| Event-loop delay P95 | 40.76 ms | 10.26 ms | -74.8% |
| Event-loop delay max | 61.73 ms | 10.31 ms | -83.3% |
| Timer drift P95 / max | 28.73 / 29.61 ms | 0 / 0 ms | optimized run ended before a delayed interval sample was observed |
| Wire bytes | 22,268,248 | 21,725,120 | -2.4% |
| RSS delta | 70,270,976 B | 69,238,784 B | -1.5% |

The large reduction is consistent with removing repeated main-thread compression in this controlled case. The run is short; optimized timer drift has fewer opportunities to sample and must not be generalized to three-player gameplay.

## Room synthetic load: before vs current full vs current delta

Tick P95 (ms) / outbound bytes per second. Each cell is idle / mixed movement.

| Players | Baseline full | Current full | Current delta |
|---:|---:|---:|---:|
| 3 | 0.167 / 0.215; 10,059 / 10,673 B/s | 0.214 / 0.226; 11,018 / 11,744 B/s | 0.166 / 0.351; 6,053 / 13,118 B/s |
| 32 | 2.876 / 2.354; 1,391,309 / 1,434,459 B/s | 2.515 / 3.241; 1,549,654 / 1,611,337 B/s | 2.380 / 3.487; 79,322 / 1,625,607 B/s |

Delta mode cut idle 32-player bytes by about 94.9%, while movement in this scenario did not reduce bandwidth and used more CPU/tick time. The movement workload changes pose only slightly and does not represent combat. Results are noisy at these short windows. For those reasons, the evidence supports opt-in delta for mostly-static state, not a universal CPU or bandwidth improvement. Full snapshots remain the compatibility default.

The attempted shared pose-prebuild optimization measured neutral or worse and was reverted; it is not part of the delivered change.

## Reproduction

From either feature worktree:

```sh
node --experimental-strip-types tools/perf/roomLoad.mjs
SNAPSHOT_MODE=full node --experimental-strip-types tools/perf/roomLoad.mjs
SNAPSHOT_MODE=delta node --experimental-strip-types tools/perf/roomLoad.mjs
```

From the campus worktree after `npm run campus:build`:

```sh
MODE=baseline REQUESTS=160 CONCURRENCY=4 node tools/perf/staticLoad.mjs
MODE=optimized REQUESTS=160 CONCURRENCY=4 node tools/perf/staticLoad.mjs
```

Scripts print environment, sample counts, percentiles, bytes, CPU, memory, and scenario output to stdout. Measurements above are the captured run values; no external/network RTT samples were collected.

## CI and verification context

- `main` origin CI at `d5a2334` had one revive armor test fail (actual 1 HP vs expected 3). Local targeted test passed under Node 22 and Node 24; this failure is NOT REPRODUCED locally. It was not “fixed” by changing the assertion.
- `campus` origin CI at `6954477` failed only ESLint package script ordering; the campus branch's `package.json` ordering was auto-fixed.
- Current full main test suite passes 221/221 when run after competing CPU-heavy geometry/build work has ended. A concurrent run had one unrelated accounts snapshot timing failure; isolated accounts suite passed 7/7.
- Current campus full test, lint, type checks, Cloudflare build, Node22 campus build passed; exact test count is shown by its local TAP run.
- One existing two-client lobby-to-round Playwright test passed against local Wrangler, but it does not assert the exact delta frames. Full delta/resync browser QA, actual external-network RTT correlation, production/staging server, multi-client combat stress, and DB worker recovery: NOT MEASURED / NOT RUN.


---

---

# Realtime Performance Benchmark 2.1 — Stabilization Addendum

Run date: 2026-10-19. All raw virtual-network samples are checked in under `docs/performance/*.jsonl` on both feature branches.

## Method

`tools/perf/roomLoad.mjs` runs the real room implementation and the actual `SnapshotAcks`, `SnapshotDeltaPublisher`, and `OutboundPolicy` code against a deterministic virtual transport. Each matrix has 5 seconds warm-up and three 30-second measured rounds. RTT cases are 20, 50, 100, 200, and 400 ms. Modes are legacy-compatible Full, forced Delta, and adaptive Auto. Player scales are 3, 8, 16, and 32; behavior is idle, sparse, 75% moving, and all moving. A one-frame window (`ACK_WINDOW_MAX=1`) is the Stop-and-Wait reference. CPU/tick/serialization are local process measurements; network RTT and delivery timing are simulated. Drift is explicitly NOT MEASURED by this virtual scheduler.

## RTT delivery and bounded window

| RTT | Stop-and-Wait reference | Bounded Full | Bounded Delta | Bounded Auto | Observed in-flight cap |
|---:|---:|---:|---:|---:|---:|
| 20 ms | 20 Hz | 20 Hz | 20 Hz | 20 Hz | 1 |
| 50 ms | 10 Hz | 20 Hz | 20 Hz | 20 Hz | 2 |
| 100 ms | 6.67 Hz | 20 Hz | 20 Hz | 20 Hz | 3 |
| 200 ms | 4 Hz | 20 Hz | 20 Hz | 20 Hz | 5 |
| 400 ms | 2.33 Hz | 20 Hz | 20 Hz | 20 Hz | 9 |

Each reported cell is 3 repeats × 3 players × idle. The 200 ms case directly confirms that the bounded ACK policy does not collapse to roughly 5 Hz. It is a simulator result, not public-network proof.

## Player-scale comparison at 200 ms RTT

Values below are median of three virtual runs; Tick is local `Room.tick()` P95 per run, bytes are aggregate outbound bytes per second, and frequency is average delivered snapshots per client.

| Branch | Players / behavior | Stop-and-Wait Full | Bounded Full | Forced Delta | Adaptive Auto |
|---|---|---|---|---|---|
| Main | 3 / idle | 0.006 ms / 2.6 KB/s / 4 Hz | 0.049 ms / 13.2 KB/s / 20 Hz | 0.011 ms / 7.0 KB/s / 20 Hz | 0.006 ms / 7.0 KB/s / 20 Hz |
| Main | 3 / all move | 0.006 / 2.9 / 4 | 0.010 / 14.4 / 20 | 0.013 / 17.4 / 20 | 0.016 / 15.4 / 20 |
| Main | 8 / idle | 0.023 / 20.5 / 4 | 0.038 / 102.3 / 20 | 0.020 / 19.0 / 20 | 0.042 / 19.0 / 20 |
| Main | 8 / all move | 0.029 / 22.6 / 4 | 0.034 / 113.6 / 20 | 0.037 / 121.5 / 20 | 0.032 / 116.1 / 20 |
| Main | 16 / idle | 0.094 / 87.4 / 4 | 0.090 / 436.1 / 20 | 0.025 / 39.4 / 20 | 0.029 / 39.4 / 20 |
| Main | 16 / all move | 0.103 / 92.7 / 4 | 0.105 / 464.7 / 20 | 0.118 / 480.7 / 20 | 0.109 / 470.0 / 20 |
| Main | 32 / idle | 0.433 / 354.6 / 4 | 0.405 / 1768.4 / 20 | 0.241 / 84.2 / 20 | 0.269 / 84.2 / 20 |
| Main | 32 / all move | 0.442 / 370.9 / 4 | 0.452 / 1859.1 / 20 | 0.642 / 1891.4 / 20 | 0.496 / 1869.8 / 20 |
| Campus | 3 / idle | 0.006 / 2.6 / 4 | 0.006 / 13.2 / 20 | 0.006 / 7.0 / 20 | 0.003 / 7.0 / 20 |
| Campus | 3 / all move | 0.006 / 2.9 / 4 | 0.006 / 14.4 / 20 | 0.007 / 17.4 / 20 | 0.006 / 15.4 / 20 |
| Campus | 8 / idle | 0.022 / 20.5 / 4 | 0.023 / 102.3 / 20 | 0.010 / 19.0 / 20 | 0.010 / 19.0 / 20 |
| Campus | 8 / all move | 0.027 / 22.6 / 4 | 0.030 / 113.6 / 20 | 0.032 / 121.5 / 20 | 0.031 / 116.1 / 20 |
| Campus | 16 / idle | 0.087 / 87.4 / 4 | 0.088 / 436.1 / 20 | 0.026 / 39.4 / 20 | 0.030 / 39.4 / 20 |
| Campus | 16 / all move | 0.097 / 92.7 / 4 | 0.103 / 464.7 / 20 | 0.117 / 480.7 / 20 | 0.106 / 470.0 / 20 |
| Campus | 32 / idle | 0.409 / 354.6 / 4 | 0.395 / 1768.4 / 20 | 0.230 / 84.2 / 20 | 0.259 / 84.2 / 20 |
| Campus | 32 / all move | 0.424 / 370.9 / 4 | 0.435 / 1859.1 / 20 | 0.608 / 1891.4 / 20 | 0.480 / 1869.8 / 20 |

After the first cell, abbreviated values use `tick P95 ms / KB/s / snapshots Hz`. Raw JSONL records include P50/P95/P99/max tick and serialization duration, CPU, memory delta, messages, and bytes. Snapshot frequency is the principal 200 ms RTT win. Idle/sparse Delta sharply reduces bandwidth; dense Delta has higher tick cost than Full in this sample. Auto preserves the sparse savings and avoids forced Delta's dense tick cost, but it is not faster than plain Full in every dense case (32-player main Auto P95 is 0.496 ms vs Full 0.452 ms). Auto stays because its sparse bandwidth/tick results are materially better than Full and its dense cost remains sub-millisecond in this local simulation. These results do not establish a deployed Worker or campus host under real traffic.

## Virtual slow-reader simulation

With a 100 ms RTT, 10 MB/s modeled link, 30 seconds, and a peer pausing reads at 10 seconds, healthy peers stayed at 20 Hz at 3/8/16/32 players. The paused peer delivered 3.37 Hz during the measured interval and was closed by the bounded timeout; coalesced snapshots were 35 in each run. The scheduler models the network and therefore does not produce Tick Drift evidence.

## Real local WebSocket slow-client test — campus

Three actual Node `ws` clients connected to the local campus server at 20 Hz. One client's TCP read side was paused; two healthy clients continued snapshots, authoritative body hit, and a global finisher. The slow peer was isolated with reason `slow-ack-timeout`; 37 replaceable snapshots were coalesced.

Latest recorded sample: healthy ping RTT `[0,1,1,1,1]` ms; Tick drift P95/P99/max `1.76/2.27/2.72 ms`; Room tick duration P95/P99/max `0.831/2.085/6.31 ms`; Node event-loop delay P95/max `21.45/23.92 ms`; observed ws buffered bytes P95/max `4,045/5,360`; outbound bytes `46,176`; RSS `134,594,560` bytes. SQLite operation latency: 60 samples, P95 `0.228 ms`, P99/max `1.051 ms`; initialization transaction `1.165 ms`. This is loopback-only evidence; the small ping RTT is not representative of school or public internet.

## Campus static asset test

Same build asset, 120 requests, four loopback clients, same response encoding and response-byte totals (65,176,200 bytes), after `npm run campus:build`:

| Mode | Elapsed | CPU | Event-loop delay P95 / max | Timer drift P95 | RSS delta |
|---|---:|---:|---:|---:|---:|
| Equivalent baseline: async read + synchronous Brotli | 1,975.2 ms | 2,219.8 ms | 31.36 / 49.25 ms | 25.92 ms | 71,467,008 B |
| Build-time precompressed stream | 88.5 ms | 158.3 ms | 10.13 / 10.13 ms | 0 ms | 69,828,608 B |

All 120 responses completed and each response was exactly 543,135 bytes in both modes. This is a local synthetic asset-load result; it supports removing synchronous compression from the request path, but does not prove a three-player public-network RTT outcome. Historical `readFileSync` baseline remains available with `MODE=legacy`; this report uses the equivalent async-read baseline.

## Database isolation decision

The WebSocket test did not show SQLite as a significant blocking source: operation P95 `0.306 ms` (n=58), max `0.671 ms`. No production persistence migration was made. A standalone Worker Thread PoC applies 100 SQLite event RPCs and replays one event after restart idempotently; local Node 24 result P95 RPC `0.121 ms`, max `2.811 ms`. This is feasibility evidence only, not Node 22 deployment validation or account-system recovery proof.

## Production-network limits

No real school/public network RTT, Cloudflare Durable Object socket buffer, or live-player workload was available. Real production RTT/throughput and public worker perf are **NOT MEASURED**. The local `ws` scenario is actual sockets but local loopback. The CI run at the original branch heads failed existing broad browser E2E scenarios; details and current post-push status are recorded by the delivery report, not hidden by these measurements.
