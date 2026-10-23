//! Generation: units are sited where the network is strong and demand is
//! high (nodal degree, local load, voltage), one per bus, with fuels drawn
//! from the regional mix, relative sizes from a log-normal per fuel, and the
//! reserve-margin capacity target of each island shared out among them. No
//! bus collects more than its voltage class can plausibly evacuate
//! ([`bus_generation_cap_mw`]): a share above the cap spills onto the other
//! units, and when every unit is at its cap the next ranked bus gets a plant.
//! Costs are quadratic by fuel. The largest unit of each island sets its
//! reference bus.

use std::collections::BTreeMap;

use crate::electrical::params::{
    bus_generation_cap_mw, fuel_params, GENERATOR_BUS_SHARE, MIN_UNIT_MW, QMAX_FRACTION,
    QMIN_FRACTION,
};
use crate::report::{BusKind, RegionContext, Warning};
use crate::request::{Fuel, SynthRequest};
use crate::rng::Stream;
use crate::site::DraftBus;
use crate::topology::{corridor_degrees, Corridor};

#[derive(Clone, Debug, PartialEq)]
pub struct DraftGenerator {
    pub bus: usize,
    pub fuel: Fuel,
    pub pmax_mw: f64,
    pub pmin_mw: f64,
    pub qmax_mvar: f64,
    pub qmin_mvar: f64,
    pub c2: f64,
    pub c1: f64,
    pub c0: f64,
    pub makeup: bool,
    pub slack: bool,
}

/// Default unit count for `n` buses.
pub fn default_generator_count(n: usize) -> usize {
    let hi = n.max(1);
    ((GENERATOR_BUS_SHARE * n as f64).round() as usize).clamp(3.min(hi), hi)
}

/// Share `capacity` among units in proportion to `raw`, holding each unit at
/// or below its cap and passing the excess to the units still below theirs.
/// Returns `None` when the caps together hold less than `capacity`.
pub fn share_under_caps(capacity: f64, raw: &[f64], caps: &[f64]) -> Option<Vec<f64>> {
    let m = raw.len();
    if caps.iter().sum::<f64>() < capacity {
        return None;
    }
    let mut capped = vec![false; m];
    loop {
        let held: f64 = (0..m).filter(|&i| capped[i]).map(|i| caps[i]).sum();
        let free_raw: f64 = (0..m).filter(|&i| !capped[i]).map(|i| raw[i]).sum();
        if free_raw <= 0.0 {
            return Some(caps.to_vec());
        }
        let scale = (capacity - held) / free_raw;
        let mut changed = false;
        for i in 0..m {
            if !capped[i] && scale * raw[i] > caps[i] {
                capped[i] = true;
                changed = true;
            }
        }
        if !changed {
            return Some(
                (0..m)
                    .map(|i| if capped[i] { caps[i] } else { scale * raw[i] })
                    .collect(),
            );
        }
    }
}

