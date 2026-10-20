# George Protocol release checklist

## Required before production

- [ ] Merge/test the same implementation on both the Cloudflare and campus feature branches.
- [ ] Run the full unit suite, main/server typechecks, lint, production build, and Playwright suite on both branches.
- [ ] Pass a staging matrix for new client/new server and verify old protocol-15 clients are rejected with a usable update path.
- [ ] Verify the isolated staging Durable Object and campus test server use no production room/account/database.
- [ ] Have a human verify the authored M103 alcove, its entrance, terminal view, and FRC placement in the actual rendered campus scene.
- [ ] Decide whether reported-pose proximity is acceptable or add shared geometry/visibility validation before enabling competitive use.
- [ ] Decide whether George state must survive Durable Object eviction; current behavior safely resets the room and does not replay an outcome.
- [ ] Verify the control prompts against the eventual customizable keybinding system; current `E` and `P` prompts are fixed keys.
- [ ] Confirm account/round settlement and deployment ordering in staging. Publish protocol-16 frontend and Worker as a coordinated release.
- [ ] Keep production deployment and production data unchanged until all checks above are complete.

## Safety assertions

- [x] No real password, host credential, system reboot command, or cloud administration call is used.
- [x] Six-digit code is generated in the game room and is never broadcast.
- [x] The local streak fixture is gated by `COMBAT_TEST=1` and authenticated account resolution.
- [x] George outcome is a server-side, idempotent round outcome with no synthetic elimination stats.
- [x] Protocol-15 clients cannot silently join the new protocol-16 room.
