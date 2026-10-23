//! The context stage: parse the region, measure it, find its populated
//! places, resolve bus count, peak demand and fuel mix, and decide which
//! polygons take part (tiny islets and far islands under the `Cut` policy do
//! not).

use std::collections::BTreeMap;

use crate::error::SynthError;
use crate::geom::region::RegionShape;
use crate::geom::{haversine_km, wrap_lon};
use crate::places::{PlacedCity, Places};
use crate::report::{DemandBasis, RegionContext, Warning};
use crate::request::{DemandSpec, Density, FarIslandPolicy, SynthRequest};

/// Everything later stages need from the context stage that is not in the
/// public [`RegionContext`].
pub struct ContextData {
    pub shape: RegionShape,
    pub cities: Vec<PlacedCity>,
    /// Sampling weight per polygon (0 for excluded polygons).
    pub polygon_weights: Vec<f64>,
    /// Group index per polygon (`None` when excluded). Polygons in one group
    /// are joined by interconnects; different groups are separate islands.
    pub polygon_group: Vec<Option<usize>>,
    pub group_count: usize,
}

/// Bus count from density and area when the request states none. The square
/// root law keeps a continent at a few hundred buses and a small country at a
/// few dozen; `target_bus_count` overrides it.
pub fn density_bus_count(density: Density, area_km2: f64) -> u32 {
    let base = match density {
        Density::Low => 28.0,
        Density::Medium => 52.0,
        Density::High => 78.0,
    };
    let area_factor = ((area_km2.max(100.0) / 10_000.0).sqrt() / 2.5).clamp(0.8, 4.0);
    (base * area_factor).round().clamp(14.0, 400.0) as u32
}

/// Branches per bus by density when the request states none. source:
/// Birchfield et al. 2017 report branch/bus ratios of 1.2–1.5 for North
/// American transmission systems.
pub fn density_branch_factor(density: Density) -> f64 {
    match density {
        Density::Low => 1.18,
        Density::Medium => 1.32,
        Density::High => 1.45,
    }
}

/// Peak demand per bus when the region has no population signal. source:
/// the ACTIVSg2000 case carries 67 GW over 2000 buses, about 33 MW per bus;
/// the smaller ACTIVSg200 carries 1.5 GW over 200 buses, 7.5 MW per bus. A
/// demo region sits between.
const DEFAULT_MW_PER_BUS: f64 = 14.0;

/// Expected buses below which a polygon is left out of sampling.
const MIN_EXPECTED_BUSES: f64 = 0.5;

