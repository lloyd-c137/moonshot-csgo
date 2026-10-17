# Campus model merge and 莲花球场 redesign plan

Status: **PLAN + REGISTRATION FINDINGS**. Nothing from the second model is imported yet. Every number below that is not marked as measured is GAMEPLAY_AUTHORED or SOURCE_UNVERIFIED.

## Inputs

| Input | Identity | Role |
| --- | --- | --- |
| FF-01 export (in repo) | `public/assets/campus/MAC_Campus_FF01.glb`, `rooms.json` (165 records, FF01-CAMPUS-3D-V1) | Geometric and gameplay base: colliders, nav audit, doorways, signage, spawns, patrol routes, execution/combat masks all derive from it. |
| Owner upload 2026-10-17 | `探月学校校园完整建模源码-2026-10-16_1_.zip`, SHA-256 `6f379b5b0ca172acc757bb0f8c452187f881042a114d0c49afa8a43175995af0`, 173 files | Next.js/Three.js "Campus Living Atlas": rooms traced from the 2026-08-06 plan (115 rooms), photo-derived interior archetypes, south-gate exterior, a twelve-petal stadium shell, a central court model. Not committed. |
| Owner reference photos 2026-10-17 | Aerial of the twelve-petal building; two interior views of the bowl (blue court, green apron, red lower seats, teal upper seats, blue/white ribbon boards, roof ring with an opening). | Visual reference for the stadium only; not measurements. |

## Registration findings (measured from the data, 2026-10-17)

- **Scale.** The upload's scene uses `world = (px − 863, py − 718) × 0.075`. The rooms' annotated drawing areas give a median of **0.094 m/px** (10th–90th percentile 0.086–0.109, 97 rooms), so the upload's scene is about 22 % too small. A least-squares similarity fit of the 101 rooms shared by both models gives **0.0960 m/px, rotation 0.23°, no reflection**; median centroid disagreement 2.1 m, 90th percentile 4.1 m, worst 10 m (different tracings of different drawings). FF-01's scale therefore agrees with the drawing areas and stays the base.
- **Frames.** Both use X east and +Z/pixel-y south; FF-01's 2D room polygons are already X/Z (the AGENTS.md "2D Y north" note does not match `rooms.json` → `frame.axes`). No flip is needed.
- **Room differences.** 13 rooms exist only in the upload: `A-I` 创新区, `M-T` 小剧场, `M-COFFEE` Moon Coffee, `A-TEA` 茶馆, `S-WC3` 大自习室, and eight restrooms (`M-WC1/2`, `S-WC4`, `A-WC5…9`). FF-01 alone has its `SVC-*`, `WC-*`, `STAIR-*`, courtyards, entrances and `THEATER-01`. Seven shared rooms are renamed by the newer drawing (e.g. S100 and S406 → 大自习室, S102 → 阅览室, A209 → 用途待核实).
- **Licensing.** The upload's `public/models/editor/` holds 50 Objaverse-XL/Sketchfab models, all CC BY (attribution required, per-object authors in its manifest). None are imported; any later use must carry the attribution in `docs/DEPENDENCIES.md` and the credits screen.
- **Privacy / publication.** This GitHub repository is publicly cloneable. The upload also contains the school logo, the 2026-08-06 plan PDF/PNG, a research proposal and a photo-survey workbook. None of these are committed; publishing the plan or logo needs the owner's explicit approval (AGENTS.md §6).

## What the merge takes from each model

1. **Keep FF-01 as the base** (scale, colliders, every derived gameplay file, tests).
2. **From the 2026-08-06 model, as additive GAMEPLAY_AUTHORED overrides keyed by room id**, transformed with the fitted similarity above:
   - names/kinds of the seven renamed rooms and the 13 new spaces (mapped onto FF-01 regions where they overlap, otherwise as label-only anchors — no invented polygons);
   - the photo interior archetypes (standard classroom, labs, maker, design studio, band/recording, dance, library, dining, teacher office, the A-I table-tennis activity area, the 大自习室 layout) rebuilt like `src/world/rooms/m104.ts`: furniture keeps real object sizes and is re-fitted into each FF-01 room outline (only building-level geometry is scaled by 0.096/0.075 = 1.28);
   - the south-gate exterior (canopies, green glass facade, tree-lined road, parking, bicycles, lamps).
3. **Rebuild the stadium** (below) rather than importing either model's version.

## 莲花球场 design (GAMEPLAY_AUTHORED, photo-proportioned)

Centre: FF-01 court centre ≈ (−8.4, −2.9). Existing doubles court lines (10.97 × 23.77 m) stay.

| Element | Design | Gameplay |
| --- | --- | --- |
| Court | Blue playing surface inside the lines, green apron to the arena edge, white lines, net with posts, umpire chair, two player benches, ball-kid positions (photos 2–3). | Unchanged floor and collision. |
| Lower bowl | The existing eight rows (to 3.1 m) become red tip-up seats on concrete treads, with a 1.0 m front wall carrying the blue/white ribbon board, radial stair aisles every 30°. | Walkable as today. |
| Concourse fascia | Replaces the plain 10 m perimeter wall: a 3.6–4.8 m fascia ring along the arena outline with twelve vomitory openings (the red section entrances in photo 3) and an LED ribbon band. | A glass balustrade plus an invisible barrier on top keeps living players out of the upper bowl. |
| Upper bowl | Twelve petal sectors rising outward at about 28° from 4.8 m to about 18 m, teal seats, grey radial aisles, one glass-railed cross-aisle at mid height. | Decorative for the living; **spectator seats** for the eliminated (see below). |
| Roof ring | Twelve cantilevered petals (outer edge 18.8 m, inner edge 20.8 m, alternating light greys) with truss ribs and the opening over the court, floodlight bars and hanging speakers on the inner edge. Proportions follow the upload's `stadium-shell.mjs`, fitted to FF-01 scale. | Sky remains visible through the opening; blackout/floodlight logic is kept. |
| Exterior | Twelve out-leaning facade petals around the building perimeter (aerial photo), seen from the south entrance and courtyards. | No collision change. |

Budget: seats are instanced/merged per material (target ≤ 40 extra draw calls on the existing profile), no textures beyond small procedural ones.

### Spectator stands (owner decision 2026-10-17)

During the final minute everyone still alive is brought to the court. Eliminated players appear in the upper bowl as seated figures in their own colour, assigned to seats spread across all twelve sectors (never near a vomitory a living player could see into). They can cheer, wave a light stick and throw confetti; living players see and hear the crowd. Seat positions are fixed per seat index, carry no information about anyone's location, and are unreachable from the court.

## Implementation phases and acceptance

1. Stadium geometry module + collision barrier; browser checks: court reachable, upper bowl unreachable, ceiling/sky over the opening, draw-call delta.
2. Spectator seats + emotes (protocol: seat assignment and emote events, rate-limited); two-client browser check that a spectator is seated and visible to a living player in the final minute.
3. Room names/kinds and new spaces (unit tests on the override table and room lookup).
4. Interior archetypes room by room (nav audit must keep every region reachable; doorway traversal tests).
5. South-gate exterior.

Each phase needs the full toolchain (vite, playcanvas, Playwright) and is not claimed until its browser checks pass.
