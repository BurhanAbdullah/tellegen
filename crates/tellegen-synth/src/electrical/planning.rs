//! Corridor planning: decide the voltage class and the number of circuits
//! of every corridor before any validation runs. The planning case is the
//! peak load served by the least-cost dispatch of the generators (an economic
//! dispatch that ignores the network); a lossless DC power flow puts that
//! dispatch on the corridors. A corridor whose flow would need more than
//! [`UPGRADE_CIRCUITS`] circuits at its voltage raises its ends to the next
//! level, as a planner chooses the class by the power and distance a
//! corridor carries. Then every corridor whose circuits would run above
//! [`PLANNING_UTILISATION`] of their rating gets more circuits. Added circuits
//! pull flow toward themselves, so the plan repeats until no corridor needs
//! more (Garver's flow-driven expansion). A corridor that steps down through
//! a transformer first takes a larger bank, up to the rating of its line,
//! before it takes another circuit. Every corridor within its own rating can
//! still add up to too wide an angle along a chain, so the plan then
//! stiffens any island whose planning-case angle spread exceeds
//! [`MAX_ANGLE_SPREAD_RAD`], reinforcing the corridors whose reinforcement
//! narrows the spread most to first order. Circuits the requested branch
//! factor still leaves to place go where the planned flow is heaviest.
//!
//! Ratings stay what the conductor and the line length allow; capacity comes
//! from circuits. The DC power flow is the grounded Laplacian system solved
//! by Jacobi-preconditioned conjugate gradients, O(iterations × branches),
//! with no dependence on platform or clock.

use crate::electrical::branches::{design_circuits, CircuitDesign, CorridorDraw, BASE_MVA};
use crate::electrical::generators::DraftGenerator;
use crate::electrical::params::{
    MAX_ANGLE_SPREAD_RAD, MAX_CIRCUITS_PER_CORRIDOR, PLANNING_MAX_ROUNDS, PLANNING_UTILISATION,
    STIFFENING_BATCH_SHARE, TRANSFORMER_SIZE_STEP_MVA, UPGRADE_CIRCUITS,
};
use crate::geom::delaunay::UnionFind;
use crate::site::DraftBus;
use crate::topology::Corridor;

/// What the plan decided and measured.
#[derive(Clone, Debug, PartialEq)]
pub struct CorridorPlan {
    /// Circuits per corridor.
    pub circuits: Vec<u32>,
    /// Planning dispatch per generator, MW.
    pub dispatch: Vec<f64>,
    /// Total planned flow per corridor, MW, signed from the design's `from`
    /// end to its `to` end, with the final circuit counts.
    pub corridor_flow: Vec<f64>,
    /// The slack bus of each electrical component (its reference generator's
    /// bus when it has one).
    pub grounds: Vec<usize>,
    /// Capacity and stiffening rounds run (each one DC power flow).
    pub rounds: u32,
    /// Buses raised to a higher voltage level because an incident corridor
    /// was too heavy for its class.
    pub promoted_buses: usize,
    /// True when the last capacity round added nothing, no corridor wanted
    /// more circuits than [`MAX_CIRCUITS_PER_CORRIDOR`], and every island's
    /// angle spread is within [`MAX_ANGLE_SPREAD_RAD`].
    pub converged: bool,
    /// Circuits added to narrow the angle spread (banks enlarged for it count
    /// under `upsized_transformers`).
    pub stiffening_circuits: usize,
    /// Widest angle spread of an island in the planning case, degrees.
    pub angle_spread_deg: f64,
    /// Circuits added beyond one per corridor for capacity.
    pub capacity_circuits: usize,
    /// Transformer corridors whose bank was enlarged.
    pub upsized_transformers: usize,
    /// Circuits added to reach the requested branch count.
    pub filler_circuits: usize,
    /// Highest circuit loading (flow over rating) of the planning case.
    pub max_loading: f64,
    /// Corridors still loaded above their rating (only when the plan hit a cap).
    pub overloaded_corridors: usize,
}

