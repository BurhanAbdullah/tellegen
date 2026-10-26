---
"@tellegen/svelte": patch
---

`TellegenProvider` disposes its controller when it unmounts. The new
`Controller.dispose()` frees every case's browser Study, including one still
being built, and every multiconductor session, cancels their pending edits and
in-flight requests, and builds nothing afterwards, so a provider's Studies and
sessions no longer stay in the engine worker.

`theme` and `cartoApiKey` on `TellegenProvider` and `TellegenViewer` follow
their props: switching either updates the root `data-theme` attribute and
rebuilds the default shell's map in place. The other props are still read once,
at mount.

`TellegenMap` assigns its teardown before it calls `onMapReady`, so a host
callback that throws no longer keeps the MapLibre map and its window and
document listeners alive.
