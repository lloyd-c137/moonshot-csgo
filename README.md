# Moonshot Open World

A browser-first **first-person exploration game** based on the Moonshot Academy FF-01 architectural model.

> **Status: PLANNED, NOT YET PLAYABLE.** This repository currently hosts the engineering specification and instructions for coding agents. The game and source assets have not been bootstrapped or committed.

## Start here

1. Read [AGENTS.md](AGENTS.md), the mandatory working instructions for Codex and other coding agents.
2. Read [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) for architecture, milestone gates, collision strategy, tests, scope and risks.
3. Complete **M0.0**: scaffold the official [create-playcanvas](https://github.com/playcanvas/create-playcanvas) **First-Person Controller** starter in a temporary directory, then merge selectively.
4. Provide the **separately supplied** `MAC_Campus_FF01_3D_Export.zip` to the development environment; verify hashes and review sensitive campus data before adding any assets to this private repository.
5. Complete M0.1–M0.4 to produce the first real playable browser build.

## Stack

PlayCanvas Engine · TypeScript · Vite · Ammo.js · FF01 GLB · rooms.json. Desktop keyboard and mouse first. Single-player first.

## Intended milestones

| Milestone | Outcome |
| --- | --- |
| M0.0 | Official FPS starter, documented local/prod build |
| M0.1 | Real-scale GLB loaded correctly |
| M0.2 | Physical colliders, player movement, validated safe routes |
| M0.3 | Accurate room tracking and simple location HUD |
| M0.4 | Automated/browser tests, profiling, reproducible preview |
| M1 | Art-directed architectural details and ambience |
| M2 | Interactive world and discoveries |
| M3 | Optional multiplayer after explicit approval |

## Source integrity

The FF01 export has status `SOURCE_DERIVED_3D_UNVERIFIED`. It contains 165 labeled rooms/spaces, 159 inferred region polygons and 6 location anchors without a region polygon. Illustrative wall/seat heights and the floor-plan-derived geometry have **not** been independently surveyed. Treat game-authored rooms/doors/furniture as fictional embellishments and preserve spatial provenance.

The original ZIP contains source linework and potentially sensitive information about a real campus. Do not upload the complete ZIP or publish the level publicly without an asset/privacy/licensing review. M0 requires **no** third-party campus sensors or live environment telemetry.

## Agent kickoff prompt

```text
You are implementing the Moonshot Open World repository. Read AGENTS.md and
docs/IMPLEMENTATION_PLAN.md completely. Start with M0.0 only. Inspect the repo,
use the official create-playcanvas First-Person Controller starter in a temporary
directory, merge cleanly, keep the existing docs, pin dependencies, verify both
development and production physics operation, add honest tests and scripts, and
report PASS/FAIL/BLOCKED/NOT RUN with actual evidence. Do not fabricate or
substitute missing FF01 assets. Do not implement NPCs, multiplayer or unrelated
product surfaces.
```

## Upstream

- https://github.com/playcanvas/create-playcanvas
- https://github.com/playcanvas/engine
- https://developer.playcanvas.com/user-manual/getting-started/start-with-create-playcanvas/
