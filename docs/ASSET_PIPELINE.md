# FF-01 runtime asset pipeline

## Source and derivative

The source archive `MAC_Campus_FF01_3D_Export.zip` was supplied locally and is not stored in this repository. The runtime model is the archive's unmodified `models/MAC_Campus_FF01.glb`, SHA-256 `2580173bb23c56961c033f4eafeb01dfd4eec047d5ebd2bee8fc9bf16c9a57a4`. Its root scale and authored coordinate system are preserved. It is explicitly `SOURCE_DERIVED_3D_UNVERIFIED`; dimensions and room boundaries are not field-surveyed.

`rooms.json` is a curated runtime derivative of the archive's `data/rooms.json`. It preserves model/frame metadata, all 165 room IDs and names, geometry status, and the 159 source polygons (including holes). It omits descriptions, access, capacity, sensor bindings, source PDFs, website configuration, and all other archive content. The six label-only spaces retain no invented polygons.

The hashes and counts are in `public/assets/campus/manifest.json`; `npm test` verifies the GLB header, source identity, structural node names, hash integrity, room counts, polygon shape, and omitted data fields. The original ZIP is never copied into Vite's public tree.

## Distribution boundary

These runtime assets are present only in the private GitHub repository and are served by the local/private build. No public deployment is configured. The model contains a detailed campus-derived floor, including room names and layouts; public distribution requires a separate asset/privacy review. The archive's sensor endpoint and demo content are excluded.

## Import behavior

PlayCanvas loads the GLB as a `container`, instantiates its render hierarchy without a transform adapter, and requires the model identity and structural node set expected by the manifest. Room color patches, floor linework, and label anchors are hidden in the runtime scene. Collision is added separately in M0.2 and is not inferred from every visible mesh.
