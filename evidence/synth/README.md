# Synthetic Generation Evidence

Generated grids, measured the same way as reference cases. `run.py` drives the
native CLI (`tellegen generate`, `tellegen stats`), records the hashes of
everything it ran (CLI binary, places table, specs, reference table), and
writes every verdict as the engine returned it.

```sh
cargo build --release -p tellegen-cli
# Measure the reference cases staged in the repository.
python3 evidence/synth/run.py references --tellegen target/release/tellegen
# Generate every spec and seed, then compare.
python3 evidence/synth/run.py run evidence/synth/specs/*.json \
  --tellegen target/release/tellegen --output /path/to/new-evidence-directory
```

The output directory must not exist. Each run gets a directory holding the
request, the generated `network.pio.json` (bus locations and branch routes
embedded), `report.json`, `network.geo.json`, a MATPOWER export and the GridFM
graphkit document. `result.json` lists, for every spec and seed, the request
hash, the DC OPF and AC power flow verdicts, the calibration status, the
corridor plan (rounds, circuits added, island angle spread, shunt banks), the
warnings, and each structural statistic beside the reference range (min to
max over the measured reference cases) and the published range where one
exists. A run is `valid` when its DC OPF is optimal and its AC power flow
converges inside the 0.9–1.1 pu emergency band. The comparison never adjusts
a generated grid.

## Reference cases

`reference_stats.json` comes from `tellegen stats --case` over the PGLib-OPF
fixtures already in the repository:
`crates/tellegen-server/fixtures/pglib/pglib_opf_case200_activ.m` (ACTIVSg200,
Birchfield et al. 2017) and `pglib_opf_case500_goc.m` (the ARPA-E GO
competition 500-bus case). The table records their source hashes. MATPOWER
carries no coordinates, so the length based statistics are zero for these
cases and are not compared. Larger cases (ACTIVSg2000, Texas7k, CATS) can be
measured once staged with `scripts/stage-data.sh`: pass each with `--case`.
Third-party datasets are not vendored here, the same policy as
`evidence/studies`.

The published ranges are the generator's default calibration targets
(Birchfield et al., IEEE TPWRS 32(4), 2017, Table II): mean degree 2.2–3.0
and a highest-voltage share of 0.08–0.35.

## Specs

| Spec | Region | Why |
| --- | --- | --- |
| `portugal` | Portugal's bounding box, high density | the region the MapToGrid app opens on |
| `gulf-of-guinea` | Ghana and Togo coast, medium density, low fidelity | loads spread with a floor; wider parameter spreads |
| `rhine-low` | the Rhine corridor, low density | about 1.3 GW per bus, the heaviest aggregation |
| `fiji-seam` | Fiji across the antimeridian | one continuous frame across ±180° |

## What the last run showed

On 2026-10-23, 11 of 12 runs (4 specs × 3 seeds, bundled places table) were
valid, at national voltage ladders except for the Rhine spec, which states
500/230 kV. Every DC OPF was optimal and every corridor plan converged. The
twelfth run, Portugal seed 3 at Portugal's 400/220/150 kV, has an AC power
flow that does not converge. Newton stalls at a 2 MW mismatch in an inland
220 kV pocket (Guarda and Covilhã, voltages down to 0.76 pu), from both a
flat and a DC start: a load pocket at the limit of what its corridors carry.

The structural comparison is mixed, and the table says so plainly:

- Mean degree (2.36–2.90) sits inside the published range but outside the
  narrow band of the two references (2.45–2.60).
- The clustering coefficient (0.09–0.30, and 0.46–0.57 on the 14-bus Fiji
  spec) is well above the references (0.06–0.08): a Gabriel mesh is rich in
  triangles.
- The highest degree (4–7) is below the references (10–11), because the mesh
  caps nodal degree at 8.
- The highest-voltage share falls below the published 0.08 on one Rhine run
  (0.008), where the corridor plan adds 765 kV above the stated 500 kV for a
  few corridors, and the share counts only the buses at that added level.
- The branch-to-bus ratio follows the request (1.32 at medium density, 1.45
  at high) except where the corridor plan needed more circuits, which each
  run's warnings name.

These differences are structural; calibration cannot move them. They are
tracked as generator work.

## Country-scale sweep

