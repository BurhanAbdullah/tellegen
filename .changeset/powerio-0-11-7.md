---
"@tellegen/engine": patch
---

Build against PowerIO 0.11.7. AC power flow on a case with HVDC lines now
includes their scheduled transfers as fixed bus injections; DC OPF and DC power
flow still leave them out. OpenDSS feeders read the circuit's source
impedance, so the distribution graph gains an internal source bus and its
impedance line, and a `switch=y` line reads as a closed 1 mOhm line. PSS/E
VSC DC lines are read instead of skipped.
