# @tellegen/svelte

Svelte components for tellegen maps, case panels, local case files, and browser solves.

```sh
npm install @tellegen/svelte
```

Import the component and stylesheet in your app:

```svelte
<script lang="ts">
  import { TellegenViewer } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";
</script>

<TellegenViewer />
```

Use local files only by disabling bundled case loading:

```svelte
<script lang="ts">
  import { TellegenViewer } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";
</script>

<TellegenViewer loadDefaultCases={false} showFooter={false} />
```

The viewer accepts at most 32 files in one ingestion batch. Each file must be
at most 128 MiB, and the aggregate batch must also be at most 128 MiB. Files
remain in the browser on this path.

`TellegenViewer` accepts:

- `apiBase`, default `/api`
- `loadDefaultCases`, default `true`
- `docsHref`
- `orgHref`
- `orgLabel`
- `showFooter`, default `true`
- `theme`, `light` (default) or `dark`

Use `TellegenProvider` and `TellegenShell` when state should survive route changes:

```svelte
<script lang="ts">
  import { TellegenProvider, TellegenShell } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";
</script>

<TellegenProvider>
  <TellegenShell />
</TellegenProvider>
```

## Panel layout

The shell docks Network and Studies on the left, and Solver and Agent on the
right. The most recently opened panel gets more room in its dock; click another
heading to expand it. Drag a panel heading to detach it; use the corner handle to resize it.
Panel options dock it on either side, and **Reset layout** restores the default
positions. Focus a heading or resize handle and use arrow keys for keyboard
control; hold Shift for larger steps. Narrow windows show one active drawer.
Panel positions are stored in the browser, independently of case and Study data.

Custom panels can join the same layout inside `TellegenProvider`:

```svelte
<TellegenProvider>
  <TellegenShell />
  <PanelFrame id="notes" title="Notes" side="right" order={30}>
    <p>Case notes</p>
  </PanelFrame>
</TellegenProvider>
```

Import `PanelFrame` from `@tellegen/svelte`. Its optional `open` prop is bindable;
`width` sets its preferred width, and the `headerActions` snippet adds compact
controls beside its title.

### Custom shells

`TellegenShell` is one arrangement of exported parts. A host can mount its own
inside `TellegenProvider`:

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { TellegenProvider } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";
  import MyShell from "./MyShell.svelte";
</script>

<TellegenProvider loadDefaultCases={false} apiBase={null} theme="dark">
  <MyShell />
</TellegenProvider>
```

```svelte
<!-- MyShell.svelte: reads the controller from context, so it must be a child -->
<script lang="ts">
  import { PanelFrame, getController } from "@tellegen/svelte";
  import { TellegenMap } from "@tellegen/svelte/map";
  import { NotificationCenter, PanelHost, ShellEnvironment } from "@tellegen/svelte/components";

  const ctrl = getController();
</script>

<ShellEnvironment />
<TellegenMap
  theme="dark"
  projection="globe"
  onbusclick={ctrl.selectBus}
  onlocalbusclick={ctrl.selectLocalBus}
  onmultibusclick={ctrl.selectMultiBus}
  onplacecase={ctrl.placeCase}
  onmapclick={ctrl.clearSelection}