pub fn resolve_context(
    req: &SynthRequest,
    places: &Places,
    warnings: &mut Vec<Warning>,
) -> Result<(RegionContext, ContextData), SynthError> {
    let shape = RegionShape::from_geometry(&req.region.geometry).map_err(SynthError::Region)?;
    if shape.area_km2 > req.limits.max_area_km2 {
        return Err(SynthError::InvalidRequest(format!(
            "region area {:.0} km² exceeds limits.max_area_km2 = {:.0}",
            shape.area_km2, req.limits.max_area_km2
        )));
    }
    if shape.area_km2 <= 0.0 {
        return Err(SynthError::Region(
            "region polygons enclose no area".to_owned(),
        ));
    }
    let n = req
        .target_bus_count
        .unwrap_or_else(|| density_bus_count(req.density, shape.area_km2))
        .min(req.limits.max_bus_count)
        .max(1);
    if let Some(g) = req.generator_count {
        if g > n {
            return Err(SynthError::InvalidRequest(format!(
                "generator_count must be no greater than generated bus count ({n})"
            )));
        }
    }

    // Polygon participation: expected bus share first, then island grouping.
    let areas = shape.polygon_areas();
    let total_area: f64 = areas.iter().sum();
    let mut kept: Vec<usize> = (0..areas.len())
        .filter(|&i| areas[i] / total_area * n as f64 >= MIN_EXPECTED_BUSES || areas.len() == 1)
        .collect();
    if kept.is_empty() {
        kept.push(
            (0..areas.len())
                .max_by(|&a, &b| areas[a].partial_cmp(&areas[b]).unwrap())
                .unwrap_or(0),
        );
    }
    let skipped_small = areas.len() - kept.len();
    if skipped_small > 0 {
        warnings.push(Warning::new(
            "small_islands_skipped",
            format!(
                "{skipped_small} polygon(s) too small for a bus at this count were left out of siting"
            ),
        ));
    }
    let groups = landmass_groups(&shape, &kept, req.islands.max_interconnect_km);
    let mut polygon_group = vec![None; areas.len()];
    let mut polygon_weights = vec![0.0; areas.len()];
    let main_group = groups
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| {
            let sa: f64 = a.iter().map(|&i| areas[i]).sum();
            let sb: f64 = b.iter().map(|&i| areas[i]).sum();
            sa.partial_cmp(&sb).unwrap()
        })
        .map(|(k, _)| k)
        .unwrap_or(0);
    let mut group_count = 0;
    let mut cut_area = 0.0;
    let mut cut_polygons = 0usize;
    for (k, group) in groups.iter().enumerate() {
        let retained = k == main_group || req.islands.beyond == FarIslandPolicy::Keep;
        if retained {
            for &i in group {
                polygon_group[i] = Some(group_count);
                polygon_weights[i] = areas[i];
            }
            group_count += 1;
        } else {
            cut_polygons += group.len();
            cut_area += group.iter().map(|&i| areas[i]).sum::<f64>();
        }
    }
    if cut_polygons > 0 {
        warnings.push(Warning::new(
            "islands_cut",
            format!(
                "{cut_polygons} landmass polygon(s) covering {cut_area:.0} km² lie farther than {:.0} km from the connected system and were not generated (islands.beyond = cut)",
                req.islands.max_interconnect_km
            ),
        ));
    }
    if group_count > 1 {
        warnings.push(Warning::new(
            "multiple_islands",
            format!(
                "the region forms {group_count} electrical islands; each is validated separately and the module carries one reference bus per island"
            ),
        ));
    }

    // Places: only inside retained polygons.
    let cities: Vec<PlacedCity> = places
        .in_region(&shape)
        .into_iter()
        .filter(|c| {
            shape
                .polygon_index(c.lon, c.lat)
                .is_some_and(|i| polygon_group[i].is_some())
        })
        .collect();
    let population: f64 = cities.iter().map(|c| c.place.population).sum();

    let (peak_demand_mw, demand_basis) = match &req.demand {
        DemandSpec::TotalMw { mw } => (*mw, DemandBasis::TotalMw),
        DemandSpec::Population {
            per_capita_kw,
            peak_factor,
        } => {
            if population > 0.0 {
                (
                    population * per_capita_kw * peak_factor / 1000.0,
                    DemandBasis::Population,
                )
            } else {
                warnings.push(Warning::new(
                    "no_population_signal",
                    "no populated place lies inside the region; demand uses a per-bus default and loads spread uniformly",
                ));
                (DEFAULT_MW_PER_BUS * n as f64, DemandBasis::DefaultPerBus)
            }
        }
    };

    let levels = req.resolved_voltage_levels();
    let classes: Vec<f64> = levels
        .iter()
        .map(|&kv| crate::electrical::params::line_class_for(kv).kv)
        .collect();
    let frame = shape.frame;
    let context = RegionContext {
        label: if req.region.label.trim().is_empty() {
            "Selected region".to_owned()
        } else {
            req.region.label.clone()
        },
        area_km2: shape.area_km2,
        center_lon: wrap_lon((frame.west + frame.east) / 2.0),
        center_lat: (frame.south + frame.north) / 2.0,
        frame,
        crosses_antimeridian: shape.crosses_antimeridian(),
        landmasses: polygon_group.iter().filter(|g| g.is_some()).count(),
        population_in_region: population,
        places_in_region: cities.len(),
        target_bus_count: n,
        peak_demand_mw,
        demand_basis,
        fuel_mix: req.resolved_fuel_mix(),
        branch_factor: req
            .branch_factor
            .unwrap_or_else(|| density_branch_factor(req.density)),
        voltage_levels_kv: levels,
        voltage_classes_kv: classes,
    };
    Ok((
        context,
        ContextData {
            shape,
            cities,
            polygon_weights,
            polygon_group,
            group_count,
        },
    ))
}