/// Least-cost outputs of quadratic-cost units meeting `demand` on an
/// unconstrained, lossless network: every unit runs where its incremental
/// cost `c1 + 2 c2 p` equals the common price, unless held at a bound.
/// `units` holds `(pmin, pmax, c1, c2)` with `c2 > 0`.
pub fn economic_dispatch(units: &[(f64, f64, f64, f64)], demand: f64) -> Vec<f64> {
    let at = |price: f64| -> Vec<f64> {
        units
            .iter()
            .map(|&(pmin, pmax, c1, c2)| ((price - c1) / (2.0 * c2.max(1e-12))).clamp(pmin, pmax))
            .collect()
    };
    let pmin: f64 = units.iter().map(|u| u.0).sum();
    let pmax: f64 = units.iter().map(|u| u.1).sum();
    if demand >= pmax {
        return units.iter().map(|u| u.1).collect();
    }
    if demand <= pmin {
        return units.iter().map(|u| u.0).collect();
    }
    let mut lo = units
        .iter()
        .map(|&(pmin, _, c1, c2)| c1 + 2.0 * c2 * pmin)
        .fold(f64::INFINITY, f64::min);
    let mut hi = units
        .iter()
        .map(|&(_, pmax, c1, c2)| c1 + 2.0 * c2 * pmax)
        .fold(f64::NEG_INFINITY, f64::max);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if at(mid).iter().sum::<f64>() < demand {
            lo = mid;
        } else {
            hi = mid;
        }
        if hi - lo <= 1e-12 * hi.abs().max(1.0) {
            break;
        }
    }
    let mut out = at(hi);
    // Close the last bisection gap on the units still between their bounds.
    let gap = demand - out.iter().sum::<f64>();
    let free: Vec<usize> = (0..units.len())
        .filter(|&i| out[i] > units[i].0 && out[i] < units[i].1)
        .collect();
    if let Some(&i) = free.first() {
        out[i] = (out[i] + gap).clamp(units[i].0, units[i].1);
    }
    out
}

/// Bus angles (radians) of a lossless DC power flow. `edges` are
/// `(a, b, susceptance pu)`, `injection` is per unit, and `grounds` holds one
/// bus per connected component whose angle is fixed at zero (it absorbs any
/// imbalance of its component). Solved by Jacobi-preconditioned conjugate
/// gradients on the grounded weighted Laplacian, which is symmetric positive
/// definite on every component with a ground.
pub fn dc_angles(
    n: usize,
    edges: &[(usize, usize, f64)],
    injection: &[f64],
    grounds: &[usize],
) -> Vec<f64> {
    let mut grounded = vec![false; n];
    for &g in grounds {
        grounded[g] = true;
    }
    let mut diag = vec![0.0; n];
    for &(a, b, w) in edges {
        diag[a] += w;
        diag[b] += w;
    }
    let apply = |x: &[f64], y: &mut [f64]| {
        y.iter_mut().for_each(|v| *v = 0.0);
        for &(a, b, w) in edges {
            let d = w * (x[a] - x[b]);
            y[a] += d;
            y[b] -= d;
        }
        for i in 0..n {
            if grounded[i] {
                y[i] = 0.0;
            }
        }
    };
    let precondition = |r: &[f64], z: &mut [f64]| {
        for i in 0..n {
            z[i] = if grounded[i] || diag[i] <= 0.0 {
                0.0
            } else {
                r[i] / diag[i]
            };
        }
    };
    let dot = |u: &[f64], v: &[f64]| u.iter().zip(v).map(|(a, b)| a * b).sum::<f64>();

    let mut x = vec![0.0; n];
    let mut r: Vec<f64> = (0..n)
        .map(|i| if grounded[i] { 0.0 } else { injection[i] })
        .collect();
    let norm0 = dot(&r, &r).sqrt();
    if norm0 == 0.0 {
        return x;
    }
    let mut z = vec![0.0; n];
    precondition(&r, &mut z);
    let mut d = z.clone();
    let mut rz = dot(&r, &z);
    let mut q = vec![0.0; n];
    let max_iterations = 50 * n + 100;
    for _ in 0..max_iterations {
        apply(&d, &mut q);
        let dq = dot(&d, &q);
        if dq <= 0.0 {
            break;
        }
        let alpha = rz / dq;
        for i in 0..n {
            x[i] += alpha * d[i];
            r[i] -= alpha * q[i];
        }
        if dot(&r, &r).sqrt() <= 1e-11 * norm0 {
            break;
        }
        precondition(&r, &mut z);
        let rz_next = dot(&r, &z);
        let beta = rz_next / rz;
        rz = rz_next;
        for i in 0..n {
            d[i] = z[i] + beta * d[i];
        }
    }
    x
}

