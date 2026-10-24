---
"@tellegen/engine": minor
---

Synthetic grid generation. `createSynthSession(request, options)` opens a
`BrowserSynthSession` on a dedicated generation worker, so cancelling a run
never touches the interactive studies; the options take `osm`, `places` and
`signal`. Each `advance()` runs one stage (`context`, `site_buses`,
`topology`, `electrify`, `dc_opf`, `calibrate` once per iteration, `ac_pf`,
`finalize`), and `run(onStep, signal)` loops them. `preview()` returns
transferred typed arrays for binary map layers, `report()` the
`GenerationReport`, `takeModule()` the PowerIO module with bus locations and
branch routes, and `ingest()` the same `IngestedCase` a dropped `.pio.json`
of that module produces; `exportGridfm()` writes GridFM graphkit JSON.
`source: "osm"` builds the grid from Overpass documents passed as the `osm`
option. `generateSynthetic` runs every stage in one request,
`syntheticOverpassQueries` returns the Overpass QL for a region, and
`loadSyntheticPlaces`, `fetchSyntheticPlaces` and `syntheticPlacesUrl` handle
the bundled Natural Earth places table, now shipped as
`data/populated_places.json`. Generator refusals reject with
`SynthEngineError` and its `code` (for example `osm_insufficient`). Request
and report types are generated from Rust and exported from
`@tellegen/engine/synth`. `EngineHost` gains `kind` (`"worker"` or
`"direct"`). Ingest payloads gain `coords_method`, which is
`"generated"` when the module's history records a synthetic generation,
so a generated grid's coordinates are not taken for a topology layout.
Generated rows keep their annotations under `extras.tellegen_synth`, and the
module is named `tellegen_synth_<request hash prefix>`. A ring edge that jumps
more than 180° of longitude (a region written across the antimeridian the
short way) is refused, request values are bounded well outside any real
system, and OpenStreetMap circuit counts are capped at 12 per way. The
generator adds about 0.8 MB to the wasm module (about 0.3 MB gzipped).
