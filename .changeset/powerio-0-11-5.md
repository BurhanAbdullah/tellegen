---
"@tellegen/engine": patch
---

Build against PowerIO 0.11.5. Out-of-service loads and shunts no longer enter
the DC and AC OPF preparations, a saved multiconductor Study whose PowerIO
solution carries more than 65,536 terminal values reads back instead of
failing with `READ.MODULE.INVALID`, and PSS/E cases read as PSS/E defines
them: the constant-admittance reactive sign, distributed generation, winding 2
tap impedance scaling, bus I magnetizing admittance, per-winding three-winding
statuses and ratings, revision 34 node columns, and double-quoted strings.
Normalization now merges the buses that closed switches join. Solves of
affected cases change accordingly.
