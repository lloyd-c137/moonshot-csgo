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

The protocol is version 10: version 9 added authoritative hit acknowledgement/rejection, and version 10 adds the server-authored round outcome (`golden-disc`, `last-survivor`, or `draw`). Older clients and workers are rejected by the existing version gate; no compatibility shim is claimed.

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
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` after throw animation | Throw track and remote-avatar test changes included; 84/84 unit tests | PASS; existing bundle-size warning remains |
| Targeted multiplayer combat browser test after throw animation | Two authenticated local clients; `thrown` event enters `Frisbee_Throw`, remote `upperarm_r` quaternion changes from its pre-throw value, then one confirmed body-hit reaction follows | PASS, 1/1 |
| Full development browser suite, one worker | 15/15 passed in 2.5 min, including all 14 bidirectional doorway crossings, S308/S309 route, control flow, multiplayer hit/elimination, paired execution, and power-switch scenarios | PASS |
| Round outcome tests | Golden-disc win, last-survivor win, draw, and the corresponding result copy; targeted room/UI tests | PASS, 17/17 |
| `npm test` after round outcome changes | Full unit suite including new no-holder draw and result-copy coverage | PASS, 86/86 |
| `npm run build` after round outcome changes | Production bundle completed; 1,886.64 kB main JS (484.01 kB gzip), existing >500 kB chunk warning | PASS with size warning |
| Multiplayer browser regression after round outcome changes | Two-client leaderboard and combat/account flow | PASS, 2/2 |
| Production smoke after round outcome changes | First run collided with a second simultaneous build/preview run and could not connect to port 4174; rerun against a single preview server passed the FF-01/physics/pointer-lock entry flow | PASS, 1/1 on clean rerun; initial failure was test-process contention |
| Blackout/floodlight fade browser regression | Local blackout visibly passes through nonzero pooled-light and fixture intensity before reaching zero; repair restores lighting; two clients receive the same authoritative outage/repair route | PASS, `tests/browser/power.spec.ts` 2/2 |
| Typecheck/lint/build after lighting transition | TS client and Worker checks, ESLint, production bundle | PASS; bundle 1,887.05 kB raw / 484.27 kB gzip with existing chunk warning |
| Combat Feel Lab dummy presets | Development-only P panel buttons exercise shared dummy body-hit, headshot, normal elimination and golden-elimination feedback; browser test checks hit state, kill copy, respawn and golden confirmation | PASS, targeted browser test 1/1 |
| Practice execution copy regression | Shared dummy feedback initially replaced the execution-specific confirmation; restored `人偶 · 处决淘汰` while keeping the shared hit/effect pipeline | PASS, preset and execution browser tests 2/2 |
| Full development browser suite after fixes | Audio lab, dummy execution, every authored doorway, campus movement/interaction, route, multiplayer combat/execution and power-switch scenarios | PASS, 16/16 in 2.5 min |
| Production browser smoke after all current changes | Production preview loads FF-01 and physics, then enters through pointer lock | PASS, 1/1 |
| E2E determinism fixes | Serial Playwright workers avoid full-scene virtual-clock/software-WebGL contention; route/control tests grant temporary developer-only teacher grace except where detention is directly tested; route wall-stop tolerance matches measured capsule stop | PASS, full suite above |
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
| Throw animation and flight feedback | PARTIAL | A custom 0.72 s upper-body additive frisbee throw track is attached to the rig at load. Remote clients start at its authored release marker when the server `thrown` event arrives, then play the follow-through. Browser E2E confirms the action state and a changed remote upper-arm quaternion with rendering active. Full visual review of release timing, hand/disc alignment, and trail tuning remains. |
| Character hit reactions | PARTIAL | Rigged body/head/death reaction clips are connected and visually captured. The provided clips do not include a frisbee throw, so the dedicated throw action is authored as an upper-body additive track; its gameplay dispatch and bone response are browser-tested, while its visual quality review remains. Firearm clips are intentionally not substituted. |
| Camera impulses / reduced motion | IN PROGRESS | Random per-frame camera jitter and random yaw kick removed; bounded damped position/FOV response leaves mouse aim unchanged. Off/Low/Normal mode and settings persistence are implemented. Unit test passes; browser QA pending. |
| Audio buses, attenuation, voice caps | IN PROGRESS | Combat/confirmation/environment/UI buses, master/combat/confirmation volumes, confirmation ducking, per-bus source caps, and ended-source cleanup implemented. Owner-selected clips remain intact; browser/performance evidence pending. |
| HUD hierarchy and duplicate suppression | IN PROGRESS | Hit/kill/golden/personal-damage/round-result priority windows and server-event dedupe are integrated. More combat and simultaneous-event browser coverage remains. |
| Round result distinction | PARTIAL | Server sends protocol-v10 outcome `golden-disc`, `last-survivor`, or `draw`; result card has distinct copy, outcome colors, and audio cue. Unit and room tests pass; rendered visual review of each result card remains. |
| Blackout/final-showdown/victory presentation | PARTIAL | Blackout ambience, pooled lights, fixture panels and sun fade over 0.65 s; arena floodlights fade over 420 ms. Browser test checks the blackout light transition and multiplayer repair route. Sky color still changes immediately; final arena relocation is still abrupt; round-result presentation has not had visual review. |
| Combat Feel Lab | PARTIAL | Development-only P panel now has repeatable body-hit, headshot, normal-elimination and golden-elimination presets that invoke the same local dummy response path as practice hits/execution. The broader latency, trail, particle, HUD-duration, blackout, final-showdown, victory and two-player execution preset set remains pending. |
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

The overall mission remains incomplete. A full visual review of frisbee release timing and hand/disc alignment, the full visual combat route, final-arena relocation and result-card presentation, the remaining Combat Feel Lab scenarios, audio/FX performance measurements, and subjective playtest remain open. Never infer audio quality, animation smoothness or frame rate from build/test success.
