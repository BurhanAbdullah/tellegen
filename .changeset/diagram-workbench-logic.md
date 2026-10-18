---
"@tellegen/svelte": patch
---

Add internal diagram workbench logic under `src/lib/diagram`, ported from the
diagram projection draft (#177): result snapshots from multiconductor power-flow
results with phasor voltage unbalance (VUF), ranked issues and summaries, search,
results tables with CSV export, colour modes on the application ramps, value
labels, SVG export, feeder envelopes, layout morphing and phase bars. Nothing is
exported from the package entry points yet.
