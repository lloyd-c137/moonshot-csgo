# Gameplay input coverage matrix

This matrix is executable: `test/input-coverage.test.js` verifies that every action has one row, a default binding, and a real source consumer. Browser QA verifies that the settings UI renders all rows, remapping updates a live hint, conflicts are surfaced and explicitly swapped, and reset persists.

| Action | Default | Context | Semantics | Consumer |
|---|---|---|---|---|
| moveForward | W | gameplay | hold | controller adapter, step assist |
| moveBackward | S | gameplay | hold | controller adapter, step assist |
| strafeLeft | A | gameplay | hold | controller adapter, step assist |
| strafeRight | D | gameplay | hold | controller adapter, step assist |
| sprint | Left Shift | gameplay | hold | controller adapter |
| jump | Space | gameplay | hold | controller adapter |
| crouch | C | gameplay | hold or toggle | crouch controller |
| throw | Mouse Left | gameplay | press and release | match charge/release |
| cancelThrow | Mouse Right | gameplay | press | match cancel |
| spectateNext | Mouse Left | spectator | press | spectator camera |
| inspect | F | gameplay | press | match inspect |
| interact | E | gameplay | press | match interactions |
| execute | V | gameplay | press and release | finisher hold |
| activeSkill | Enter | gameplay | press | main active-skill dispatch |
| chat | T | gameplay | press | main chat dispatch |
| map | M | gameplay | press | main map dispatch |
| scoreboard | Tab | gameplay | press and release | match scoreboard |
| recover | R | gameplay | press | main recovery |
| unstuck | G | gameplay | press | main stuck recovery |
| emote1 | 1 | spectator | press | match emote dispatch |
| emote2 | 2 | spectator | press | match emote dispatch |
| emote3 | 3 | spectator | press | match emote dispatch |
| skipCutscene | Space | cutscene | press | match cutscene dispatch |

The two default aliases are intentional and context-scoped: Mouse Left means throw while playing and next-player while spectating; Space means jump while playing and skip while a cutscene owns input. `Enter` is no longer a hidden chat fallback, and intro skip no longer has a hard-coded Enter bypass; this prevents remapped actions from continuing to trigger old physical keys.

## What the matrix does not claim

The matrix proves action registration and current source routing, not that every action was individually driven through every possible lifecycle state in a real browser. The full interaction-state browser matrix remains a release gate. Reserved browser/system shortcuts remain deliberately non-bindable.
