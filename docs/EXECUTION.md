# Back execution

## Meaning and rules

This is a short, optional finishing move initiated from close behind an opponent. Activision's description of *Call of Duty: Modern Warfare* Finishing Moves uses that same rear-proximity trigger and describes a short animation before elimination: [official overview](https://blog.activision.com/uk/en/call-of-duty/2020-01/Tips-Modern-Warfare-Finishing-Moves). Activision also documents that another player can interrupt a move while it is playing: [official guidance](https://blog.activision.com/ca/fr/call-of-duty/2020-04/The-Rank-Up-Report-25-IRL-Badass-Ronin-25-Warzone-Tip-Celebration).

Moonshot's version uses these game-authored conditions:

- Attacker is 0.55–1.45 m from the target, within 0.45 m vertically, behind the target, and facing it.
- Source-derived collision cells must be clear between both characters and in the target's short fall direction. These inferred campus cells are gameplay occlusion checks, not survey-grade geometry.
- Press **V** or use the on-screen **处决** button. The server locks both players and broadcasts the same start/end timestamps and frozen poses.
- Both participants receive the same fixed third-person camera and procedural paired character animation. Animation parts follow the game's existing simple capsule-avatar style; this is not motion capture or a licensed animation asset.
- Completion after 2.6 seconds eliminates the target for the rest of the round and switches them to spectating. The attacker returns to first person. A hit on either participant, a disconnect, or round change interrupts the move.
- Movement, frisbee throws, and other interactions are frozen for the pair. Spectators can continue watching.

The online room revalidates proximity, facing, pose freshness, spawn protection, availability, and collision mask before starting a move. Protocol version is 8; both the browser and Worker must be deployed together.

## Offline audio-lab dummy

In a development build, open `/?audioLab=1&offline=1`, press **P**, then select **去试音靶场并进入游戏**. The fixed mannequin now faces away from the player's practice position. The same behind/range/facing and collision checks show the execution button. Press **V** (or click the button) to see the local paired animation; completion plays the selected kill cue and the mannequin respawns at its original position after 2.5 seconds. Practice eliminations do not affect player stats.

## Mechanism quick triggers

While in the development audio lab, open **P → 机制快速测试** to directly trigger a local breaker outage, terminal night, or final-arena transition without walking to the electrical room or waiting for the round timer. **恢复测试状态** resets those local overrides. With the local test server connected, night and final-showdown triggers use the authoritative shared round clock; local fallbacks affect only this browser and never change scores.

## Source mask

`src/config/executionOcclusion.ts` is generated from the existing derived campus collision audit by `node tools/executionOcclusionCli.ts`. The generator uses 0.1 m cells and excludes only arena stands from the blocked mask; floor absence, walls, glazing, barriers, and furniture block an execution. It reads the local campus source through `tools/campusGeometry.ts`; do not substitute a fabricated map if the source is missing. The mask is an approximate conservative gate, not a replacement for the live Ammo raycast.

## Verification

Current automated evidence:

- Unit tests: rear/front/range/height/occlusion, server reservation and settlement, interruption, reconnect spectating, and animation sampling.
- Browser: offline fixed mannequin trigger/animation/respawn; two networked clients share an execution ID, camera, visible paired actors, and near-equal progress, then the target spectates.
- A rendered browser capture is saved locally at `test-results/execution-attacker.png` and `test-results/execution-target.png` when the execution browser test runs.

Hardware mouse latency and subjective animation feel have not been manually assessed.
