# @tellegen/engine

Parses cases, runs WebAssembly solves, and exposes `Study` preview, commit, and
sensitivity calls in browsers.

The package has no SvelteKit dependency. Host apps import the top level package and use either the direct functions or the `browserWasmTransport` facade:

```ts
import {
  browserWasmTransport,
  createStudy,
  ingestJsonDrop,
  solveModule,
} from "@tellegen/engine";
```

The wasm files are resolved relative to the package module. Host apps must serve
package asset files from `node_modules`.

Under a Content Security Policy the engine needs `script-src 'wasm-unsafe-eval'`
(to compile WebAssembly; never `'unsafe-eval'`) and `worker-src 'self'`: its
workers are same-origin module workers.

## Browser Ingestion

Case and JSON entry points accept the original bytes:

```ts
import { ingestCase, ingestJsonDrop } from "@tellegen/engine";

const bytes = new Uint8Array(await file.arrayBuffer());
const casePayload = await ingestCase(bytes, "raw");
const jsonPayload = await ingestJsonDrop(bytes);
```

Every solvable ingest payload includes `module_json`, a generation-2 PowerIO
IR module. Pass that value to `createStudy`, `solveModule`, and geographic
transforms. The engine does not expose a second network JSON boundary.

`ingestJsonDrop(bytes)` classifies and parses JSON in one call. Its
`IngestedJsonDrop` result is discriminated by `kind`: PowerIO modules have a
`null` format; transmission and distribution results carry the selected
format; `ambiguous` and `unknown` results have a `null` payload. Historical
bare model JSON is now `unknown`; regenerate it as `pio-ir` from source data.

Every API that accepts a byte buffer rejects inputs larger than
`MAX_ENGINE_INPUT_BYTES` (128 MiB) before worker dispatch.

## Synthetic Grid Generation

`createSynthSession(request, { osm?, places?, signal? })` generates a
geo-referenced transmission grid for a region, one stage per `advance()`, on a
dedicated worker. Request and report types come from `@tellegen/engine/synth`.
The populated places table ships as `dist/data/populated_places.json`;
`syntheticPlacesUrl()`, `fetchSyntheticPlaces()` and `loadSyntheticPlaces()`
locate and load it. The
[synthetic generation guide](https://eigenergy.github.io/tellegen/synthetic-generation.html)
describes the stages, the demand model and the evidence.

## Data Sources

The package ships data from third parties:

- **Natural Earth** populated places (`dist/data/populated_places.json`) and
  country areas (compiled into the wasm): public domain,
  [naturalearthdata.com](https://www.naturalearthdata.com/about/terms-of-use/).
- **Ember**, *Yearly Electricity Data*, through **Our World in Data**,
  *Energy dataset*: national electricity demand, compiled into the wasm.
  Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
  the table keeps each country's latest year, so changes were made. Its
  population column is Our World in Data's series, compiled from the sources
  at [ourworldindata.org/population-sources](https://ourworldindata.org/population-sources).
- **National transmission voltage levels**, compiled into the wasm from the
  operator, regulator and standards documents each entry cites.

Grids generated with `source: "osm"` contain data from OpenStreetMap, ©
OpenStreetMap contributors, under the ODbL 1.0. The
[third-party notices](https://eigenergy.github.io/tellegen/third-party-notices.html)
give the full credits.

## Migrating To 0.2

- Pass `Uint8Array` to `ingestCase`. For an existing string, use
  `new TextEncoder().encode(text)`.
- Replace `classifyJson(text)` with `await classifyJson(bytes)`. It now returns
  `{ kind, format }` instead of a kind string.
- If migrating code that imported `isStudyPackageText` from `@tellegen/svelte`,
  use `await ingestJsonDrop(bytes)`. A stored document reports `kind: "module"`;
  its payload determines whether it contains a supported balanced or
  multiconductor value.
- Update `JsonDropKind` handling: `bmopf` and `pmd` are now
  `kind: "distribution"` with a `format`; `not-json` is `unknown`; and
  `transmission` and `ambiguous` are additional outcomes.

## Generated types

`ENGINE_VERSION` is the package version. `API_SOURCE_SHA256` records the `crates/tellegen/src/api.rs` content used to generate `src/generated/api-types.ts`.

Run the generator after Rust API changes:

```sh
npm run types
```

CI runs `npm run build:engine` from the repository root, and that runs
`types:check`. Stale generated types fail the build.

Breaking changes to the generated types:

- Removing or renaming exported request or response fields.
- Changing field units, enum tags, formulation ids, solve status tags, or sensitivity operand/parameter shapes.
- Tightening a field from optional to required.

Nonbreaking changes:

- Adding optional fields.
- Adding new formulation ids, solve statuses, operands, or parameters when existing values keep their meaning.

## Release

Build and inspect the package from the repository root:

```sh
npm ci
npm run wasm
npm run build:engine
npm run pack:engine
```

`@tellegen/engine` is the lower level browser package for custom UIs and for the
Svelte package. It releases through Changesets with the other npm packages. The
hosted demo under `apps/web` is private and consumes `@tellegen/svelte` through
the same workspace file dependency used by the local examples.

## Citing

If you use this package in published work, please cite the tellegen paper:
Samuel Talkington, Frederik Geth, Qian Zhang, Le Xie, and Skyler Liu. 2026.
*Interactive Power Flow in the Browser*. The Inaugural ACM Conference on Digital
Transformation (ACM DXConf 2026), Ann Arbor, MI, USA.
[doi:10.1145/3847238.3849038](https://doi.org/10.1145/3847238.3849038). The
[repository README](https://github.com/eigenergy/tellegen#citing) has the BibTeX
entry.
