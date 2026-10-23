# Third Party Notices

This page records attribution sources for the repository and public demo. It
does not replace the license metadata in `Cargo.lock`, `package-lock.json`, or
the source distributions for each dependency.

## Project Code

The project, including the Rust crates and the npm packages
`@tellegen/engine` and `@tellegen/svelte`, is MIT licensed. See `LICENSE`.

The engine uses the W space SOCWR formulation as implemented in PowerModels.jl
as a formulation reference. PowerModels.jl is BSD 3-Clause licensed. The
tellegen implementation is independent.

## Direct Software Dependencies

Rust dependencies are resolved by Cargo and governed by `deny.toml`. Direct
runtime dependencies include `powerio`, `clarabel`, `faer`, `num-complex`,
`serde`, `serde_json`, `wasm-bindgen`, `console_error_panic_hook`, `axum`,
`tokio`, `tokio-stream`, `tower-http`, `tracing`, and `tracing-subscriber`.

The web app dependencies are resolved by npm. Direct dependencies include
SvelteKit, Svelte, Vite, TypeScript, deck.gl, MapLibre GL JS, Prettier,
`@fontsource-variable/bricolage-grotesque`, and `@fontsource/ibm-plex-mono`.

The repository does not modify or vendor those dependency sources. License and
notice files from dependencies are distributed through their normal package
archives.

## Populated Places

The synthetic grid generator ships `crates/tellegen-synth/data/populated_places.json`
(copied into `@tellegen/engine` as `data/populated_places.json`): name,
longitude, latitude, `pop_max` and country of the Natural Earth 1:10m
populated places. Natural Earth data is in the public domain
([naturalearthdata.com](https://www.naturalearthdata.com/about/terms-of-use/)).

It also ships `crates/tellegen-synth/data/national_demand.json`, compiled
into the engine: each country's annual electricity demand and population,
derived by `scripts/derive-national-demand.py` from Our World in Data's
energy dataset ([github.com/owid/energy-data](https://github.com/owid/energy-data)),
whose `electricity_demand` column comes from Ember's Yearly Electricity Data.
Both are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):
Ember, *Yearly Electricity Data*; Our World in Data, *Energy dataset*. The
table records the SHA-256 of the CSV it was derived from.

`crates/tellegen-synth/data/country_areas.json`, also compiled into the
engine, gives each country's area, measured by
`scripts/derive-country-areas.py` from Natural Earth's 1:50m admin-0
countries (public domain). `crates/tellegen-synth/data/voltage_ladders.json`
lists national transmission voltage levels with the operator, regulator and
standards documents each entry was taken from; it copies no dataset.

## Demo Case Data

The demo data is staged by the operator and is not vendored in this repository.

ACTIVSg synthetic grids come from the Texas A&M Electric Grid Test Case
Repository. The case file headers request this citation:

> A. B. Birchfield, T. Xu, K. M. Gegner, K. S. Shetye, and T. J. Overbye, "Grid
> Structural Characteristics as Validation Criteria for Synthetic Networks,"
> IEEE Transactions on Power Systems, 2017.

CATS comes from the WISPO POP CATS California Test System repository and is BSD
3 Clause licensed in that repository. The source repository requests this
citation:

> S. Taylor, A. Rangarajan, N. Rhodes, J. Snodgrass, B. C. Lesieutre, and L. A.
> Roald, "California Test System (CATS): A Geographically Accurate Test System
> Based on the California Grid," IEEE Transactions on Energy Markets, Policy and
> Regulation, vol. 2, no. 1, pp. 107-118, 2024.
> doi:10.1109/TEMPR.2023.3338568.

Embedded fallback cases are from PGLib OPF and are used only when
`TELLEGEN_ALLOW_FALLBACK=1` is set. PGLib OPF data is CC BY 4.0; the PGLib
software is MIT licensed.

## Maps

The web app uses CARTO map tiles with OpenStreetMap attribution. Keep the map
attribution visible in any hosted demo or derivative deployment.
