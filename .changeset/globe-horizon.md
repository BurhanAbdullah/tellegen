---
'@tellegen/svelte': patch
---

Hide the far side of the globe by culling past the horizon in the shader, and draw the overlay on top again. 0.4.6's depth test against maplibre's globe also cut away parts of a network facing the camera. `TellegenMap` adds the horizon extension to its own layers and to `extraLayers`.