pub fn place_generators(
    buses: &mut [DraftBus],
    corridors: &[Corridor],
    ctx: &RegionContext,
    req: &SynthRequest,
    rng: &mut Stream,
    warnings: &mut Vec<Warning>,
) -> Vec<DraftGenerator> {
    let n = buses.len();
    if n == 0 {
        return Vec::new();
    }
    let deg = corridor_degrees(n, corridors);
    let max_deg = deg.iter().copied().max().unwrap_or(1).max(1) as f64;
    let max_load = buses.iter().map(|b| b.load_mw).fold(1e-6, f64::max);
    let max_kv = buses.iter().map(|b| b.base_kv).fold(1e-6, f64::max);
    let score: Vec<f64> = (0..n)
        .map(|i| {
            deg[i] as f64 / max_deg
                + 0.6 * buses[i].load_mw / max_load
                + 0.2 * buses[i].base_kv / max_kv
        })
        .collect();

    let requested = req.generator_count.map(|g| g as usize);
    let total_count = requested
        .unwrap_or_else(|| default_generator_count(n))
        .min(n);
    if total_count == 0 {
        return Vec::new();
    }

    // Islands: load share decides the unit count, every island gets one.
    let mut island_load: BTreeMap<usize, f64> = BTreeMap::new();
    let mut island_buses: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, b) in buses.iter().enumerate() {
        *island_load.entry(b.island).or_default() += b.load_mw;
        island_buses.entry(b.island).or_default().push(i);
    }
    let total_load: f64 = island_load.values().sum::<f64>().max(1e-9);
    let islands: Vec<usize> = island_buses.keys().copied().collect();
    let mut counts: BTreeMap<usize, usize> = islands
        .iter()
        .map(|&k| {
            let share = island_load[&k] / total_load;
            let c = ((total_count as f64 * share).round() as usize).max(1);
            (k, c.min(island_buses[&k].len()))
        })
        .collect();
    // Trim or pad to the requested total where island sizes allow.
    let mut assigned: usize = counts.values().sum();
    let mut guard = 0;
    while assigned != total_count && guard < 10_000 {
        guard += 1;
        if assigned > total_count {
            if let Some((&k, _)) = counts
                .iter()
                .filter(|(_, c)| **c > 1)
                .max_by_key(|(_, c)| **c)
            {
                *counts.get_mut(&k).unwrap() -= 1;
                assigned -= 1;
            } else {
                break;
            }
        } else if let Some((&k, _)) = counts
            .iter()
            .filter(|(k, c)| **c < island_buses[k].len())
            .max_by(|(a, _), (b, _)| island_load[a].partial_cmp(&island_load[b]).unwrap())
        {
            *counts.get_mut(&k).unwrap() += 1;
            assigned += 1;
        } else {
            break;
        }
    }

    let fuels: Vec<Fuel> = ctx.fuel_mix.keys().copied().collect();
    let fuel_weights: Vec<f64> = ctx.fuel_mix.values().copied().collect();
    let draw = |rng: &mut Stream| -> (Fuel, f64) {
        let fuel = rng
            .weighted_index(&fuel_weights)
            .map(|k| fuels[k])
            .unwrap_or(Fuel::Gas);
        let p = fuel_params(fuel);
        (fuel, rng.log_normal_bounded(p.size_mu, p.size_sigma))
    };
    let cap_of = |b: &DraftBus| bus_generation_cap_mw(b.base_kv);
    let mut spilled = 0usize;
    let mut over_cap = 0usize;
    let mut gens = Vec::with_capacity(total_count);
    for &island in &islands {
        let count = counts[&island];
        if count == 0 {
            continue;
        }
        let mut ranked: Vec<usize> = island_buses[&island].clone();
        ranked.sort_by(|&a, &b| score[b].partial_cmp(&score[a]).unwrap().then(a.cmp(&b)));
        let capacity = (1.0 + req.reserve_margin) * island_load[&island].max(1.0);
        let mut drafts: Vec<(usize, Fuel, f64)> = Vec::with_capacity(count);
        for &bus in ranked.iter().take(count) {
            let (fuel, raw) = draw(rng);
            drafts.push((bus, fuel, raw));
        }
        let sizes = loop {
            let raw: Vec<f64> = drafts.iter().map(|d| d.2).collect();
            let caps: Vec<f64> = drafts.iter().map(|d| cap_of(&buses[d.0])).collect();
            if let Some(sizes) = share_under_caps(capacity, &raw, &caps) {
                break sizes;
            }
            // Every unit sits at its bus's cap. A default count grows onto the
            // next ranked bus; a requested count is honoured and the units
            // exceed their caps, which the report says.
            if requested.is_none() && drafts.len() < ranked.len() {
                let bus = ranked[drafts.len()];
                let (fuel, raw) = draw(rng);
                drafts.push((bus, fuel, raw));
                spilled += 1;
                continue;
            }
            let raw_total: f64 = raw.iter().sum::<f64>().max(1e-9);
            let sizes: Vec<f64> = raw.iter().map(|r| capacity * r / raw_total).collect();
            over_cap += sizes.iter().zip(&caps).filter(|(s, c)| s > c).count();
            break sizes;
        };
        let first = gens.len();
        for ((bus, fuel, _), size) in drafts.into_iter().zip(sizes) {
            let pmax = size.max(MIN_UNIT_MW);
            let p = fuel_params(fuel);
            let c1 = rng.range(p.c1_range.0, p.c1_range.1);
            let c2 = p.c2 * (0.8 + 0.4 * rng.uniform());
            buses[bus].kind = BusKind::Generator;
            buses[bus].annotation = "Generator sited on a high-degree, high-demand bus".to_owned();
            gens.push(DraftGenerator {
                bus,
                fuel,
                pmax_mw: pmax,
                pmin_mw: 0.0,
                qmax_mvar: QMAX_FRACTION * pmax,
                qmin_mvar: QMIN_FRACTION * pmax,
                c2,
                c1,
                c0: 0.0,
                makeup: false,
                slack: false,
            });
        }
        // The island's largest unit is its reference.
        if let Some(k) = (first..gens.len()).max_by(|&a, &b| {
            gens[a]
                .pmax_mw
                .partial_cmp(&gens[b].pmax_mw)
                .unwrap()
                .then(b.cmp(&a))
        }) {
            gens[k].slack = true;
        }
    }
    if spilled > 0 {
        warnings.push(Warning::new(
            "generation_spread",
            format!(
                "{spilled} generator bus(es) beyond the default count: the capacity target exceeds what the default buses can collect at their voltage class caps"
            ),
        ));
    }
    if over_cap > 0 {
        warnings.push(Warning::new(
            "generator_cap_exceeded",
            format!(
                "{over_cap} unit(s) exceed the generation cap of their bus's voltage class because the requested generator count cannot hold the capacity target otherwise"
            ),
        ));
    }
    gens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_respect_caps_and_spill() {
        let s = share_under_caps(100.0, &[1.0, 1.0, 2.0], &[1000.0, 1000.0, 1000.0]).unwrap();
        assert!((s[2] - 50.0).abs() < 1e-9 && (s[0] - 25.0).abs() < 1e-9);
        let s = share_under_caps(100.0, &[1.0, 1.0, 8.0], &[100.0, 100.0, 40.0]).unwrap();
        assert!((s[2] - 40.0).abs() < 1e-9);
        assert!((s[0] - 30.0).abs() < 1e-9 && (s[1] - 30.0).abs() < 1e-9);
        assert!(share_under_caps(100.0, &[1.0, 1.0], &[40.0, 40.0]).is_none());
    }
}
