# Combat Feel 2.0

Status: **IN PROGRESS**. This file records implementation evidence, not a completion claim.

## Scope and architecture

Combat Feel 2.0 keeps the existing PlayCanvas scene, Ammo physics, Durable Object authority, disc rules, selected audio and multiplayer transport. The browser may predict presentation locally; health, headshot classification, eliminations, scores and match state remain server-authoritative.

Current signal path:

1. `src/gameplay/discs.ts` sweeps each local disc between its previous and current physics positions.
2. `src/gameplay/frisbee.ts` returns the earliest capsule contact point, travel fraction, direction and a candidate body/head region. The region is diagnostic only; the server classifies the actual hit.
3. `src/gameplay/match.ts` displays a small temporary predicted contact and sends the exact contact point.
4. `server/room.ts` accepts or rejects the claim. An accepted `struck` carries its originating `throwId`; a rejected claim returns `hitRejected` to its claimant.
5. Only an accepted `struck` triggers the existing confirmed hit, kill, audio, score and round feedback.

The protocol is version 9 for the acknowledgement/rejection contract. Older clients are rejected by the existing version gate; no compatibility shim is claimed.

## Owner-selected combat audio

These production selections are retained without replacement:

- Body hit: `body-hit-v10.wav`
- Kill: `kill-v12.wav`
- Headshot: `headshot-v16.wav`
- Golden kill: `gold-kill-06-01.wav`
- Throw: `throw-whoosh-05.wav`

The original selections and clip ranges remain governed by `docs/VIDEO_AUDIO_LAB.md`. No additional sample library was downloaded or published for this work.

## Baseline and checks

Baseline HEAD at task start: `3a191d68cb4b2e6bebd6aeed77fa5fc85b7f9a3c` (`origin/main`).

| Check | Evidence | Result |
| --- | --- | --- |
| `npm ci` | 405 packages installed; audit reported 0 vulnerabilities | PASS |
| `npm test` baseline | 79/79 tests; about 92 seconds, primarily derived-world validation | PASS |
| `npm test` after contact, feedback and character-reaction changes | 83/83 tests; derived-world regeneration included | PASS |
| `npm run test:e2e:prod` baseline | Stale smoke expectation was 4 completed stages; runtime registers 5 | FAIL, root cause identified |
| Production smoke after expectation correction | Production preview, FF-01/rooms/Ammo fetch, entry flow | PASS |
| Full E2E baseline, parallel | 11/15 passed; failures were pointer-lock/test contention, wall-route assertion, stale leaderboard fixtures, execution contention | FAIL, investigated serially |
| Serial campus/game/route/execution specs | 6/6 passed in 1.2 minutes | PASS |
| `npm run typecheck` / `npm run lint` after combat implementation | Both commands exited successfully | PASS |
| `npm run build` | Production bundle completed; 1,884.22 kB main JS (483.06 kB gzip), existing >500 kB chunk warning | PASS with size warning |
| `npm run test:e2e:prod` | Production preview, asset/physics load and pointer-lock entry | PASS, 1/1 |
| Targeted audio-lab + multiplayer browser specs | Fixed dummy hit/death/respawn, execution camera, selected audio, leaderboard, account and networked combat | PASS, 5/5 |
| Full development browser suite, serial | 14/15 passed; east-entry S308/S309 test used a 10 s virtual movement step and could tunnel. Test now walks in 250 ms steps. The corrected route spec passes independently, but the full suite was not rerun after this test-only correction. | PARTIAL; no final suite-wide PASS |
| Live rendered training-dummy capture | Separate Chromium window against local Vite; idle, confirmed body reaction, death reaction, fixed-position respawn; zero page errors | PASS for the observed sequence |
| Baseline `typecheck` and `lint` | Ran after smoke correction | PASS |

The Ammo.js build logs a warning that scaled BVH triangle mesh shapes are unavailable. It is an existing runtime limitation, not introduced by Combat Feel 2.0.

