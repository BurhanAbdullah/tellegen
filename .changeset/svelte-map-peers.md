---
"@tellegen/svelte": patch
---

`maplibre-gl`, `@deck.gl/core`, `@deck.gl/layers` and `@deck.gl/maplibre` are
peer dependencies instead of dependencies, with the same ranges. The map shares
their instances with the host through `extraLayers` and `onMapReady`, so the
host installs them and one copy of each resolves. npm 7 and later and pnpm 8
and later install missing peers on their own; with Yarn or
`--legacy-peer-deps`, add them to the app's dependencies.
