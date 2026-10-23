//! Load allocation. At high fidelity each bus is weighted by the inverse
//! distance weighted population of places within 25 km, with a floor so a
//! bus with no place nearby still carries some load; at low fidelity (or
//! without a population signal) weights are a floor plus a skewed random
//! draw. Weights are normalised to the context's peak demand and reactive
//! power follows the requested power factor.

use crate::context::ContextData;
use crate::electrical::params::{bus_load_cap_mw, LOAD_FLOOR_MEDIAN_FRACTION, LOAD_IDW_RADIUS_KM};
use crate::places::population_idw;
use crate::report::RegionContext;
use crate::request::Fidelity;
use crate::rng::Stream;
use crate::site::DraftBus;

/// What load allocation reports back.
pub struct LoadOutcome {
    /// No place was in range of any bus; the allocation used the random spread.
    pub uniform: bool,
    /// Buses moved to a higher voltage level because their load exceeded the
    /// class cap.
    pub promoted: usize,
}

/// Allocate `ctx.peak_demand_mw` over the buses, then promote any bus whose
/// load exceeds its voltage class cap to the lowest level that holds it.
pub fn assign_loads(
    buses: &mut [DraftBus],
    ctx: &RegionContext,
    data: &ContextData,
    fidelity: Fidelity,
    power_factor: f64,
    rng: &mut Stream,
) -> LoadOutcome {
    if buses.is_empty() {
        return LoadOutcome {
            uniform: false,
            promoted: 0,
        };
    }
    let points: Vec<(f64, f64)> = buses.iter().map(|b| (b.lon, b.lat)).collect();
    let raw = if fidelity == Fidelity::High {
        population_idw(&points, &data.cities, LOAD_IDW_RADIUS_KM)
    } else {
        vec![0.0; buses.len()]
    };
    let max_w = raw.iter().cloned().fold(0.0, f64::max);
    let uniform = max_w <= 0.0;
    let weights: Vec<f64> = if uniform {
        buses
            .iter()
            .map(|_| 0.45 + rng.uniform().powf(1.8))
            .collect()
    } else {
        let mut nonzero: Vec<f64> = raw.iter().copied().filter(|w| *w > 0.0).collect();
        nonzero.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median = nonzero[nonzero.len() / 2];
        let floor = LOAD_FLOOR_MEDIAN_FRACTION * median;
        raw.iter()
            .map(|w| w.max(floor) * (0.9 + 0.2 * rng.uniform()))
            .collect()
    };
    let total: f64 = weights.iter().sum();
    let tan_phi = power_factor.clamp(1e-6, 1.0).acos().tan();
    for (bus, w) in buses.iter_mut().zip(&weights) {
        bus.population_weight = w / total;
        bus.load_mw = ctx.peak_demand_mw * w / total;
        bus.load_mvar = bus.load_mw * tan_phi;
    }
    let levels = &ctx.voltage_levels_kv;
    let mut promoted = 0;
    for bus in buses.iter_mut() {
        let before = bus.tier;
        while bus.tier > 0 && bus.load_mw > bus_load_cap_mw(levels[bus.tier]) {
            bus.tier -= 1;
        }
        if bus.tier != before {
            bus.base_kv = levels[bus.tier];
            promoted += 1;
            bus.annotation = format!(
                "{} (promoted to {} kV for a {:.0} MW load)",
                bus.annotation, bus.base_kv, bus.load_mw
            );
        }
    }
    LoadOutcome { uniform, promoted }
}
