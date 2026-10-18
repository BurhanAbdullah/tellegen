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
maximum unbalance; a ranked issue list that selects the bus or branch; per-phase
voltage bars against declared limits and per-conductor currents at both ends; and
bus and branch CSV export. Unbalance is the voltage unbalance factor from
terminal phasors, shown beside the magnitude spread. `controller.multiFullResult`
reads the full operating point from a stored result or the live session. The
renderer-independent logic lives in `src/lib/diagram`, ported from the diagram
projection draft (#177).
