# Framework Packages

The reusable browser packages live under `packages/`. The first framework
release publishes both `@tellegen/engine` and `@tellegen/svelte`.

Use `@tellegen/svelte` when a Svelte app wants the map, panels, local file flow,
and solve card as components. Use `@tellegen/engine` when an app wants case
parsing, browser WebAssembly solves, studies, previews, and sensitivities
without the tellegen UI.

`apps/web` is the hosted demo. It consumes `@tellegen/svelte` and keeps only
route level concerns such as SEO pages, `/credits`, and `/privacy`.

## Svelte UI Package

Install:

```sh
npm install @tellegen/svelte
```

Render the full viewer:

```svelte
<script lang="ts">
  import { TellegenViewer } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";
</script>

<TellegenViewer />
```

The default viewer loads bundled cases from `/api`, parses dropped local case
files in the browser, and runs supported local solves in WebAssembly.

`TellegenViewer` accepts:

- `apiBase`, default `/api`
- `loadDefaultCases`, default `true`
- `docsHref`
- `orgHref`
- `orgLabel`
- `showFooter`, default `true`
- `theme`, `light` (default) or `dark`

Use a different backend base path like this:

```svelte
<TellegenViewer apiBase="/tellegen/api" />
```

Use local files only by disabling bundled case loading:

```svelte
<script lang="ts">
  import { TellegenViewer } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";
</script>

<TellegenViewer loadDefaultCases={false} showFooter={false} />
```

For apps where state should survive route changes, mount the provider in a
persistent layout and render the shell on the page:

```svelte
<script lang="ts">
  import { TellegenProvider } from "@tellegen/svelte";
  import "@tellegen/svelte/styles.css";

  let { children } = $props();
</script>

<TellegenProvider>
  {@render children()}
</TellegenProvider>
```

```svelte
<script lang="ts">
  import { TellegenShell } from "@tellegen/svelte";
</script>

<TellegenShell />
```

`@tellegen/svelte` also exports lower level pieces for custom shells:

- `TellegenMap`, with basemap, theme, projection, camera, extra-layer and
  `onMapReady` props (see below)
- `AppState`, `CaseState`, `LocalCase`, and `createAppState`
- `Controller` and `createController`, including `openBalancedModule`
- `createApiClient`
- `PanelHost`, `NotificationCenter`, `ShellEnvironment`, panels and controls
  from `@tellegen/svelte/components`
- basemap helpers, colors, display helpers, formatting helpers, and public types

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

When a panel closes, focus moves to its toolbar button. Without the toolbar,
focus goes back to the control that had focus when the panel opened. If there
is none, it goes to the panel's dock, a region named "Left panels" or "Right
panels". On narrow screens that region is the drawer, named "Panels".

A shell that shows `app.error` itself can also read `app.errorDetail`. When
it is set, `app.error` is a message written for people, and the detail holds
the technical text behind it. `NotificationCenter` shows that text in a
collapsed disclosure.

### Basemap

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

### Dark theme

`<TellegenProvider theme="dark">` (or `<TellegenViewer theme="dark">`) sets
`data-theme="dark"` on the document root while mounted, which switches every
token in `styles.css`. Pass `theme="dark"` to `TellegenMap` as well so the
basemap and the overlay palette follow. A server-rendered host can put the
attribute in its template to avoid a light first paint. Text tokens keep at
least 7:1 against the panel on either ground.

### Opening a module from memory

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

## Engine Package

Install:

```sh
npm install @tellegen/engine
```

Use the engine package when you want to build your own UI:

```ts
import { createStudy, formatOf, ingestCase, solveModule } from "@tellegen/engine";
```

`ingestCase` and solvable JSON ingestion return a retained PowerIO module in
`module_json`. Both `createStudy` and `solveModule` accept that generation-2
PowerIO IR module. Geographic transforms update and return the same module.

The engine package resolves its wasm files relative to the package module. Apps
must serve package asset files from `node_modules`; Vite and SvelteKit handle
that path.

## Examples

- `examples/svelte-minimal` imports `@tellegen/svelte` and runs with
  `loadDefaultCases={false}` for local files only.
- `examples/browser-minimal` imports `@tellegen/engine` directly and has no map
  stack.

Downstream apps should not import from `apps/web/src/lib` or from generated wasm
folders.
