---
"@tellegen/svelte": minor
---

Accessibility fixes in the panels:

- Text in the Network panel, the solver card, the size legend and the residual sparkline is at least 12 px; sizes from 10 to 11.5 px grow by 2 px, so the hierarchy holds.
- The dark `--ink-faint` is `#95a6b6`, 7.14:1 against the panel composited over `#4a4a4a`.
- The dark `--border-strong`, which marks a panel's edge over the map, is `#859cb4`. It measures 6.30:1 against the panel and 3.13:1 against bare `#4a4a4a`; the old `#6f8aa6` measured only 2.47:1 against the grey.
- The panel close button has a 44 px target under coarse pointers.
- When a panel closes, focus moves to its toolbar button. Without one, it returns to the control that opened the panel, else to the panel's dock (a region named "Left panels" or "Right panels"), or to the drawer on narrow screens.
- Panel content that overflows becomes a focusable, labelled region.
- The demand range toggle is a labelled group, and the "full range" button's accessible name now contains its visible label.
- Arrow keys on the demand and rating sliders step about 1% of the range, and never less than 0.5 MW, so every press leaves the 0.25 MW dead zone.
- An infeasible DC OPF reports "No feasible dispatch: demand cannot be served within line and generator limits". The solver text moves to the new `app.errorDetail` and into the notice's disclosure.
- `MAP_PALETTE` gains `neutral`, the fill of a neutral terminal in the multiconductor detail, whose outline now follows `--ink`.