## Implementation status

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Baseline stabilization | PASS | Loading-stage and leaderboard assertions aligned with current app; rig-mask deprecated API removed. Commit `d4127a6` pushed on `codex/combat-feel-2`. |
| Earliest swept contact | PASS | Contact point/fraction/direction/candidate region and deterministic earliest-target selection; pure geometry tests pass; multiplayer hit flow accepts exact contact. |
| Predicted vs confirmed hit | PASS | Version 9 protocol; accepted hits correlate by throw ID; rejected/duplicate claims remove the transient marker; `tests/browser/multiplayer.spec.ts` passed 2/2 and checks one prediction vs one server confirmation. |
| Rigged combat reactions | PASS for body/head/death event dispatch | Confirmed hits call existing `Hit_Chest` / `Hit_Head`; eliminations call `Death01`. A dead avatar keeps its last world pose long enough for the death clip, hides its name tag, then disappears; the audio-lab dummy respawns at its authored fixed point. Live screenshots and browser assertions cover body hit and death. |
| Disc flight / near-miss feedback | IN PROGRESS | Every flying disc emits a speed-gated pooled trail sample no faster than every 60 ms; a remote disc emits one spatial fly-by cue when its swept segment passes within 1.15 m at over 7 m/s. Real-time acceptance and performance profiling remain pending. |
| Feedback priority director | IN PROGRESS | Deduplication and HUD priority windows are implemented and unit-tested; round-result audio routes through the director. Full scenario coverage remains. |
| Throw animation and flight feedback | NOT RUN | Not implemented. |
| Character hit reactions | PARTIAL | Rigged reaction clips are connected and visually captured. Throw-specific animation remains unimplemented: the supplied animation set has no frisbee throw clip; firearm clips are intentionally not substituted. |
| Camera impulses / reduced motion | IN PROGRESS | Random per-frame camera jitter and random yaw kick removed; bounded damped position/FOV response leaves mouse aim unchanged. Off/Low/Normal mode and settings persistence are implemented. Unit test passes; browser QA pending. |
| Audio buses, attenuation, voice caps | IN PROGRESS | Combat/confirmation/environment/UI buses, master/combat/confirmation volumes, confirmation ducking, per-bus source caps, and ended-source cleanup implemented. Owner-selected clips remain intact; browser/performance evidence pending. |
| HUD hierarchy and duplicate suppression | IN PROGRESS | Hit/kill/golden/personal-damage/round-result priority windows and server-event dedupe are integrated. More combat and simultaneous-event browser coverage remains. |
| Blackout/final-showdown/victory presentation | NOT RUN | Pending. |
| Combat Feel Lab | NOT RUN | Existing audio lab not yet extended. |
| Performance / 2–32 player profiling | NOT RUN | No frame-time, draw-call, memory, or 2–32-player measurements recorded. Trail frequency is capped in code, but that is not a performance result. |
| Subjective human playtest | NOT RUN | No human acceptance claim. |
| Production deploy | NOT RUN | No deployment was authorized or performed. |

## Parameters and provenance

The contact scan uses the existing hit volume (`PLAYER_HIT.radius = 0.36 m`, `halfCore = 0.64 m`) plus the existing disc radius (`0.135 m`). It does not change disc speed, damage, server headshot threshold (`HEAD_ABOVE = 0.45 m`), or target capsule balance. The server still uses its existing reach and latency slack checks.

Rigged mannequin provenance, clips, skeleton, derived runtime GLB, and license are documented in `docs/CHARACTER_ASSET_AUDIT.md`. Current work does not replace the source character or animation assets.

## Rendered visual evidence

Captured in an independent Chromium window with real rendering enabled at 1440×900. The sequence ran in local offline practice with the fixed audio-lab dummy at `[-8.7, 0.92, 42.3]`; body hit dispatched `Hit_Chest`, a lethal hit dispatched `Death01`, and the dummy returned to 2/2 at the same coordinates. This verifies the event-to-animation path and visible scene state, not subjective motion quality or audio quality.

- Idle: [dummy-idle.png](evidence/combat-feel-2.0/dummy-idle.png)
- Body hit: [dummy-body-hit.png](evidence/combat-feel-2.0/dummy-body-hit.png)
- Elimination: [dummy-elimination.png](evidence/combat-feel-2.0/dummy-elimination.png)
- Respawn: [dummy-respawn.png](evidence/combat-feel-2.0/dummy-respawn.png)

## Outstanding acceptance

The overall mission remains incomplete. A frisbee-specific throw animation, full visual combat route, blackout/final-showdown presentation audit, audio/FX performance measurements, complete final E2E rerun after the route-test repair, and subjective playtest remain open. Never infer audio quality, animation smoothness or frame rate from build/test success.
