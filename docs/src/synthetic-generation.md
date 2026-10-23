# Synthetic Grid Generation

`tellegen-synth` generates a geo-referenced transmission grid for a region
drawn on a map, validates it with the engine's DC optimal power flow and AC
power flow, and reports every verdict as the engine returned it. The result
is a PowerIO `BalancedNetwork` module whose buses carry locations and whose
branches carry routes, plus a `GenerationReport`. The crate is part of the
one wasm module (feature `synth`), so the whole pipeline runs in the
browser; the CLI runs the same code natively.

The grids are synthetic. Topology, impedances, ratings, loads and generation
are modelled from the region's geography and population with the cited
tables below, so a generated grid resembles a transmission system without
describing any real one. OpenStreetMap mode maps real substations, lines and
plants, but its electrical parameters and loads stay modelled.

## Stages

A session runs one bounded stage per call. The calibration stage runs once
per iteration.

| Stage | Work |
| --- | --- |
| `context` | parse and measure the region (spherical area, landmasses, island groups); resolve bus count, peak demand and fuel mix |
| `site_buses` | anchor buses on the most populous places, fill the rest with blue noise; allocate population-weighted loads |
| `topology` | per island, a minimum spanning tree, a tree over the highest-voltage buses, a Gabriel mesh up to the branch factor, and high-voltage loops, all from one Delaunay triangulation |
| `electrify` | site generation; design every corridor; run the corridor plan and the reactive plan; build the PowerIO network |
| `dc_opf` | the engine's DC OPF per island |
| `calibrate` | one recorded calibration step per call |
| `ac_pf` | the engine's AC power flow per island at the DC OPF dispatch |
| `finalize` | wrap the network in a module with its producer and history |

Every stage up to `electrify` is O(n log n). The library reads no clock, no
filesystem and no platform randomness. Each stage draws from its own ChaCha8
stream seeded from the request seed, so the same request and places table
give the same module, byte for byte, natively and in wasm.

## Parameters

Every constant lives in `crates/tellegen-synth/src/electrical/params.rs`
with a `source:` comment.

Line classes. Representative ACSR bundles from Glover, Overbye and Sarma,
*Power System Analysis and Design*; SIL from Kundur, *Power System Stability
and Control*, Table 6.1:

| Class kV | r Ω/km | x Ω/km | b µS/km | thermal MVA | SIL MW |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 138 | 0.11 | 0.48 | 3.4 | 180 | 50 |
| 230 | 0.06 | 0.45 | 3.8 | 500 | 140 |
| 345 | 0.03 | 0.35 | 4.8 | 1200 | 400 |
| 500 | 0.02 | 0.30 | 5.6 | 2500 | 900 |
| 765 | 0.012 | 0.26 | 6.5 | 4500 | 2200 |

- **Voltage levels between classes.** A requested level such as 220 kV or
  34.5 kV takes the nearest class's conductors at its own voltage. Its
  thermal rating scales with the voltage (same ampacity, `S = √3 V I`), and
  its SIL with the square (same surge impedance, `SIL = V² / Zc`).
- **Ratings.** A line's rating is the lesser of its thermal rating and SIL
  times the St. Clair loadability. The loadability curve follows Dunlop,
  Gutman and Marchenko (1979): 3.0 SIL up to 80 km, 1.0 at 480 km. A rating
  is never raised above what the conductor and length allow.
- **Transformers.** Impedance follows the size class: 8, 10 or 12% on the
  unit's own base, after IEEE C57.12.10 and Grainger and Stevenson. Banks
  are sized for the larger of local load and local generation, with 20%
  headroom. Buses sit at their own base kV, so the off-nominal tap is 1.0;
  the winding ratio is recorded in the branch extras.
- **Generation.** Fuel unit sizes and costs come from EIA-860 and the EIA
  Electric Power Monthly. Installed capacity is (1 + reserve margin) × peak
  load, with an 18% default margin. No bus collects more generation than
  its class can evacuate: 400 MW at 115–161 kV, 1.2 GW at 230 kV, 2.7 GW at
  345 kV and 4 GW at 500 kV, following the interconnection voltages of the
  largest U.S. plants. Shares above a cap spill onto other units or onto
  the next ranked bus.

## Planning before validation

A generated grid is planned so that it is feasible by construction, not
repaired after a solver refuses it. No number in a report is adjusted after
a solve.

- **Planning case.** The planning case is peak load under the least-cost
  dispatch of the generators (equal incremental cost) on a lossless DC power
  flow: the grounded Laplacian, solved by Jacobi-preconditioned conjugate
  gradients.
- **Voltage class by power and distance.** A corridor that would need more
  than two circuits at its voltage raises its ends to the next level.
- **Capacity.** Circuits are added until no circuit runs above 90% of its
  rating in the planning case; this is Garver's flow-driven expansion under
  the NERC TPL-001 base-case requirement. A transformer corridor first takes
  a larger bank, up to the rating of its line.
- **Stability margin.** Each line within its own St. Clair rating can still
  add up to too wide an angle along a chain. So the plan holds every
  island's angle spread to asin(0.7) ≈ 44.4°, the St. Clair curve's 30%
  steady-state margin, reinforcing the corridors a first-order spread
  sensitivity ranks highest.
- **Branch factor.** Circuits the requested branch factor still leaves go
  where the planned loading is heaviest. The plan exceeds the factor only
  when capacity or the margin needs more, and then raises the
  `branch_target_exceeded` warning.
