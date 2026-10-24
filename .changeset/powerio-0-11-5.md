---
"@tellegen/engine": patch
---

Build against PowerIO 0.11.5. Out-of-service loads and shunts no longer enter
the DC and AC OPF preparations, a saved multiconductor Study whose PowerIO
solution carries more than 65,536 terminal values reads back instead of
failing with `READ.MODULE.INVALID`, and PSS/E cases read closer to how PSS/E
defines them: a two-winding transformer whose winding 2 ratio is not one
scales its impedance by the square of that ratio, switched shunts read
`MODSW` 1 as discrete and 2 as continuous voltage control, and double-quoted
names and circuit ids are accepted. Solves of affected cases change
accordingly.
