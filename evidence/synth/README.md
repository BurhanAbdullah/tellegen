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

- Mean degree (2.35–2.90) sits inside the published range but outside the
  narrow band of the two references (2.45–2.60).
- The clustering coefficient (0.15–0.30) is well above the references
  (0.06–0.08): a Gabriel mesh is rich in triangles.
- The highest degree (5–8) is below the references (10–11), because the mesh
  caps nodal degree at 8.
- The highest-voltage share exceeds the published 0.35 on the heavily
  aggregated Rhine spec (0.46–0.54). There the corridor plan raises buses to
  500 kV because their corridors would otherwise need more than two circuits.
- The branch-to-bus ratio follows the request (1.45 at high density) except
  where the corridor plan needed more circuits, which each run's warnings name.

These differences are structural; calibration cannot move them. They are
tracked as generator work.
