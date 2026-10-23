#![allow(dead_code)]

use std::sync::{Arc, OnceLock};

use tellegen_synth::{Places, Region, SynthRequest};

pub fn places() -> Arc<Places> {
    static PLACES: OnceLock<Arc<Places>> = OnceLock::new();
    PLACES
        .get_or_init(|| {
            Arc::new(
                Places::parse(include_bytes!("../fixtures/places_small.json")).expect("fixture"),
            )
        })
        .clone()
}

pub fn iraq_box() -> Region {
    Region::bbox(42.1, 31.1, 48.5, 36.8, "Iraq box")
}

pub fn rhine_box() -> Region {
    Region::bbox(4.0, 48.5, 10.0, 52.0, "Rhine box")
}

pub fn gulf_of_guinea_box() -> Region {
    Region::bbox(-2.0, 5.0, 1.0, 8.0, "Gulf of Guinea box")
}

/// Two landmasses 25 km apart (joined by an interconnect) plus holes.
pub fn two_landmasses() -> Region {
    Region {
        geometry: serde_json::json!({"type": "MultiPolygon", "coordinates": [
            [[[8.0, 38.8], [9.9, 38.8], [9.9, 41.3], [8.0, 41.3], [8.0, 38.8]]],
            [[[8.4, 41.5], [9.6, 41.5], [9.6, 43.1], [8.4, 43.1], [8.4, 41.5]]]
        ]}),
        label: "Two islands".to_owned(),
    }
}

pub fn request(region: Region, seed: u64, buses: Option<u32>) -> SynthRequest {
    let mut req = SynthRequest::new(region);
    req.seed = seed;
    req.target_bus_count = buses;
    req
}
