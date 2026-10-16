# Character asset audit

## Source

- Supplied archive: `Universal Animation Library[Standard].zip`
- Archive SHA-256: `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724`
- Source: Quaternius, Universal Animation Library Standard, CC0 1.0 Universal (the archive includes `License.txt` and `README.txt`).
- Selected source: `Unity/UAL1_Standard.fbx`; `UAL1_Standard_RM.fbx` is excluded because its clips include root motion. The supplied FBX, GLB and RM variants contain the same character, skeleton and 43 action names.
- Standard source FBX SHA-256: `21b32d912da3cb93426d974fb945e86f5b2e86970acd2ce89905e0fbf9f1dcc2` (23,754,684 bytes).
- Standard source GLB SHA-256: `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997` (7,618,436 bytes).
- Root-motion variant SHA-256: `be684571ed655a1b892c2c07e6e2aeca053b606c442d34004adaf1d944090d01` (7,620,504 bytes).

## Structural findings

- glTF 2.0, one skinned `Mannequin` mesh, two source material primitives (`M_Main`, `M_Joints`), 13,744 triangles, 8,546 vertices, and one 65-joint skin.
- Required humanoid landmarks are present: `Head`, `neck_01`, `spine_01`–`spine_03`, `hand_l`/`hand_r`, `thigh_l`/`thigh_r`, and `foot_l`/`foot_r`. Head height is 1.829 m in the glTF Y-up coordinate system; body width is about 1.944 m and depth about 0.370 m. This is visual geometry only and does not change gameplay collision or hit tests.
- Every mesh primitive has `JOINTS_0`, `WEIGHTS_0`, `TEXCOORD_0` and `TEXCOORD_1`. The source head UVs are unusable: every UV on faces dominated by the `Head` bone is `(0, 1)`, yielding zero UV area. The head is not a separate node; it is a material region of the skinned mesh. There are no embedded image textures.
- The standard GLB has 43 named full-body clips, including `Idle_Loop`, `Walk_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`, `Jump_Start`, `Jump_Loop`, `Jump_Land`, `Hit_Chest`, `Hit_Head`, `Death01`, `Idle_Torch_Loop`, `Interact`, and `Pistol_*`. There is no frisbee throw clip and no paired execution clip.
- The selected Standard file is the no-root-motion variant. Movement remains owned by the existing capsule and network pose.

## Runtime derivation

`tools/prepareCharacter.py` imports the original FBX in Blender, leaves its armature and weighted mesh intact, gives faces fully weighted to `Head` a distinct `M_Head` material region, and generates a back-seamed cylindrical UV map for those faces. Other source faces and their UVs remain as authored. The first GLB import/export trial lost one non-degenerate triangle in Blender 4.5.10, while the provided FBX imports with all 13,744 triangles and all 43 actions; the FBX is therefore the conversion source. PlayCanvas's GLB parser supports one `JOINTS_0`/`WEIGHTS_0` set, so export keeps the four largest FBX influences and normalizes them, matching the supplied GLB's four-influence runtime representation. The output is a derivative; the archived source FBX and CC0 notice are retained separately.

The conversion was run with official Blender 4.5.10 LTS for Apple Silicon. The downloaded DMG SHA-256 matched Blender's published checksum: `cf3076fd531e74713f858830b558e71ffae7b26f104608c5c2cb2fc123535f16`.

## Compatibility gaps and status

The source covers locomotion, jump/landing, hit reactions, death, torch-idle and several generic actions. Frisbee-ready/throw/release and paired execution must be authored or otherwise supplied before those states can be represented accurately. This pack does not contain a character-specific attachment object for the frisbee or flashlight; runtime hand-bone attachment points need to be verified against actual animation poses.

The processed GLB is 3.37 MB, retains 13,744 triangles, 65 joints and 43 clips, and adds a non-degenerate `M_Head` material with a back seam. These are structural checks only. Browser validation is still needed for UV appearance, shading, clip playback, material isolation, actual height and 32-character performance.
