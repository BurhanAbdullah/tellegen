---
"@tellegen/svelte": patch
---

The basemap also switches to its fallback when the tile server answers HTTP
5xx for every tile, not only when tile requests fail at the network level.
