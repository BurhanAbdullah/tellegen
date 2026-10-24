---
"@tellegen/engine": minor
---

Plain names for the generated types and version constants. `CONTRACT_VERSION`
is now `ENGINE_VERSION` (the package version), `CONTRACT_SOURCE_SHA256` is now
`API_SOURCE_SHA256` (the hash of `crates/tellegen/src/api.rs` the types were
generated from), and the `@tellegen/engine/contracts` subpath is now
`@tellegen/engine/types`. `@tellegen/engine/synth` is unchanged.
