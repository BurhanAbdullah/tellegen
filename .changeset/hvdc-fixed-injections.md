---
"@tellegen/engine": patch
---

The DC OPF, DC power flow and AC power flow solve networks with in-service HVDC lines. Each line's stated transfer enters the bus balance as fixed injections at its two terminal buses, as PowerIO 0.11.7 prepares them, and the solve reports PowerIO's `BUILD.HVDC.FIXED_INJECTION` diagnostic. A line with a terminal bus outside the solve injects at neither end and reports `BUILD.HVDC.TERMINAL_INACTIVE`. Generated OpenStreetMap grids with HVDC links now open, solve and export. The AC OPF and the SOC relaxation still refuse in-service HVDC lines.
