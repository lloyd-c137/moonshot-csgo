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
