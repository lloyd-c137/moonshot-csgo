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

The separately owner-selected `buzzer.mp3` is used for the shared campus power-down cue (automatic three-minute blackout and manual breaker outage). Its original creator/license was not independently identified; the owner explicitly authorized public game release on 2026-10-16. Provenance and SHA-256 are recorded in `public/assets/audio/power-audio-provenance.json`.

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
| Targeted multiplayer combat browser test after throw animation | Two authenticated local clients; `thrown` event enters `Frisbee_Throw`, remote `upperarm_r` quaternion changes from its pre-throw value, then one confirmed body-hit reaction follows | PASS, 1/1; [rendered throw capture](evidence/combat-feel-2.0/remote-throw-release.png) shows the remote rig and disc in the actual campus |
| Full development browser suite, one worker | 15/15 passed in 2.5 min, including all 14 bidirectional doorway crossings, S308/S309 route, control flow, multiplayer hit/elimination, paired execution, and power-switch scenarios | PASS |
| Round outcome tests | Golden-disc win, last-survivor win, draw, and the corresponding result copy; targeted room/UI tests | PASS, 17/17 |
| Round-result rendered visual review | Browser-rendered golden win, last-survivor win, golden loss and draw cards; title, kicker and accent color are checked for each outcome | PASS, targeted browser visual test 1/1 |
| `npm test` after round outcome changes | Full unit suite including new no-holder draw and result-copy coverage | PASS, 86/86 |
| `npm run build` after round outcome changes | Production bundle completed; 1,886.64 kB main JS (484.01 kB gzip), existing >500 kB chunk warning | PASS with size warning |
| Multiplayer browser regression after round outcome changes | Two-client leaderboard and combat/account flow | PASS, 2/2 |
| Production smoke after round outcome changes | First run collided with a second simultaneous build/preview run and could not connect to port 4174; rerun against a single preview server passed the FF-01/physics/pointer-lock entry flow | PASS, 1/1 on clean rerun; initial failure was test-process contention |
| Blackout/floodlight fade browser regression | Local blackout visibly passes through nonzero pooled-light and fixture intensity before reaching zero; repair restores lighting; two clients receive the same authoritative outage/repair route | PASS, `tests/browser/power.spec.ts` 2/2 |
| Final-arena masked relocation | Development browser test verifies the relocation callback executes under an opaque curtain and the curtain fades away afterward; live round timing is not accelerated in this check | PASS for curtain sequencing, 1/1; actual last-minute round trigger NOT RUN |
| Typecheck/lint/build after lighting transition | TS client and Worker checks, ESLint, production bundle | PASS; bundle 1,887.05 kB raw / 484.27 kB gzip with existing chunk warning |
| Combat Feel Lab dummy presets | Development-only P panel buttons exercise shared dummy body-hit, headshot, normal elimination and golden-elimination feedback; browser test checks hit state, kill copy, respawn and golden confirmation | PASS, targeted browser test 1/1 |
| Body-hit visual clarity and reduced-flash behavior | Dual-client combat hit capture; the vignette rises from transparent to a reduced peak before fading over 280 ms, while reduced-flash uses lower peak values and both cues return to zero | PASS, targeted multiplayer capture 1/1 and reduced-flash browser test 1/1 |
| Practice execution copy regression | Shared dummy feedback initially replaced the execution-specific confirmation; restored `人偶 · 处决淘汰` while keeping the shared hit/effect pipeline | PASS, preset and execution browser tests 2/2 |
| Full development browser suite after fixes | Audio lab, dummy execution, every authored doorway, campus movement/interaction, route, multiplayer combat/execution and power-switch scenarios | PASS, 16/16 in 2.5 min |
| Production browser smoke at HEAD `1a8f92a` | Production preview loads FF-01 and physics, then enters through pointer lock | PASS, 1/1 |
| Production browser smoke after opt-in performance instrumentation | Current Vite production build, FF-01/physics fetch and pointer-lock entry | PASS, 1/1 |
| Combat Feel Lab tuning and production boundary | Development browser changes camera, particle, trail-density and trail-lifetime values; values remain active after closing the modal and the explicit reset restores the prior game settings. Production build excludes lab strings/styles and production preview entry works | PASS, targeted browser 1/1, typecheck, lint, build and production smoke 1/1 |
| Combat Feel Lab network latency | Development-only panel adds equal half-RTT delays to outgoing and incoming WebSocket messages after the initial handshake; delayed callbacks are discarded after reconnect. The panel reset restores the session's initial value. A two-client body hit at 200 ms keeps local prediction immediate, waits for one server-confirmed hit and preserves victim feedback | PASS, audio-lab 1/1 and multiplayer combat 1/1; unit suite 87/87, typecheck, lint, production build and production smoke 1/1 |
| Shared multiplayer blackout and final-showdown route | An authenticated dev-only round-clock endpoint broadcasts the same server round state to both clients. Both survive the blackout, receive the announcement, enter the final-showdown curtain, relocate to the derived arena area and return alive. The route test keeps both players outside the guard's sight during accelerated timing | PASS, targeted two-client browser test 1/1. The first run stopped at the initial physics-loading gate; a standalone browser check reached ready without JS errors and the clean rerun passed in 14.8 s. Test controls require `COMBAT_TEST=1` (set only by `server:dev`) and a valid account bearer token; production deploy does not set the flag. Capture: [final-showdown-curtain.png](evidence/combat-feel-2.0/final-showdown-curtain.png) |
| Combat Feel Lab match scenarios | Panel buttons use the authenticated local test endpoint to trigger shared blackout/final-minute state; local golden-win, loss and draw cards route through the actual result UI and round-result audio without changing match stats | PASS, audio-lab regression and shared multiplayer test; natural ten-minute timing remains NOT RUN |
| Final-showdown integration regression | `npm run typecheck`, `npm run lint`, `npm test`, targeted multiplayer route, production build and production browser smoke | PASS, 89/89 unit tests; targeted two-client route 1/1; production smoke 1/1. Build retains the existing >500 kB chunk-size warning |
| Combat HUD duration tuning | Development-only slider scales hit-marker, popup, elimination-broadcast and golden-kill animation/dismissal duration from 0.5× to 1.75×. Reset returns to the session-start value; production defaults stay at 1× | PASS, targeted audio-lab browser test verifies 1.5× applies and reset restores 1×; typecheck, lint, production build and production preview smoke 1/1 |
| Combat Feel Lab execution setup | P-panel shortcut stages the practice player behind the fixed mannequin; pressing V then runs the paired attacker/victim execution animation and fixed-position respawn flow | PASS, targeted browser test enters through the new shortcut and verifies the paired actor state, elimination and respawn at the original position; two-authenticated-player execution remains covered separately by the multiplayer suite |
| Blackout sky transition | Sky-dome emissive tint and camera clear color now ease over the same 650 ms window as the pooled interior lights; reversing a transition starts from the current visual mix | PASS, power-room browser test observes an intermediate sky-darkness value, reaches full night, then returns to the daylight value after repair; typecheck, lint and production preview smoke 1/1 |
| Audio voice-cap enforcement | Shared per-bus FIFO pool stops the oldest source at the configured cap and releases each slot/resource on the one-shot `ended` event | PASS, full unit suite 89/89 includes independent bus cap, oldest-source eviction and ended cleanup; production build and preview smoke 1/1 |
| Power-down buzzer | The selected 1.20 s clip is loaded through the environment audio path and plays on the shared blackout event used by both three-minute nightfall and manual breaker outage; the existing synthesized power-down remains a load-failure fallback | PASS, unit provenance/hash check; the real power-room browser route confirms the decoded 1.20 s buffer is scheduled once on breaker pull; production build contains the same SHA-256. Automatic three-minute audio playback has not been separately human-reviewed |
| Power-down audio regression | Full unit suite, targeted power-room browser test, typecheck, lint and production build | PASS, 90/90 unit tests and targeted browser 1/1; build keeps the existing >500 kB chunk-size warning |
| Full unit suite after audio-pool extraction | Existing room, account, source asset, animation, feedback, physics and server combat tests plus the new voice-pool tests | PASS, 89/89; 38.0 s |
| Production smoke after audio-pool extraction | Current production build and preview load FF-01, physics and pointer-lock entry | PASS, 1/1; main bundle 1,888.77 kB raw / 485.04 kB gzip with existing chunk-size warning |
| Two-client rendered combat sample | Both authenticated clients render the map and avatars while one server-confirmed body hit occurs. On one Apple M1 host / HeadlessChrome 155, attacker/victim median frame interval was 16.7 ms; P95 was 33.4 ms for each, with max draw calls 196 / 133 | PASS as a measurement, not a 60-FPS acceptance; same-host GPU contention is a limitation. Metrics: [performance-two-rendered-clients.json](evidence/combat-feel-2.0/performance-two-rendered-clients.json); captures: [attacker](evidence/combat-feel-2.0/performance-two-rendered-attacker.png), [victim](evidence/combat-feel-2.0/performance-two-client-victim.png) |
| Full unit suite after Combat Feel Lab tuning | Accounts/rooms, source and derived world integrity, avatar rig/grip/throw clips, combat feedback, camera impulse, and server combat rules | PASS, 87/87; 34.6 s |
| Rendered combat performance samples | Opt-in idle, body-hit and headshot-elimination samples on Apple M1 / HeadlessChrome 155 at 1280×720: 16.7 ms P95 frame interval throughout; headshot reached 136 P95 / 141 max draw calls. A two-client room sample with one rendered viewer, one authenticated non-rendering peer, and one server-confirmed body hit measured 16.8 ms P95 and 199 P95 / 200 max draw calls | PARTIAL; single rendered client only, no 2–32 rendered-player load |
| Damage vignette and reduced-flash checks | Multiplayer body hit captured from the victim client; reduced-flash test checks both cues have a 280 ms animation and end at zero; movement/sprint/pause/recovery route rerun | PASS, 3 targeted browser tests |
| Typecheck/lint/build/production smoke after damage-feedback adjustment | Client and Worker type checks, ESLint, production bundle and production entry smoke | PASS; 1,886.88 kB raw / 484.24 kB gzip, existing chunk-size warning |
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
| Damage feedback clarity | PARTIAL | Reduced the full-screen red vignette/wash and shortened the body damage cue from 600 ms to 280 ms. The animation now starts transparent and rises to a 0.48 peak; `reducedFlashes` lowers the vignette peak to 0.26 and directional-arc peak to 0.34, then both clear. Browser capture and end-frame checks pass. Audio quality and subjective comfort remain unverified. |
| Camera impulses / reduced motion | PARTIAL | Random per-frame camera jitter and random yaw kick removed; bounded damped position/FOV response leaves mouse aim unchanged. Off/Low/Normal mode and settings persistence are implemented. Unit tests cover bounds, deterministic damping, disabled mode, lab override clamp and restore; the development panel now offers a local camera-kick A/B slider. Full in-combat camera impulse visual QA remains pending. |
| Audio buses, attenuation, voice caps | PARTIAL | Combat/confirmation/environment/UI buses, master/combat/confirmation volumes, confirmation ducking, per-bus FIFO source caps and ended-source cleanup are implemented; cap and cleanup behavior now has unit coverage. Owner-selected clips remain intact. Browser verification of spatial direction/attenuation, voice concurrency under combat load, final volume balancing and subjective audio acceptance remain pending. |
| HUD hierarchy and duplicate suppression | IN PROGRESS | Hit/kill/golden/personal-damage/round-result priority windows and server-event dedupe are integrated. More combat and simultaneous-event browser coverage remains. |
| Round result distinction | PARTIAL | Server sends protocol-v10 outcome `golden-disc`, `last-survivor`, or `draw`; result card has distinct copy, outcome colors, and audio cue. Unit and room tests pass, and the development browser rendered and checked all three outcomes plus a loss state. Actual round-event timing and audio remain part of live play review. |
| Blackout/final-showdown/victory presentation | PARTIAL | Blackout ambience, pooled lights, fixture panels, sun and sky fade over about 0.65 s; the power-room browser route verifies the sky intermediate and endpoint values. Arena floodlights fade over 420 ms. Final relocation runs behind a short non-interactive curtain with stale-round/alive-state checks; the actual online final-minute branch has been exercised with a development-only local round clock and verified at the destination. Natural ten-minute timing and synchronized multi-client final relocation remain untested; round-result presentation still needs audio/visual review. |
| Combat Feel Lab | PARTIAL | Development-only P panel has repeatable body-hit, headshot, normal-elimination and golden-elimination presets, plus camera-kick, hit-particle density, flying-disc trail density/lifetime, 0–400 ms simulated RTT and 0.5–1.75× combat HUD-duration controls. Trail density scales the current 60 ms sample interval from 0–1.5×; trail lifetime adjusts existing tracer motes from 80–800 ms. RTT adds half the configured value to each send and receive; local hit prediction remains immediate and official outcomes remain server-confirmed. The panel also provides live blackout/final-minute controls for an explicitly connected local test server, golden-win/loss/draw card/audio previews, and a practice execution staging shortcut. Local overrides reset to their session-start values and are not saved. A one-click two-client synchronized execution preset remains pending. |
| Combat Feel Lab tuning controls | PASS for development preview and reset | `tests/browser/audio-lab.spec.ts` verifies all four runtime values change, remain active after closing the modal, and restore their previous values with the reset control. A real slow practice throw emitted at least four tracer samples with the selected density and lifetime. Production output was searched for lab UI strings and tuning styles; none were present. Visual capture: [combat-feel-lab-tuning.png](evidence/combat-feel-2.0/combat-feel-lab-tuning.png). |
| Simulated RTT behavior | PASS for configured 200 ms | Existing two-client campus combat path now runs with 200 ms simulated RTT: prediction increments before the official claim, server health changes once, and the confirmed event still drives the hit reaction. The lab control and reset are covered separately. Build output keeps the setter inert outside `import.meta.env.DEV`. |
| Real practice-disc tracer emission | PASS for visible trail in the captured practice throw; subjective tuning NOT RUN | Browser test launches a disc through the normal practice throw path and confirms tracer samples increase while the tuned values are active. The capture shows the live disc and bright trail motes against the open arena; it does not establish final A/B tuning or subjective feel: [combat-feel-lab-trail-live.png](evidence/combat-feel-2.0/combat-feel-lab-trail-live.png). |
| Performance / 2–32 player profiling | PARTIAL | Reproducible opt-in samples cover solo idle, fixed-dummy body hit and headshot elimination, a shared-room case with one rendered viewer and one non-rendering peer, and a new two-rendered-client hit sample. Solo and one-rendered-client cases recorded about 16.7–16.8 ms P95; with both clients rendering on the same Apple M1 host, both medians were 16.7 ms but P95 rose to 33.4 ms while draw-call maxima were 196 / 133. That shared-host result is not evidence for separate player machines and misses a stable 60-FPS P95 target. 8–32 rendered-player load, movement, memory growth, audio polyphony and release-browser profiling remain NOT RUN. |
| Subjective human playtest | NOT RUN | No human acceptance claim. |
| Production deploy | NOT RUN | No deployment was authorized or performed. |

