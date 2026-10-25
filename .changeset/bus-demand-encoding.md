---
"@tellegen/svelte": patch
---

Show bus demand as colour. A `demand` display mode shades buses by their
demand in MW, committed changes included, on a square-root scale with a cool
viridis ramp that cannot be mistaken for the nodal value ramp.
`AppState.busSizing` chooses how markers are sized: `power` (the default)
scales them by the larger of demand and generation as before, and `uniform`
draws every bus alike. Uniform markers on the map keep one ground radius
between 2 and 4.5 pixels, so a whole country reads as a mesh with its lines
showing and a closer view as distinct buses. Changing the calculation keeps a
demand colouring, and the bus tooltip does not repeat demand under it.
`@tellegen/svelte/map` exports `busMarkerRadius`, `busRadiusFor`,
`demandColor`, `demandDomain`, `demandGradient`, `UNIFORM_BUS_RADIUS`,
`UNIFORM_BUS_MIN_RADIUS` and `UNIFORM_BUS_GROUND_RADIUS`.
