---
"@tellegen/svelte": patch
---

Components show data, labels and controls, and leave notes to the host. The
"parsed in your browser" and "never uploaded" lines are gone from
`LocalCaseDetails`, `DropZone` and `AppHeader`, and coordinate provenance is a
labelled value (Coordinates: Generated, Synthetic layout, Manual layout, From
file or From the geographic file's name) beside a File row. The solver card lists
the calculation, iterations and time as labelled values, and the compute-off
notices no longer carry a contact address.

A host adds its own note through two optional snippets: `ControlPanel`'s
`caseNote`, rendered under a local case's stats with the case as its argument,
and `DropZone`'s children, rendered under the drop prompt.

Visible text is in sentence case, and the monospace face is kept for numbers
and identifiers. The case actions read Save case, Save solution, Export as and
Save geography (Save drawing in diagram view). Hosts that match on the old
strings need updating: the solver card no longer shows "OPF solve", the bus
lookup's accessible name is "Bus lookup", and the full demand range button is
named "Full demand range".
