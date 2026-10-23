//! Populated places (Natural Earth 10m `ne_10m_populated_places`, public
//! domain), trimmed to `{n: name, lo: lon, la: lat, p: pop_max, c: iso_a3}`.
//! They anchor buses on real cities and carry the population signal that
//! sizes and allocates load. Parsed once per process and shared by sessions.

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::SynthError;
use crate::geom::haversine_km;
use crate::geom::region::RegionShape;
use crate::report::BBox;

/// One populated place.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub name: String,
    pub lon: f64,
    pub lat: f64,
    /// `pop_max`; Natural Earth's `-99` unknown sentinel is clamped to 0.
    pub population: f64,
    pub iso_a3: String,
}

#[derive(Deserialize)]
struct Row {
    n: String,
    lo: f64,
    la: f64,
    p: f64,
    #[serde(default)]
    c: String,
}

/// The places table: rows sorted by population descending, plus a latitude
/// sorted index for window queries.
#[derive(Clone, Debug)]
pub struct Places {
    rows: Vec<Place>,
    /// Row indices sorted by latitude.
    by_lat: Vec<usize>,
    sha256: String,
}

/// A place positioned in a region's continuous longitude frame. `lon` may
/// differ from the place's stored longitude on a seam-crossing frame.
#[derive(Clone, Debug, PartialEq)]
pub struct PlacedCity {
    pub lon: f64,
    pub lat: f64,
    pub place: Place,
}