/// Single-linkage groups of the kept polygons: two polygons join when some
/// pair of their outer-ring vertices is within `max_km`. Rings are subsampled
/// to at most 200 vertices and bounding boxes reject distant pairs first.
fn landmass_groups(shape: &RegionShape, kept: &[usize], max_km: f64) -> Vec<Vec<usize>> {
    let samples: Vec<Vec<(f64, f64)>> = kept
        .iter()
        .map(|&i| {
            let ring = &shape.polygons[i].rings[0];
            let step = (ring.len() / 200).max(1);
            ring.iter().step_by(step).copied().collect()
        })
        .collect();
    let mut uf = crate::geom::delaunay::UnionFind::new(kept.len());
    for a in 0..kept.len() {
        for b in a + 1..kept.len() {
            let (ba, bb) = (
                shape.polygons[kept[a]].bbox(),
                shape.polygons[kept[b]].bbox(),
            );
            let lat_gap = (ba.south.max(bb.south) - ba.north.min(bb.north)).max(0.0) * 111.0;
            if lat_gap > max_km {
                continue;
            }
            let lon_gap = (ba.west.max(bb.west) - ba.east.min(bb.east)).max(0.0);
            let lat_mid = (ba.south + ba.north + bb.south + bb.north) / 4.0;
            if lon_gap * 111.0 * lat_mid.to_radians().cos().abs() > max_km * 1.2 {
                continue;
            }
            let mut near = false;
            'outer: for &p in &samples[a] {
                for &q in &samples[b] {
                    if haversine_km(p.0, p.1, q.0, q.1) <= max_km {
                        near = true;
                        break 'outer;
                    }
                }
            }
            if near {
                uf.union(a, b);
            }
        }
    }
    let mut by_root: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (k, &poly) in kept.iter().enumerate() {
        by_root.entry(uf.find(k)).or_default().push(poly);
    }
    by_root.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::request::Region;

    #[test]
    fn density_counts_follow_area_and_clamp() {
        assert_eq!(density_bus_count(Density::High, 373_000.0), 191);
        assert!(density_bus_count(Density::Low, 1.0) >= 14);
        assert!(density_bus_count(Density::High, 1.0e8) <= 400);
        assert!(
            density_bus_count(Density::Medium, 50_000.0)
                < density_bus_count(Density::High, 50_000.0)
        );
    }

    #[test]
    fn far_islands_are_cut_by_default_and_kept_on_request() {
        // A mainland box and an island box 600 km east.
        let geom = serde_json::json!({"type":"MultiPolygon","coordinates":[
            [[[0.0,0.0],[3.0,0.0],[3.0,3.0],[0.0,3.0],[0.0,0.0]]],
            [[[9.0,0.0],[11.0,0.0],[11.0,2.0],[9.0,2.0],[9.0,0.0]]]]});
        let mut req = SynthRequest::new(Region {
            geometry: geom,
            label: "two".into(),
        });
        req.target_bus_count = Some(40);
        let places = Places::empty();
        let mut warnings = Vec::new();
        let (ctx, data) = resolve_context(&req, &places, &mut warnings).unwrap();
        assert_eq!(data.group_count, 1);
        assert_eq!(ctx.landmasses, 1);
        assert!(warnings.iter().any(|w| w.code == "islands_cut"));
        assert_eq!(data.polygon_weights[1], 0.0);

        req.islands.beyond = FarIslandPolicy::Keep;
        let mut warnings = Vec::new();
        let (ctx, data) = resolve_context(&req, &places, &mut warnings).unwrap();
        assert_eq!(data.group_count, 2);
        assert_eq!(ctx.landmasses, 2);
        assert!(warnings.iter().any(|w| w.code == "multiple_islands"));

        req.islands.max_interconnect_km = 1000.0;
        let (_, data) = resolve_context(&req, &places, &mut Vec::new()).unwrap();
        assert_eq!(data.group_count, 1);
        assert!(data.polygon_weights[1] > 0.0);
    }

    #[test]
    fn population_demand_and_default_fallback() {
        let places = Places::parse(include_bytes!("../tests/fixtures/places_small.json")).unwrap();
        let req = SynthRequest::new(Region::bbox(42.1, 31.1, 48.5, 36.8, "Iraq box"));
        let mut w = Vec::new();
        let (ctx, data) = resolve_context(&req, &places, &mut w).unwrap();
        assert_eq!(ctx.demand_basis, DemandBasis::Population);
        assert!(ctx.population_in_region > 5_000_000.0);
        assert!(ctx.peak_demand_mw > 5_000.0);
        assert_eq!(data.cities[0].place.name, "Baghdad");
        assert_eq!(ctx.target_bus_count, 191);

        let req = SynthRequest::new(Region::bbox(-30.0, -50.0, -10.0, -30.0, "South Atlantic"));
        let mut w = Vec::new();
        let (ctx, _) = resolve_context(&req, &places, &mut w).unwrap();
        assert_eq!(ctx.demand_basis, DemandBasis::DefaultPerBus);
        assert!(w.iter().any(|x| x.code == "no_population_signal"));
    }
}
