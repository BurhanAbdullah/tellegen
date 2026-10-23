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

On 2026-10-23, 12 of 12 runs (4 specs × 3 seeds, bundled places table) were
valid: every DC OPF optimal, every AC power flow converged inside the band,
every corridor plan converged.

The structural comparison is mixed, and the table says so plainly:

- Mean degree (2.36–2.90) sits inside the published range but outside the
  narrow band of the two references (2.45–2.60).
- The clustering coefficient (0.11–0.30, and 0.46–0.57 on the 14-bus Fiji
  spec) is well above the references (0.06–0.08): a Gabriel mesh is rich in
  triangles.
- The highest degree (4–7) is below the references (10–11), because the mesh
  caps nodal degree at 8.
- The highest-voltage share falls below the published 0.08 on the heavily
  aggregated Rhine spec (0.015–0.027). There the corridor plan adds 765 kV
  above the requested 500 kV for a few corridors, and the share counts only
  the buses at that added level.
- The branch-to-bus ratio follows the request (1.32 at medium density, 1.45
  at high) except where the corridor plan needed more circuits, which each
  run's warnings name.

These differences are structural; calibration cannot move them. They are
tracked as generator work.

## Country-scale sweep

`country-sweep.md` and `country-sweep.json` hold one run of the default
request (density high, no bus count, seed 1) on 17 whole countries and a
box around Texas, measured against each country's official peak.

```sh
# Natural Earth v5.1.2, 1:50m admin-0 countries (public domain); regions.py
# checks the file's SHA-256 (SOURCE_SHA256) before writing the specs.
curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
python3 -I evidence/synth/regions.py ne_50m_admin_0_countries.geojson --out /path/to/specs
TELLEGEN_ALLOW_FALLBACK=1 cargo build --release -p tellegen-cli --features conic
python3 evidence/synth/run.py sweep /path/to/specs/*.json \
  --tellegen target/release/tellegen --output /path/to/new-sweep-directory
# The same sessions through the wasm build, timed in Node:
npm run wasm
node evidence/synth/wasm_time.mjs packages/engine/src/wasm-pkg \
  crates/tellegen-synth/data/populated_places.json /path/to/specs/usa.json
```

The specs are not committed (they copy Natural Earth polygons); `regions.py`
regenerates them byte for byte, and `country-sweep.json` records each spec's
SHA-256.

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
shown in the table's Levels column. A `+` marks a higher level in service
that the plan raised buses to: 765 kV in the United States, India, Brazil
and South Africa, 750 kV in Russia, 1000 kV in China, and 500 kV in
Australia. Germany, France, Great Britain, Spain, Portugal, Japan,
Nigeria, Egypt, Chile and Indonesia have no higher AC level, and the plan
adds none.

**Result.** 16 of 18 regions are valid, all 18 DC OPFs are optimal, and 16
AC power flows converge. All 14 scored peaks lie within ±25% of their
reference, from 0.77 (France) to 1.21 (India). Branches per bus run from
1.48 to 1.66, and no corridor holds more than four circuits.

**Failures, as the engine reported them:**

- **United States.** The AC power flow does not converge (5 starts). From
  its own DC angles a Newton solve stalls at a 2 MW mismatch in a 230 kV
  pocket in Nevada: a remote area at the AC transfer limit of its corridor.
  The Lower 48 is one AC island in the model, where in reality it is three
  interconnections joined by DC ties; the planning spread stays at 205°.
- **Russia.** The AC power flow does not converge. From its DC angles Newton
  stalls at 1.4 MW in a 220 kV pocket in central Siberia; the planning
  spread is 72°.

Splitting continental islands into synchronous areas joined by HVDC is not
modelled. `planning_incomplete` is raised for 13 of the 18 regions. Where
the country has no higher level, corridors stay at its ceiling and the
angle spread is reported instead of met: Spain 81°, Germany 64°, Great
Britain 55°, France 49°, Japan 94° (two corridors short of capacity at four
500 kV circuits), Chile 92° and Indonesia 171°.

**Compared with the run before national ladders** (500/230 kV everywhere,
with 765 kV above): China and Indonesia became valid and Russia stopped
converging, so valid regions went from 15 to 16. Branches per bus in Spain,
Germany, France and Great Britain rose from 1.51–1.59 to 1.60–1.66, since
380/400 kV circuits carry less than 500 kV ones and no higher level is left
to promote to.

**Time.** The automatic bus count reaches the 3000-bus limit for the United
States and China. End to end, with both validations, a run takes:

| Region | Buses | Native CLI (Apple M5 Pro) | wasm in Node 26 (same machine) |
| --- | ---: | ---: | ---: |
| United States | 3000 | 1.6–1.9 s | 2.2 s |
| China | 3000 | 1.0–1.1 s | 1.3 s |
| India | 2013 | 0.58–0.61 s | 0.67 s |
| Russia | 1181 | 0.56–0.57 s | 0.72 s |
| Germany | 517 | 0.05 s | 0.07 s |

The United States and Russia spend about 1 s and 0.3 s in wasm on AC power
flows that do not converge over five starts; the United States is over the
2 s aim for that reason.
The corridor plan takes half to two thirds of each large run. Lower bus caps
(1500–2500) made the United States and China fail AC, and were no faster.
