---
"@tellegen/engine": patch
---

Multiconductor graphs carry every bus voltage bound PowerIO reads, in volts.
`DistVoltageLimits` gains the phase-to-ground bounds (BMOPF `v_min`/`v_max`, PMD
`vm_lb`/`vm_ub`) as `v_min_by_terminal` and `v_max_by_terminal`, keyed by the phase
terminal PowerIO assigns each bound to, and the sequence and neutral-to-ground
bounds `vpos_min`, `vpos_max`, `vneg_max`, `vzero_max` and `vn_max`. A bound vector
that does not match the bus's phase terminals, or a non-finite entry, is left out.
