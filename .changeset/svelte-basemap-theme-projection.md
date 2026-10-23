---
"@tellegen/svelte": minor
---

`TellegenMap` takes its basemap from props instead of a hardcoded CARTO URL.
The default is now the OpenFreeMap positron style with the CARTO
positron-nolabels style as a fallback, so the hosted look is unchanged while
CARTO's key enforcement on unkeyed tiles no longer blanks the map. New props:
`mapStyle`, `fallbackMapStyle`, `theme` (`'light' | 'dark'`), `projection`
(`'mercator' | 'globe'`, re-applied after every style load), `initialCamera`,
`hideBasemapLabels`, `extraLayers`, `attribution` (`'compact' | 'full'`, never
off), `onMapReady(map, overlay)`, `onBasemapFallback` and `onBasemapError`.
`basemap.ts` exports `OPENFREEMAP_STYLES`, `CARTO_STYLES`, `cartoStyleUrl`,
`defaultBasemap`, `resolveBasemap` and `attachBasemapFallback`; the overlay
palette is `MAP_PALETTE[theme]`.

The controller gains `openBalancedModule({ name, moduleJson | payload,
geoLayer?, formulation?, activate?, frame? })` and
`replaceLocalCase(previous, input)` to open a balanced powerio module from
memory, `ControllerOptions.loadDefaultCases` and `apiBase: null`, and an
internal gate so `load()` fetches nothing when default cases are off;
`createApiClient({ apiBase: null })` returns `null`. `TellegenProvider`
accepts `theme="dark"` (sets `data-theme` on the document root for the new
dark tokens in `styles.css`) and marks the shell loaded when default cases are
off. `@tellegen/svelte/components` exports `PanelHost` (with `showToolbar`
and `--tellegen-dock-left/right/bottom` insets), `NotificationCenter` and the
renderless `ShellEnvironment` for custom shells. Hosts with a Content Security
Policy must allow `https://tiles.openfreemap.org` in `connect-src` and
`img-src`.
