# Third-party runtime dependencies

| Package | Version | Maintainer | License | Purpose | Replacement cost |
| --- | --- | --- | --- | --- | --- |
| `@cf-wasm/photon` | `0.4.0` | `fineshopdesign` (package collaborator: Silvia O'Dwyer) | Apache-2.0 | Planned server-side decoding, dimension checks, and WebP normalization for user avatar uploads in Cloudflare Workers. The package is installed but is not yet used by an avatar endpoint. | Medium: replacement needs a WebAssembly image decoder compatible with `workerd`, plus renewed malformed-image and output validation. |
