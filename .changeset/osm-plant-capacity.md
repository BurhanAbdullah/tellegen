---
'@tellegen/engine': patch
---

OpenStreetMap grids no longer inflate their generation. A plant and its mapped units count once (the larger of the plant's tag and the units' sum), and a generator with no output tag, mostly rooftop solar, adds nothing instead of an estimated 20 to 200 MW. The Overpass query fetches only generators rated in MW or GW, which shrinks answers (Luxembourg: 1.4 MB to 0.9 MB).