impl Places {
    /// Parse the compact JSON array.
    pub fn parse(bytes: &[u8]) -> Result<Self, SynthError> {
        let rows: Vec<Row> = serde_json::from_slice(bytes)
            .map_err(|e| SynthError::Places(format!("cannot parse places table: {e}")))?;
        let mut places = Vec::with_capacity(rows.len());
        for (i, row) in rows.into_iter().enumerate() {
            if !(-180.0..=180.0).contains(&row.lo) || !(-90.0..=90.0).contains(&row.la) {
                return Err(SynthError::Places(format!(
                    "row {i} has coordinates out of range (lon={}, lat={})",
                    row.lo, row.la
                )));
            }
            places.push(Place {
                name: row.n,
                lon: row.lo,
                lat: row.la,
                population: if row.p.is_finite() {
                    row.p.max(0.0)
                } else {
                    0.0
                },
                iso_a3: row.c,
            });
        }
        places.sort_by(|a, b| {
            b.population
                .partial_cmp(&a.population)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| {
                    a.lon
                        .partial_cmp(&b.lon)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
        });
        let mut by_lat: Vec<usize> = (0..places.len()).collect();
        by_lat.sort_by(|&a, &b| {
            places[a]
                .lat
                .partial_cmp(&places[b].lat)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let digest = Sha256::digest(bytes);
        Ok(Self {
            rows: places,
            by_lat,
            sha256: digest.iter().map(|b| format!("{b:02x}")).collect(),
        })
    }

    /// The bundled table (`data/populated_places.json`), for the CLI and
    /// offline tests. The wasm build fetches the same file beside the binary
    /// instead of embedding it.
    #[cfg(feature = "embedded-places")]
    pub fn embedded() -> Result<Self, SynthError> {
        Self::parse(include_bytes!("../data/populated_places.json"))
    }

    /// An empty table: every bus falls back to blue-noise siting.
    pub fn empty() -> Self {
        Self {
            rows: Vec::new(),
            by_lat: Vec::new(),
            sha256: Sha256::digest(b"")
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    pub fn rows(&self) -> &[Place] {
        &self.rows
    }

    /// Row indices with latitude in `[south, north]`.
    fn lat_window(&self, south: f64, north: f64) -> &[usize] {
        let lo = self.by_lat.partition_point(|&i| self.rows[i].lat < south);
        let hi = self.by_lat.partition_point(|&i| self.rows[i].lat <= north);
        &self.by_lat[lo..hi.max(lo)]
    }

    /// Places inside the shape, in its frame, sorted by population descending.
    pub fn in_region(&self, shape: &RegionShape) -> Vec<PlacedCity> {
        let frame = &shape.frame;
        let seam = frame.east > 180.0;
        let mut out = Vec::new();
        for &i in self.lat_window(frame.south, frame.north) {
            let place = &self.rows[i];
            let mut lon = place.lon;
            if seam && lon < frame.west {
                lon += 360.0;
            }
            if lon < frame.west || lon > frame.east {
                continue;
            }
            if !shape.contains(lon, place.lat) {
                continue;
            }
            out.push(PlacedCity {
                lon,
                lat: place.lat,
                place: place.clone(),
            });
        }
        out.sort_by(|a, b| {
            b.place
                .population
                .partial_cmp(&a.place.population)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.place.name.cmp(&b.place.name))
        });
        out
    }

    /// Places within `frame` (no polygon test), in its frame.
    pub fn in_frame(&self, frame: &BBox) -> Vec<PlacedCity> {
        let seam = frame.east > 180.0;
        let mut out = Vec::new();
        for &i in self.lat_window(frame.south, frame.north) {
            let place = &self.rows[i];
            let mut lon = place.lon;
            if seam && lon < frame.west {
                lon += 360.0;
            }
            if lon < frame.west || lon > frame.east {
                continue;
            }
            out.push(PlacedCity {
                lon,
                lat: place.lat,
                place: place.clone(),
            });
        }
        out
    }
}

/// Inverse-distance-weighted population within `radius_km` of each point:
/// `Σ pop / (1 + d)` over the cities in range. Cities are bucketed on a
/// `radius`-sized grid so the cost is O(points + cities).
pub fn population_idw(points: &[(f64, f64)], cities: &[PlacedCity], radius_km: f64) -> Vec<f64> {
    let mut out = vec![0.0; points.len()];
    if cities.is_empty() || points.is_empty() {
        return out;
    }
    let cell_lat = radius_km / 111.0;
    let key = |lon: f64, lat: f64| -> (i64, i64) {
        let cell_lon = cell_lat / lat.to_radians().cos().abs().max(0.05);
        (
            (lon / cell_lon).floor() as i64,
            (lat / cell_lat).floor() as i64,
        )
    };
    let mut buckets: std::collections::HashMap<(i64, i64), Vec<usize>> =
        std::collections::HashMap::new();
    for (i, c) in cities.iter().enumerate() {
        buckets.entry(key(c.lon, c.lat)).or_default().push(i);
    }
    for (k, &(lon, lat)) in points.iter().enumerate() {
        let (cx, cy) = key(lon, lat);
        let mut w = 0.0;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(list) = buckets.get(&(cx + dx, cy + dy)) {
                    for &i in list {
                        let c = &cities[i];
                        let d = haversine_km(lon, lat, c.lon, c.lat);
                        if d <= radius_km {
                            w += c.place.population / (1.0 + d);
                        }
                    }
                }
            }
        }
        out[k] = w;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) const FIXTURE: &[u8] = include_bytes!("../tests/fixtures/places_small.json");

    #[test]
    fn parses_and_sorts_by_population() {
        let places = Places::parse(FIXTURE).unwrap();
        assert!(places.len() > 100);
        assert_eq!(places.rows()[0].name, "Paris");
        assert!(places
            .rows()
            .windows(2)
            .all(|w| w[0].population >= w[1].population));
        assert_eq!(places.sha256().len(), 64);
    }

    #[test]
    fn region_query_finds_baghdad_and_respects_the_frame() {
        let places = Places::parse(FIXTURE).unwrap();
        let geom = serde_json::json!({"type":"Polygon","coordinates":[[[42.1,31.1],[48.5,31.1],[48.5,36.8],[42.1,36.8],[42.1,31.1]]]});
        let shape = RegionShape::from_geometry(&geom).unwrap();
        let cities = places.in_region(&shape);
        assert_eq!(cities[0].place.name, "Baghdad");
        assert!(cities.iter().all(|c| shape.contains(c.lon, c.lat)));

        let seam = serde_json::json!({"type":"MultiPolygon","coordinates":[
            [[[170.0,-20.0],[180.0,-20.0],[180.0,-15.0],[170.0,-15.0],[170.0,-20.0]]],
            [[[-180.0,-20.0],[-178.0,-20.0],[-178.0,-15.0],[-180.0,-15.0],[-180.0,-20.0]]]]});
        let shape = RegionShape::from_geometry(&seam).unwrap();
        let cities = places.in_region(&shape);
        assert!(cities.iter().any(|c| c.place.name == "Labasa"));
        assert!(cities.iter().all(|c| c.lon >= 170.0 && c.lon <= 182.0));
    }

    #[test]
    fn idw_concentrates_near_cities() {
        let places = Places::parse(FIXTURE).unwrap();
        let frame = BBox {
            west: 2.0,
            south: 48.0,
            east: 12.0,
            north: 53.0,
        };
        let cities = places.in_frame(&frame);
        let big = cities
            .iter()
            .max_by(|a, b| a.place.population.partial_cmp(&b.place.population).unwrap())
            .unwrap();
        let w = population_idw(
            &[(big.lon, big.lat), (big.lon, big.lat + 0.2)],
            &cities,
            25.0,
        );
        assert!(w[0] > w[1]);
        assert!(w[0] > 0.0);
        let none = population_idw(&[(-20.0, -40.0)], &cities, 25.0);
        assert_eq!(none[0], 0.0);
    }

    #[test]
    fn rejects_out_of_range_rows() {
        let bad = br#"[{"n":"x","lo":200.0,"la":0.0,"p":1,"c":"XXX"}]"#;
        assert!(Places::parse(bad).is_err());
        assert!(Places::parse(b"not json").is_err());
        assert!(Places::empty().is_empty());
    }

    #[cfg(feature = "embedded-places")]
    #[test]
    fn the_bundled_table_parses() {
        let places = Places::embedded().unwrap();
        assert_eq!(places.len(), 7342);
        assert!(places.rows()[0].population >= places.rows()[1].population);
    }
}