- **Reactive plan.** The reactive plan holds a flat profile at the
  generator set point (1.02 pu). It solves the AC active-power equations for
  the angles at the planning dispatch (fast decoupled P–θ, Stott and Alsaç
  1974), then installs a capacitor bank or a shunt reactor wherever a bus
  needs more reactive power than half its machines' capability provides.
  Reactive power does not travel far (Kundur §11.2), so it is supplied where
  it is used. This plan covers line charging, series absorption and the
  share resistance moves to the receiving end.

The plan is recorded in `GenerationReport.planning`: rounds, promoted
buses, capacity, stiffening and filler circuits, enlarged banks, angle
spread, and banks and MVAr installed. Each circuit is its own branch row;
its annotation in `GenerationReport.elements` gives the corridor's circuit
count (`circuits`) and the branch's 1-based place among them
(`circuit_index`).

## Validation and calibration

- **Islands.** The DC OPF and the AC power flow run per electrical island,
  each with its own reference bus.
- **HVDC.** Links are replaced by fixed transfers on a validation copy,
  because the engine's models do not read HVDC rows.
- **Failures.** An infeasible DC OPF is reported as infeasible with the
  engine's message; nothing is shed. Load shedding is off in the portable DC
  OPF, so unserved energy is 0 when optimal and absent otherwise. An AC
  power flow that does not converge is reported as such.
- **Calibration.** Calibration is a recorded search over declared parameters
  against a declared objective:
  - parameters: rating scale per class and capacity scale per fuel within
    [0.8, 1.5], rating notches on binding branches, and load scale only on
    request;
  - objective: DC infeasibility, worst loading above target,
    under-utilisation, binding fraction, reserve margin, plus the structural
    terms the parameters cannot move.
- **Calibration steps.** Every candidate is an exact DC OPF re-solve; a step
  that does not improve the objective is rejected and undone. The status
  says `Unchanged` when nothing improved, and the final objective is the
  measured one.

## OpenStreetMap mode

With `source: "osm"` and an Overpass document (one, or the two halves of an
antimeridian-crossing region), the grid is built as follows:

1. Substation sites within 500 m cluster, and each voltage level at or
   above 110 kV gets a bus, with a transformer between consecutive levels.
2. Fragmented ways stitch where exactly two ends meet away from a station.
3. Untagged voltages are inferred from the endpoints, and line ends snap to
   the bus of their voltage within 2 km. Parallel ways aggregate into one
   corridor.
4. DC ways between converters become HVDC rows.
5. Plants snap within 10 km; makeup units cover a shortfall against the
   reserve margin.
6. The island policy applies: `connect` (default), `cut` or `keep`.

Mapped circuits are real, so the corridor plan only measures them; the
reactive plan still applies. A network too thin to use is the typed
`osm_insufficient` refusal. The caller decides whether to rerun
synthetically; the generator never switches on its own. The Overpass QL
comes from the engine (`syntheticOverpassQueries`), so its text exists once.

## Using it

In the browser (`@tellegen/engine`):

```ts
import { createSynthSession } from "@tellegen/engine";

const session = await createSynthSession({ region: { geometry, label: "Portugal" } });
const report = await session.run((step, preview) => {
  // step.stage, step.progress; preview holds typed arrays for binary map layers
});
const moduleJson = await session.takeModule(); // pio-ir with Bus.location and Branch.route
const ingest = await session.ingest();         // the drop payload of that module
session.free();
```

- **Host.** Sessions run on a dedicated worker (`synthEngineHost()`).
  Cancelling one terminates only that worker, so interactive studies are
  untouched.
- **Places table.** The Natural Earth table (public domain) ships in the
  package and loads once per worker.
- **Types.** Request and report types are generated from Rust under
  `@tellegen/engine/synth`.
- **Coordinates.** The ingest payload has `coords_kind: "synthetic"` and
  `coords_method: "generated"`: the buses are sites chosen on real
  geography, not a topology layout, and the case panel says so.

From the command line:

```sh
tellegen generate --request request.json --out run/ --export matpower,psse35 --gridfm
tellegen stats --case case.m          # or a PowerIO module on stdin
```

Exports go through the engine's `Study.export`: MATPOWER, PSS/E (v33, v34,
v35, RAWX), PowerWorld, PSLF, PowerModels JSON, pandapower JSON and the IIDM
formats. The GridFM graphkit JSON writer belongs to `tellegen-synth`, because
PowerIO's `gridfm` format is the Parquet dataset layout.

## Limits

- Requests are capped at 3000 buses. Generation of 3000 buses takes about
  350 ms natively end to end.
- Clustering in generated grids runs higher than in the ACTIVSg200 and
  GOC500 references, because the Gabriel mesh is rich in triangles. Their
  highest nodal degree is also lower, since the mesh caps it at 8.
  `evidence/synth` measures both against the references.
- Very heavy aggregation (for example 190 GW on a few hundred buses with a
  500 kV ceiling) can exhaust the corridor plan. The report then raises
  `planning_incomplete`, and the AC power flow may not converge; both are
  reported as such.
- The engine's AC power flow starts from a flat profile. On long, weakly
  coupled systems it can settle on a second, high-voltage solution even
  when the planned operating point is valid. A warm start from the stored
  case state, once the engine offers it, removes this.
