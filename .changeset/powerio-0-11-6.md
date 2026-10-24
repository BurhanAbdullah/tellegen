---
"@tellegen/engine": patch
---

Build against PowerIO 0.11.6 with its default `sincal` feature off, so the
wasm engine still links without a C compiler and lists no SINCAL format.
MATPOWER cases that convert demand or impedance units after their literal
data, such as case33bw's kW and ohm blocks, now read with the converted
values. A multiconductor case with an island that has no voltage source is
refused instead of being anchored implicitly, and partial three-winding
service states keep their own IR record. PSS/E loads read `YQ` with the PSS/E
sign and net out distributed generation, revision 34 node columns sit where
PSS/E 34 writes them, the two-winding magnetizing admittance reaches bus I,
and three-winding transformers keep each winding's status and all twelve
ratings, so solved results change for such cases. Re-import Studies saved
from the earlier reading from the original file.