/>
<PanelHost showToolbar={false} />
<NotificationCenter />
<PanelFrame id="region" title="Region" side="left">...</PanelFrame>
```

`ShellEnvironment` is renderless and keeps the compact-layout, pointer and
viewport state in step, as the default shell does. `PanelHost` reads
`--tellegen-dock-left`, `--tellegen-dock-right` and `--tellegen-dock-bottom`
from an ancestor for its dock insets (defaults 20px, 20px and 100px), so a
shell with its own rail or status bar moves the docks without restyling them.

## Basemap

The map loads an [OpenFreeMap](https://openfreemap.org/) style by default
(`positron` for the light theme, `dark` for the dark theme) and switches to the
matching CARTO vector style when that style cannot be fetched, when its tiles
answer 401, 403 or 429, or when tile fetches keep failing with nothing arriving.
Label layers are hidden by default, so the light default looks like the
previous CARTO no-labels basemap. The attribution control is always on and
shows the credits of the style on screen.

`TellegenMap` (also exported from `@tellegen/svelte/map`) accepts, besides its
click callbacks:

- `mapStyle`: a style URL or inline `StyleSpecification`; default, the
  OpenFreeMap style for `theme`
- `fallbackMapStyle`: the style used when the primary fails; `null` disables
  the switch; default, the CARTO style for `theme`
- `theme`: `'light'` (default) or `'dark'`; picks the default styles and the
  overlay palette (`MAP_PALETTE`)
- `projection`: `'mercator'` (default) or `'globe'`; re-applied after every
  style load, so a basemap switch keeps it
- `initialCamera`: `{ center, zoom, bearing, pitch }`, read once per mount
- `hideBasemapLabels`: default `true`
- `extraLayers`: deck.gl layers drawn after tellegen's own, in the same overlay
- `attribution`: `'compact'` (default) or `'full'`; there is no off switch
- `onMapReady(map, overlay)`: the MapLibre map and deck overlay once they
  exist; may return a cleanup, and fires again after a context-loss or basemap
  rebuild
- `onBasemapFallback(reason)` and `onBasemapError(reason)`: the switch
  happened, or no basemap can be shown (the network layers still draw)

Changing `mapStyle`, `fallbackMapStyle`, `theme`, `hideBasemapLabels` or
`attribution` rebuilds the map in place and keeps the camera. The helpers
behind the defaults are exported too: `OPENFREEMAP_STYLES`, `CARTO_STYLES`,
`cartoStyleUrl(url, apiKey)`, `defaultBasemap(theme)`, `resolveBasemap(props)`
and `attachBasemapFallback(map, spec, handlers)`.

A Content Security Policy must allow `https://tiles.openfreemap.org` and
`https://*.cartocdn.com` in `connect-src` and `img-src`: the style, vector
tiles, fonts and sprites are all fetched.

## Dark theme

`<TellegenProvider theme="dark">` (or `<TellegenViewer theme="dark">`) sets
`data-theme="dark"` on the document root while mounted, which switches every
token in `styles.css`. Pass `theme="dark"` to `TellegenMap` as well so the
basemap and the overlay palette follow. A server-rendered host can put the
attribute in its template to avoid a light first paint. Text tokens keep at
least 7:1 against the panel on either ground.

## Opening a module from memory

A host that produces a balanced powerio module itself opens it without a file:

```ts
import { getController } from "@tellegen/svelte";

const ctrl = getController();
const local = await ctrl.openBalancedModule({ name: "synthetic grid", moduleJson });
// or, with the payload the engine's ingestCase already returned for it:
await ctrl.openBalancedModule({ name, payload, frame: false });
// swap it for a new result in place
await ctrl.replaceLocalCase(local, { name, payload });
```

Options: `geoLayer` (a `.geo.json` document, for a module without
coordinates; a module that carries `Bus.location` needs none),
`formulation`, `activate` (default `true`; `false` returns the prepared case
without adding it) and `frame` (default `true`). `replaceLocalCase` keeps the
case's slot in the header, its formulation and display mode, and the selected
bus when the new case has it. With `loadDefaultCases={false}` the controller
fetches nothing on `load()`; with `apiBase={null}` it has no API client at all
and every server path reports compute off.

## Engine Reexports

The package reexports the browser engine helpers, including `ingestCase`,
`classifyJson`, and `ingestJsonDrop`, for custom file imports. These APIs use
byte input: pass `Uint8Array` to `ingestCase`, await
`classifyJson(bytes)` and read its `{ kind, format }` result, and use
`ingestJsonDrop(bytes)` to classify and parse in one call. `isStudyPackageText`
was removed; stored PowerIO documents report `kind === "module"`.
`JsonDropKind` also includes `transmission`, `distribution`, `ambiguous`, and
`unknown`; BMOPF and PMD are distribution `format` values rather than separate
kinds. Every solvable ingest payload carries the retained module in
`module_json`; the viewer uses that generation-2 IR for Study construction and
geographic edits without keeping a second serialized network.

Drawing layers use a plain canvas with their own x/y coordinates. Saved Studies
retain the drawing center and scale separately from the geographic map camera.

## Release

Build and inspect the package from the repository root:

```sh
npm ci
npm run wasm
npm run build:engine
npm run build:svelte
npm run pack:svelte
npm run test:svelte-packed
```

`@tellegen/svelte` is published with `@tellegen/engine` in the first framework
release. The package ships only `dist`, the README, the MIT license text, and
package metadata. The packed smoke test installs the generated tarballs into a
temporary Svelte consumer and builds it so missing exports, styles, or wasm
assets fail before publish.