## Parameters and provenance

The contact scan uses the existing hit volume (`PLAYER_HIT.radius = 0.36 m`, `halfCore = 0.64 m`) plus the existing disc radius (`0.135 m`). It does not change disc speed, damage, server headshot threshold (`HEAD_ABOVE = 0.45 m`), or target capsule balance. The server still uses its existing reach and latency slack checks.

Rigged mannequin provenance, clips, skeleton, derived runtime GLB, and license are documented in `docs/CHARACTER_ASSET_AUDIT.md`. Current work does not replace the source character or animation assets.

The rendered-scene samples can be reproduced with `COMBAT_PERF=1 npx playwright test tests/browser/performance-sample.spec.ts`. They are intentionally opt-in and have no machine-specific FPS pass threshold. Raw environment and metrics are recorded in [performance-solo-rendered.json](evidence/combat-feel-2.0/performance-solo-rendered.json).

## Rendered visual evidence

Captured in an independent Chromium window with real rendering enabled at 1440×900. The sequence ran in local offline practice with the fixed audio-lab dummy at `[-8.7, 0.92, 42.3]`; body hit dispatched `Hit_Chest`, a lethal hit dispatched `Death01`, and the dummy returned to 2/2 at the same coordinates. This verifies the event-to-animation path and visible scene state, not subjective motion quality or audio quality.

