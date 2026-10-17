# Restroom mirrors

Every regional restroom record (`WC-01`–`WC-14`) receives one `GAMEPLAY_AUTHORED` mirror panel. Its mounting point is selected from an interior-tested straight edge of the room polygon. The campus GLB and imported room records are unchanged; their geometry remains source-derived and unverified.

When the player faces a mirror within 7 m, one shared 256 × 512 render target shows a local 2.10 m rigged character clone. The clone follows position, heading, and idle/walk/sprint state, and uses the account's versioned head image when available. The mirror camera is disabled outside that interaction range. For this first implementation, the image renders the character against a neutral backing; it does not reflect the surrounding room.

Validation:

- `node --test test/campus-rooms.test.js` checks all 14 room IDs and valid mount positions/normals.
- `npx playwright test tests/browser/restroom-mirrors.spec.ts --reporter=line` checks the mirror count, activation of the player reflection in WC-04, and removal of the two homepage rule facts.
