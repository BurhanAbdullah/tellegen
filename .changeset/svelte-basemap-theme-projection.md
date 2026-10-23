---
"@tellegen/svelte": minor
---

`TellegenMap` takes its basemap from props instead of a hardcoded CARTO URL,
and the default order depends on a CARTO basemap key. CARTO's terms ask for
one; keys are free for non-commercial use from carto.com/basemaps/apikey.

- With `cartoApiKey`, the keyed CARTO style leads (positron-nolabels or
  dark-matter-nolabels), and OpenFreeMap is the fallback.
- Without a key, OpenFreeMap leads, and the keyless CARTO style is the
  fallback.

Whenever an OpenFreeMap style renders, road lines start at zoom 8. In the dark
theme, water and land are recoloured towards CARTO Dark Matter
(`openFreeMapEdits`, matched by `source-layer`).

New props:

- `mapStyle` and `fallbackMapStyle`;
- `cartoApiKey`;
- `theme` (`'light' | 'dark'`);
- `projection` (`'mercator' | 'globe'`, re-applied after every style load);
- `initialCamera`;
- `hideBasemapLabels`;
- `extraLayers`;
- `attribution` (`'compact' | 'full'`, never off);
- `onMapReady(map, overlay)`, `onBasemapFallback` and `onBasemapError`.

`basemap.ts` exports `OPENFREEMAP_STYLES`, `CARTO_STYLES`, `cartoStyleUrl`,
`defaultBasemap`, `resolveBasemap`, `attachBasemapFallback`,
`isOpenFreeMapStyle` and `openFreeMapEdits`. `defaultBasemap` and
`resolveBasemap` name the provider of each style in `primaryProvider` and
`fallbackProvider` (`'carto'`, `'openfreemap'`, or `'custom'` for a style the
host passed), and the reasons given to `onBasemapFallback` and
`onBasemapError` carry `from` and `to` in the same terms. The overlay palette
is `MAP_PALETTE[theme]`. `TellegenProvider` and `TellegenViewer` take
`cartoApiKey`, and the default shell passes it and `theme` to its map.

The map now runs in a host's Vite dev server with no `optimizeDeps` settings.
MapLibre's worker URL comes from a new internal `./maplibre-worker` export,
whose `development` condition keeps the worker's `?worker&url` import out of
the dev server's pre-bundle, which stopped the dev server at startup.

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
Policy must allow `https://tiles.openfreemap.org` and `https://*.cartocdn.com`
in `connect-src` and `img-src`.
