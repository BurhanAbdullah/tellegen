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
`"direct"`). The wasm module grows by about 0.6 MB.
