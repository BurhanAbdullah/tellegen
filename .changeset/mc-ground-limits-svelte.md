---
"@tellegen/svelte": patch
---

The multiconductor overview ranks phase–ground voltages against declared
phase-to-ground bounds, alongside the phase–neutral and phase–phase bands. Each
declared reference gets its own pairs (`a–ground` and so on) in the issues, the
voltage ranges, the phase bars, value labels, tables and CSV export; `BusLimits`
holds one entry per reference. A case that declares no voltage limits or ratings
says so plainly, and one whose limits the overview does not rank says that instead.