/// Series susceptance of a circuit, per unit: `x / (r² + x²)`, the formula
/// the engine's DC model uses.
fn susceptance(design: &CircuitDesign) -> f64 {
    design.x_pu / (design.r_pu * design.r_pu + design.x_pu * design.x_pu)
}

/// Corridor susceptances (per unit, all circuits) and planning-case bus
/// angles for the given circuit counts and per-bus net injections (MW).
fn planning_angles(
    n: usize,
    designs: &[CircuitDesign],
    circuits: &[u32],
    injection_mw: &[f64],
    grounds: &[usize],
) -> (Vec<(usize, usize, f64)>, Vec<f64>) {
    let edges: Vec<(usize, usize, f64)> = designs
        .iter()
        .zip(circuits)
        .map(|(d, &k)| (d.from, d.to, susceptance(d) * k as f64))
        .collect();
    let p: Vec<f64> = injection_mw.iter().map(|v| v / BASE_MVA).collect();
    let theta = dc_angles(n, &edges, &p, grounds);
    (edges, theta)
}

/// Planned flow per corridor (MW, from `design.from` to `design.to`) for the
/// given circuit counts and per-bus net injections (MW).
fn corridor_flows(
    n: usize,
    designs: &[CircuitDesign],
    circuits: &[u32],
    injection_mw: &[f64],
    grounds: &[usize],
) -> Vec<f64> {
    let (edges, theta) = planning_angles(n, designs, circuits, injection_mw, grounds);
    edges
        .iter()
        .map(|&(a, b, w)| w * (theta[a] - theta[b]) * BASE_MVA)
        .collect()
}

