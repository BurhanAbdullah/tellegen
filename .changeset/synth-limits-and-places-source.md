---
"@tellegen/engine": patch
---

Synthetic generation refuses an unknown key at every level of the request, not
only at the top, so a misspelt `limits`, `islands`, `osm`, `demand`,
`calibration`, `validation`, `region` or `fallback_from` option is an
`invalid_request` instead of being ignored. `limits.max_area_km2` must be
positive and finite, and `limits.max_branch_factor` finite and at least 1.

OpenStreetMap mode keeps to `limits.max_bus_count`. When the mapped substation
levels and converters make more buses than the cap, the lowest substation
levels are left out, one at a time, until they fit, and the
`osm_bus_count_capped` warning says which were kept. A region whose highest
level alone exceeds the cap is refused as `invalid_request`.

`data/populated_places.json` records its source: it is now an object that names
Natural Earth v5.1.2 and the SHA-256 of `ne_10m_populated_places_simple.geojson`,
with the same rows under `places`, written by
`scripts/derive-populated-places.py`. The report's `provenance.places` carries
the new `source` and `source_sha256`. `loadSyntheticPlaces` still accepts a bare
array of rows, whose provenance names no source.
