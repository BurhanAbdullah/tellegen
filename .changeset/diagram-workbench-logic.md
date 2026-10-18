---
"@tellegen/engine": minor
"@tellegen/svelte": minor
---

Multiconductor graphs carry declared voltage limits and ratings, and the Studies
view gains an operating-point overview.

In `@tellegen/engine`, `DistGraphBus.voltage_limits` holds the model's declared
phase–neutral and phase–phase voltage bounds in volts, and `DistGraphEdge.rating`
holds per-conductor ampacity or a transformer edge's smaller winding rating.
Both are present only when the model declares them.

In `@tellegen/svelte`, `McWorkbench` summarises a multiconductor power-flow result:
violations, losses, voltage ranges per declared reference, maximum loading and
maximum unbalance; a ranked issue list that selects the bus or branch; search
over buses and branches; per-phase voltage bars against declared limits and
per-conductor currents at both ends; a voltage profile along the display tree with
the same-depth envelope; sortable bus and branch tables; and CSV export. Cases
larger than 25,000 buses compute the overview on request. Setting
`MulticonductorCase.schematic` makes `TellegenMap` show the case as a deck.gl
schematic or at its source positions, with an animated switch between them,
result colouring, the shared selection and PNG/SVG export. `overviewResult` holds
the operating point the overview and schematic share. The schematic layout runs in
the engine: `mcSchematicLayout` in `@tellegen/engine` returns tidy or leaf-order
geometry and the display forest. The schematic can be downloaded as a PowerIO
diagram layer, follows a case's own routes in source positions, and a selected
branch gets a multi-wire view of its conductors. Unbalance is the voltage
unbalance factor from terminal phasors, shown beside the magnitude spread.
`controller.multiFullResult`
reads the full operating point from a stored result or the live session. The
renderer-independent logic lives in `src/lib/diagram`, ported from the diagram
projection draft (#177).