- Idle: [dummy-idle.png](evidence/combat-feel-2.0/dummy-idle.png)
- Body hit: [dummy-body-hit.png](evidence/combat-feel-2.0/dummy-body-hit.png)
- Elimination: [dummy-elimination.png](evidence/combat-feel-2.0/dummy-elimination.png)
- Respawn: [dummy-respawn.png](evidence/combat-feel-2.0/dummy-respawn.png)
- Networked frisbee release: [remote-throw-release.png](evidence/combat-feel-2.0/remote-throw-release.png)
- Victim-side body damage: [victim-damage.png](evidence/combat-feel-2.0/victim-damage.png)
- Golden-disc win result: [round-result-golden-win.png](evidence/combat-feel-2.0/round-result-golden-win.png)
- Last-survivor win result: [round-result-survivor-win.png](evidence/combat-feel-2.0/round-result-survivor-win.png)
- Loss result: [round-result-loss.png](evidence/combat-feel-2.0/round-result-loss.png)
- Draw result: [round-result-draw.png](evidence/combat-feel-2.0/round-result-draw.png)
- Fixed-dummy body-impact performance capture: [performance-body-hit.png](evidence/combat-feel-2.0/performance-body-hit.png)
- Fixed-dummy headshot-elimination performance capture: [performance-headshot.png](evidence/combat-feel-2.0/performance-headshot.png)
- Shared-room confirmed body-hit performance capture with one renderer: [performance-two-client-hit.png](evidence/combat-feel-2.0/performance-two-client-hit.png)
- Two-rendered-client victim-side body-hit capture: [performance-two-client-victim.png](evidence/combat-feel-2.0/performance-two-client-victim.png)
- Combat Feel Lab tuning controls: [combat-feel-lab-tuning.png](evidence/combat-feel-2.0/combat-feel-lab-tuning.png)
- Live practice-disc trail: [combat-feel-lab-trail-live.png](evidence/combat-feel-2.0/combat-feel-lab-trail-live.png)
- Final-showdown curtain and announcement: [final-showdown-curtain.png](evidence/combat-feel-2.0/final-showdown-curtain.png)

## Outstanding acceptance

The overall mission remains incomplete. A full visual review of frisbee release timing and hand/disc alignment, subjective A/B trail tuning, natural ten-minute final-minute timing, subjective listening review of the new buzzer and other audio timing during real round outcomes, 8–32 rendered-player profiling, longer memory/audio-voice measurements, and subjective playtest remain open. The new two-page same-host sample shows 33.4 ms P95 under concurrent rendering and needs a separate-machine or single-renderer multiplayer profile before drawing a production performance conclusion. Never infer audio quality, animation smoothness or frame rate from build/test success.