/// Plan the circuits of every corridor for the economic dispatch at peak
/// load: promote the ends of corridors too heavy for their voltage class,
/// add circuits (or larger banks) until no circuit runs above the
/// utilisation target, stiffen islands whose angle spread is too wide, and
/// fill up to `branch_target` circuits where the planned flow is heaviest.
/// Returns the final circuit designs (one per corridor) and the plan.
pub fn plan_corridors(
    buses: &mut [DraftBus],
    levels: &[f64],
    corridors: &mut [Corridor],
    draws: &[CorridorDraw],
    generators: &[DraftGenerator],
    branch_target: usize,
) -> (Vec<CircuitDesign>, CorridorPlan) {
    let n = buses.len();
    // Electrical components of the corridor graph; each balances on its own.
    let mut uf = UnionFind::new(n);
    for c in corridors.iter() {
        uf.union(c.a, c.b);
    }
    let component: Vec<usize> = (0..n).map(|i| uf.find(i)).collect();
    let mut roots: Vec<usize> = component.clone();
    roots.sort_unstable();
    roots.dedup();
    let mut dispatch = vec![0.0; generators.len()];
    let mut grounds = Vec::with_capacity(roots.len());
    for &root in &roots {
        let members: Vec<usize> = (0..generators.len())
            .filter(|&k| component[generators[k].bus] == root)
            .collect();
        let demand: f64 = (0..n)
            .filter(|&i| component[i] == root)
            .map(|i| buses[i].load_mw)
            .sum();
        let units: Vec<(f64, f64, f64, f64)> = members
            .iter()
            .map(|&k| {
                let g = &generators[k];
                (g.pmin_mw, g.pmax_mw, g.c1, g.c2)
            })
            .collect();
        for (&k, pg) in members.iter().zip(economic_dispatch(&units, demand)) {
            dispatch[k] = pg;
        }
        // Ground on the component's reference generator when it has one.
        let ground = members
            .iter()
            .find(|&&k| generators[k].slack)
            .map(|&k| generators[k].bus)
            .unwrap_or(root);
        grounds.push(ground);
    }
    let mut injection: Vec<f64> = buses.iter().map(|b| -b.load_mw).collect();
    for (g, pg) in generators.iter().zip(&dispatch) {
        injection[g.bus] += pg;
    }
    let mut circuits: Vec<u32> = corridors.iter().map(|c| c.circuits.max(1)).collect();
    let initial: usize = circuits.iter().map(|&k| k as usize).sum();

    // 1. Voltage class by power and distance.
    let mut designs = design_circuits(buses, corridors, generators, draws);
    let mut promoted = 0usize;
    for _ in 1..levels.len() {
        let flows = corridor_flows(n, &designs, &circuits, &injection, &grounds);
        let mut raise: Vec<Option<usize>> = vec![None; n];
        for (k, c) in corridors.iter().enumerate() {
            let d = &designs[k];
            let line_capacity = PLANNING_UTILISATION * d.line_rate * d.rate_spread;
            if flows[k].abs() <= UPGRADE_CIRCUITS as f64 * line_capacity {
                continue;
            }
            let tier = buses[c.a].tier.min(buses[c.b].tier);
            if tier == 0 {
                continue;
            }
            for end in [c.a, c.b] {
                let to = raise[end].map_or(tier - 1, |t| t.min(tier - 1));
                raise[end] = Some(to);
            }
        }
        let mut changed = false;
        for (i, to) in raise.iter().enumerate() {
            let Some(to) = *to else { continue };
            if to < buses[i].tier {
                let bus = &mut buses[i];
                bus.tier = to;
                bus.base_kv = levels[to];
                bus.annotation = format!(
                    "{} (raised to {} kV: an incident corridor's planned flow needs more than {UPGRADE_CIRCUITS} circuits at the lower voltage)",
                    bus.annotation, bus.base_kv
                );
                promoted += 1;
                changed = true;
            }
        }
        if !changed {
            break;
        }
        for c in corridors.iter_mut() {
            c.kv = buses[c.a].base_kv.max(buses[c.b].base_kv);
        }
        designs = design_circuits(buses, corridors, generators, draws);
    }

    // 2. Capacity and stiffening, repeated until both hold: stiffening moves
    //    flow, so capacity is checked again after it.
    let buses_of: Vec<Vec<usize>> = roots
        .iter()
        .map(|&root| (0..n).filter(|&i| component[i] == root).collect())
        .collect();
    let mut upsized = vec![false; corridors.len()];
    let mut stiffening = 0usize;
    let mut rounds = 0;
    let mut converged = corridors.is_empty();
    while rounds < PLANNING_MAX_ROUNDS && !corridors.is_empty() {
        rounds += 1;
        let flows = corridor_flows(n, &designs, &circuits, &injection, &grounds);
        let mut added = false;
        let mut capped = false;
        for (c, d) in designs.iter_mut().enumerate() {
            // Rating the corridor needs so the planning flow stays at the
            // utilisation target.
            let required = flows[c].abs() / PLANNING_UTILISATION;
            if required <= circuits[c] as f64 * d.rate_a {
                continue;
            }
            if let Some(mva) = d.transformer_mva.filter(|&m| m < d.line_rate) {
                let per_circuit = required / circuits[c] as f64 / d.rate_spread;
                let next = ((per_circuit / TRANSFORMER_SIZE_STEP_MVA).ceil()
                    * TRANSFORMER_SIZE_STEP_MVA)
                    .min(d.line_rate);
                if next > mva {
                    d.set_transformer_mva(next);
                    upsized[c] = true;
                    added = true;
                    if required <= circuits[c] as f64 * d.rate_a {
                        continue;
                    }
                }
            }
            let need = (required / d.rate_a).ceil() as u32;
            capped |= need > MAX_CIRCUITS_PER_CORRIDOR;
            let need = need.min(MAX_CIRCUITS_PER_CORRIDOR);
            if need > circuits[c] {
                circuits[c] = need;
                added = true;
            }
        }
        if added {
            continue;
        }
        // Capacity holds; stiffen any island whose spread is too wide.
        let (edges, theta) = planning_angles(n, &designs, &circuits, &injection, &grounds);
        let mut spread_ok = true;
        let mut stiffened = false;
        for (ci, members) in buses_of.iter().enumerate() {
            let root = roots[ci];
            let lead = *members
                .iter()
                .max_by(|&&a, &&b| theta[a].partial_cmp(&theta[b]).unwrap().then(b.cmp(&a)))
                .expect("a component has a bus");
            let lag = *members
                .iter()
                .min_by(|&&a, &&b| theta[a].partial_cmp(&theta[b]).unwrap().then(a.cmp(&b)))
                .expect("a component has a bus");
            let excess = theta[lead] - theta[lag] - MAX_ANGLE_SPREAD_RAD;
            if excess <= 0.0 {
                continue;
            }
            spread_ok = false;
            // The spread is (e_lead - e_lag)ᵀ L⁻¹ p; one more circuit on
            // corridor k (Δb = its circuit susceptance) narrows it by about
            // Δb · Δθ_k · Δφ_k with φ = L⁻¹ (e_lead - e_lag).
            let mut unit = vec![0.0; n];
            unit[lead] = 1.0;
            unit[lag] = -1.0;
            let phi = dc_angles(n, &edges, &unit, &grounds);
            let mut gains: Vec<(f64, usize)> = corridors
                .iter()
                .enumerate()
                .filter(|(k, c)| component[c.a] == root && circuits[*k] < MAX_CIRCUITS_PER_CORRIDOR)
                .map(|(k, _)| {
                    let d = &designs[k];
                    let gain =
                        susceptance(d) * (theta[d.from] - theta[d.to]) * (phi[d.from] - phi[d.to]);
                    (gain, k)
                })
                .filter(|(gain, _)| *gain > 0.0)
                .collect();
            gains.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap().then(a.1.cmp(&b.1)));
            // Enough of the best corridors to cover the excess to first
            // order, never more than the batch share of the island.
            let in_component = corridors.iter().filter(|c| component[c.a] == root).count();
            let cap = ((STIFFENING_BATCH_SHARE * in_component as f64).ceil() as usize).max(1);
            let mut covered = 0.0;
            let batch = gains
                .iter()
                .take(cap)
                .take_while(|(gain, _)| {
                    let take = covered < excess;
                    covered += gain;
                    take
                })
                .count()
                .max(1);
            for &(_, k) in gains.iter().take(batch) {
                let d = &mut designs[k];
                if d.transformer_mva.is_some_and(|m| m < d.line_rate) {
                    let full = d.line_rate;
                    d.set_transformer_mva(full);
                    upsized[k] = true;
                } else {
                    circuits[k] += 1;
                    stiffening += 1;
                }
                stiffened = true;
            }
        }
        if stiffened {
            continue;
        }
        converged = spread_ok && !capped;
        break;
    }
    let mut flows = corridor_flows(n, &designs, &circuits, &injection, &grounds);
    let capacity_total: usize = circuits.iter().map(|&k| k as usize).sum::<usize>() - stiffening;

    // 3. Fill to the requested branch count, heaviest planned loading first.
    let mut filler = 0usize;
    if capacity_total + stiffening < branch_target && !corridors.is_empty() {
        let loading = |c: usize, k: u32| flows[c].abs() / (k as f64 * designs[c].rate_a);
        let mut order: Vec<usize> = (0..corridors.len()).collect();
        order.sort_by(|&i, &j| {
            loading(j, circuits[j])
                .partial_cmp(&loading(i, circuits[i]))
                .unwrap()
                .then(designs[j].kv.partial_cmp(&designs[i].kv).unwrap())
                .then(
                    designs[i]
                        .length_km
                        .partial_cmp(&designs[j].length_km)
                        .unwrap(),
                )
                .then(i.cmp(&j))
        });
        let mut total = capacity_total + stiffening;
        let mut cursor = 0usize;
        let mut idle = 0usize;
        while total < branch_target && idle < order.len() {
            let c = order[cursor % order.len()];
            cursor += 1;
            if circuits[c] >= MAX_CIRCUITS_PER_CORRIDOR {
                idle += 1;
                continue;
            }
            idle = 0;
            circuits[c] += 1;
            total += 1;
            filler += 1;
        }
        flows = corridor_flows(n, &designs, &circuits, &injection, &grounds);
    }

    let (_, theta) = planning_angles(n, &designs, &circuits, &injection, &grounds);
    let spread_max = buses_of
        .iter()
        .map(|members| {
            let hi = members
                .iter()
                .map(|&i| theta[i])
                .fold(f64::NEG_INFINITY, f64::max);
            let lo = members
                .iter()
                .map(|&i| theta[i])
                .fold(f64::INFINITY, f64::min);
            hi - lo
        })
        .fold(0.0, f64::max);
    let mut max_loading: f64 = 0.0;
    let mut overloaded = 0;
    for (c, d) in designs.iter().enumerate() {
        let l = flows[c].abs() / (circuits[c] as f64 * d.rate_a);
        max_loading = max_loading.max(l);
        if l > 1.0 + 1e-9 {
            overloaded += 1;
        }
    }
    for (corridor, &k) in corridors.iter_mut().zip(&circuits) {
        corridor.circuits = k;
    }
    let plan = CorridorPlan {
        circuits,
        dispatch,
        corridor_flow: flows,
        grounds,
        rounds,
        converged,
        promoted_buses: promoted,
        capacity_circuits: capacity_total - initial,
        upsized_transformers: upsized.iter().filter(|&&u| u).count(),
        stiffening_circuits: stiffening,
        angle_spread_deg: spread_max.to_degrees(),
        filler_circuits: filler,
        max_loading,
        overloaded_corridors: overloaded,
    };
    (designs, plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_equalises_incremental_cost_within_bounds() {
        // Two units, c1 = 10 and 20, c2 = 0.01: λ = 10 + 0.02 p1 = 20 + 0.02 p2.
        let units = [(0.0, 1000.0, 10.0, 0.01), (0.0, 1000.0, 20.0, 0.01)];
        let p = economic_dispatch(&units, 1000.0);
        assert!((p[0] + p[1] - 1000.0).abs() < 1e-6);
        assert!((p[0] - 750.0).abs() < 1e-6 && (p[1] - 250.0).abs() < 1e-6);
        // A bound holds the cheap unit; the other covers the rest.
        let units = [(0.0, 300.0, 10.0, 0.01), (0.0, 1000.0, 20.0, 0.01)];
        let p = economic_dispatch(&units, 1000.0);
        assert!((p[0] - 300.0).abs() < 1e-9 && (p[1] - 700.0).abs() < 1e-6);
        assert_eq!(economic_dispatch(&units, 5000.0), vec![300.0, 1000.0]);
    }

    #[test]
    fn dc_angles_solve_a_ring_exactly() {
        // Ring 0-1-2-3-0 with unit susceptances, 1 pu in at 0 and out at 2:
        // each path carries 0.5 pu, so θ1 = θ3 = -0.5 and θ2 = -1 from θ0 = 0.
        let edges = [(0, 1, 1.0), (1, 2, 1.0), (2, 3, 1.0), (3, 0, 1.0)];
        let theta = dc_angles(4, &edges, &[1.0, 0.0, -1.0, 0.0], &[0]);
        assert!((theta[1] + 0.5).abs() < 1e-9 && (theta[3] + 0.5).abs() < 1e-9);
        assert!((theta[2] + 1.0).abs() < 1e-9);
        // Two components, each grounded.
        let edges = [(0, 1, 2.0), (2, 3, 4.0)];
        let theta = dc_angles(4, &edges, &[0.0, -1.0, 0.0, -2.0], &[0, 2]);
        assert!((theta[1] + 0.5).abs() < 1e-9 && (theta[3] + 0.5).abs() < 1e-9);
    }
}