Two sweeps of the default request on 17 whole countries and a box around
Texas, each at seeds 1, 7 and 2026 (the MapToGrid app's default seed),
measured against each country's official peak:

- `country-sweep-50m.md` / `.json`: Natural Earth 1:50m admin-0 outlines.
- `country-sweep-110m.md` / `.json`: the MapToGrid app's own 1:110m
  selection layer (`static/data/countries-110m.geojson`, SHA-256
  `04be4d555283ceb888758d01e2a359e17db86918794357e72b16bb50fc4686bd`), with
  the request the app sends for an untouched Generation panel
  (`src/lib/engine/request.ts`: synthetic, density and fidelity high,
  population demand, no voltage levels). France is not in that layer
  (Natural Earth codes it `-99`), so the app cannot select it and this
  sweep has 17 regions.

```sh
# Natural Earth v5.1.2, 1:50m admin-0 countries (public domain); regions.py
# checks the file's SHA-256 (SOURCE_SHA256) before writing the specs.
curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
python3 -I evidence/synth/regions.py ne_50m_admin_0_countries.geojson --out /path/to/specs50
python3 -I evidence/synth/regions.py /path/to/maptogrid/static/data/countries-110m.geojson \
  --outline app-110m --out /path/to/specs110
TELLEGEN_ALLOW_FALLBACK=1 cargo build --release -p tellegen-cli --features conic
python3 evidence/synth/run.py sweep /path/to/specs50/*.json --seeds 1,7,2026 \
  --tellegen target/release/tellegen --output /path/to/new-sweep-directory
python3 evidence/synth/run.py sweep /path/to/specs110/*.json --seeds 1,7,2026 --missing fra \
  --outline "the MapToGrid app's 1:110m layer" \
  --tellegen target/release/tellegen --output /path/to/another-new-directory
# The same sessions through the wasm build, timed in Node (SEED defaults to 2026):
npm run wasm
node evidence/synth/wasm_time.mjs packages/engine/src/wasm-pkg \
  crates/tellegen-synth/data/populated_places.json /path/to/specs110/usa.json
```

The specs are not committed (they copy the outline polygons); `regions.py`
regenerates them byte for byte, and each sweep's JSON records every spec's
SHA-256 and every run.

**Peak references.** `peak_references.json` gives every region's official
peak with its year, scope and source URLs. It uses the latest complete year
throughout: 2025 where the operator has published it, 2024 for India, South
Africa, Indonesia and Australia. A peak is scored within ±25% only where the
reference's scope matches the modelled region:

- Nigeria's figure is supply-limited grid generation, not demand, so it is
  `not comparable`; so is the Texas box, which is not ERCOT's footprint.
- Australia has no national figure (NEM plus WEM, about 37.9 GW, is a
  non-coincident sum), and Indonesia's 61.3 GW is a sum of non-coincident
  system peaks. Both are `flagged`: shown, not scored.
- Great Britain is compared with National Demand plus embedded wind and
  solar (48.1 GW on 9 January 2025); the modelled region also holds
  Northern Ireland.
- Portugal and Spain are mainland and peninsular figures, Russia's is the
  UES without its isolated systems, and Japan's is the 10-area coincident
  peak.

**Levels.** Each region is modelled at its dominant country's national
ladder (`crates/tellegen-synth/data/voltage_ladders.json`, with sources),
shown in the Levels column. A `+` marks a higher level in service that the
plan raised buses to at some seed: 765 kV in the United States, India,
Brazil and South Africa, 750 kV in Russia, 1000 kV in China, 500 kV in
Australia. Germany, France, Great Britain, Spain, Portugal, Japan, Nigeria,
Egypt, Chile and Indonesia have no higher AC level, and the plan adds none.

**Result.** These are rates over all seeds, not one seed:

| Outline | Runs | DC OPF optimal | AC converged in band | Regions valid at every seed | Peaks within ±25% |
| --- | ---: | ---: | ---: | ---: | ---: |
| Natural Earth 1:50m | 54 | 54 | 45 | 12 of 18 | 14 of 14 |
| App 1:110m, app request | 51 | 51 | 41 | 12 of 17 | 13 of 13 |

Demand, the bus count and the levels do not depend on the seed. The two
outlines differ by a percent or two in peak demand, except where the
outline changes which islands are generated.

**Failures by region, as the engine reported them** (AC passes out of 3):

| Region | 1:50m | App 1:110m | What fails |
| --- | ---: | ---: | --- |
| Russia | 0 | 0 | See below |
| United States | 1 | 0 | Not converged; from its own DC angles Newton stalls at about 2 MW in a remote 230 kV pocket (Nevada at seed 1) |
| China | 2 | 3 | 1:50m seed 7 not converged |
| Brazil | 3 | 1 | 1:110m seed 1 not converged; seed 7 converged at 0.949–1.108 pu |
| Australia | 2 | 2 | 1:50m seed 2026 converged at up to 1.541 pu; 1:110m seed 1 not converged |
| Chile | 2 | 3 | 1:50m seed 2026 converged at up to 1.232 pu |
| Indonesia | 2 | 3 | 1:50m seed 2026 converged at up to 1.266 pu |
| Egypt | 3 | 2 | 1:110m seed 2026 not converged |

Every DC OPF is optimal on both outlines. `planning_incomplete` is raised
wherever a country's ladder stops before the angle spread can be met:
Spain, Germany, Great Britain, France, Japan (two corridors short of
capacity at four 500 kV circuits), Chile and Indonesia, and the
continental regions.

**Russia.** Its AC power flow fails at every seed on both outlines, and
for two structural reasons:

- *Remote pockets at the end of long 220 kV chains.* Russia is one AC island
  of 17 million km² in the model, where the real UES leaves Magadan,
  Chukotka, Kamchatka and Norilsk as isolated systems. At three of the six
  runs (1:50m seeds 1 and 2026, 1:110m seed 1) Newton stalls at 1–2 MW in a
  220 kV pocket on the Yenisei north of Krasnoyarsk or at Magadan, 95°
  from the reference, from a flat and a DC start alike: no AC solution lies
  near the plan. The planning spread is 67–129° against the 44° target.
- *A 750 kV network far larger than Russia's.* Capacity promotion raises
  both ends of a heavy corridor, and every corridor touching a raised bus
  then runs at 750 kV. At seed 1, 317 of 1,181 buses sit at 750 kV, with
  73,500 circuit-km of 750 kV line. That is far more than any real 750 kV
  network: Ukraine's, among the largest, is about 4,400 route-km
  (Ukrenergo, 2020), and Russia's serves its north-west and west (SO UES).
  Their 269 GVAr of charging is
  met by 280–460 GVAr of fixed reactors for a 176 GW load, so voltages
  swing with the dispatch. Where a solution exists, a DC start finds it,
  but at 0.874–1.154 pu (1:50m seed 7) and 0.954–1.145 pu (1:110m seed
  2026), outside the band; only 1:110m seed 7 (0.921–1.062 pu) would pass.
  The engine's flat start at 1:110m seed 2026 converges to a false
  0.26–1.96 pu root.

  A warm start from the DC angles therefore lifts Russia from 0 to 1 of 6
  valid runs, and from 1 to 3 converged. It does not repair the plan.

Three model changes were tried against this and not kept, because none
improved the AC passes over both outlines:

- Adequacy areas bounded by extent as well as load (about 120,000 km² each,
  the Lower 48's balancing authorities): 84 of 105 against 85.
- Lines between buses at different voltages run at the lower voltage, with
  the transformer at the higher end: fewer 750 kV lines, but 77 of 105.
- No stiffening onto the higher level: no change, since promotion, not
  stiffening, builds the 750 kV network.

Splitting continental islands into synchronous areas joined by HVDC, with
switched reactive compensation, is the remaining structural step.

**Indonesia on the app's outline.** At 1:110m the archipelago fell apart
into several island groups, and the context kept the largest by area,
Borneo's: the grid had 33 of 99 places and 8.5 GW of 54 GW, without Java.
The context now keeps the group whose places hold the most people
(bdaaa90): Indonesia keeps Java and Sumatra (44.8 GW), and its AC power flow
converges at all three seeds. This was the only difference between the
outlines with a cause in the model. The other differences (places snapped,
peaks) are a few percent, and the AC outcomes that differ between outlines
come from bus sites drawn on different polygons, the same kind of variation
as between seeds.

**Time**, end to end with both validations (Apple M5 Pro):

| Region | Buses | Native CLI, median of 3 seeds (1:50m / 1:110m) | wasm in Node 26, app outline, seed 2026 |
| --- | ---: | ---: | ---: |
| United States | 3000 | 1.75 / 1.64 s | 2.10 s |
| China | 3000 | 1.30 / 1.03 s | 1.47 s |
| India | 2013 | 0.60 / 0.49 s | 0.56 s |
| Russia | 1181 | 0.56 / 0.46 s | 0.36 s |
| Germany | 517 | 0.05 / 0.05 s | 0.06 s |

The United States is over the 2 s aim in wasm because its AC power flow
does not converge over five starts (about 1.0 s of the run).

### Limits of these results

- **Seed robustness.** One seed overstates robustness. Russia converged at
  one seed and outline before national ladders, and nowhere since; of the
  regions that fail at all, Australia, Brazil, Chile, China, Egypt and
  Indonesia each fail at one or two of six runs, so a single-seed table
  reports them as valid or as failed by chance. The rates above, over three
  seeds and two outlines, are the measure to quote, and three seeds are
  still few.
- **Voltage band.** Several converged runs leave the 0.9–1.1 pu band
  (Australia at up to 1.54 pu, Chile 1.23, Indonesia 1.27, Brazil 0.95–1.11),
  because the reactive plan sizes fixed shunts at the planning dispatch
  while validation runs at the DC OPF's.
- **One AC island per region.** Continental regions and archipelagos are
  solved as one synchronous system; the generator has no HVDC of its own.
