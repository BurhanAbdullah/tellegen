//! A wider sweep than the seed matrix: four regions × ten seeds × three
//! densities, plus low fidelity on the first three seeds (156 runs). Every
//! run must give a converged corridor plan, an optimal DC OPF and an AC power
//! flow inside the emergency band. Ignored by default because it takes about
//! half a minute in release mode:
//!
//! ```sh
//! cargo test -p tellegen-synth --release --test robustness -- --ignored
//! ```

mod common;

use tellegen_synth::{generate, AcPfOutcome, Density, Fidelity, SolveOutcome};

#[test]
#[ignore = "about 30 s in release mode; run with --ignored"]
fn wide_sweep_plans_solve_and_converge() {
    let regions = vec![
        ("iraq", common::iraq_box()),
        ("rhine", common::rhine_box()),
        ("guinea", common::gulf_of_guinea_box()),
        ("islands", common::two_landmasses()),
    ];
    let mut fails = Vec::new();
    let mut total = 0;
    let mut worst_spread: f64 = 0.0;
    let mut ratio_max: f64 = 0.0;
    for (name, region) in &regions {
        for seed in 1u64..=10 {
            for density in [Density::Low, Density::Medium, Density::High] {
                for fidelity in [Fidelity::High, Fidelity::Low] {
                    if fidelity == Fidelity::Low && seed > 3 {
                        continue;
                    }
                    total += 1;
                    let mut req = common::request(region.clone(), seed, None);
                    req.density = density;
                    req.fidelity = fidelity;
                    let label = format!("{name} {seed} {density:?} {fidelity:?}");
                    let (_, r) = match generate(req, common::places(), None) {
                        Ok(x) => x,
                        Err(e) => {
                            fails.push(format!("{label}: error {e}"));
                            continue;
                        }
                    };
                    let plan = r.planning.as_ref().unwrap();
                    worst_spread = worst_spread.max(plan.angle_spread_deg);
                    ratio_max = ratio_max
                        .max(plan.branches as f64 / r.stats.as_ref().unwrap().n_buses as f64);
                    let dc = r.dc_opf.as_ref().unwrap();
                    let ac = r.ac_pf.as_ref().unwrap();
                    let bad_dc = dc.status != SolveOutcome::Optimal;
                    let bad_ac = ac.status != AcPfOutcome::Converged
                        || ac.vm_min.unwrap_or(0.0) < 0.9
                        || ac.vm_max.unwrap_or(9.0) > 1.1;
                    if bad_dc || bad_ac || !plan.converged {
                        fails.push(format!("{label}: dc {:?} ac {:?} vm [{:?},{:?}] plan conv {} spread {:.1} n {} br {}",
                            dc.status, ac.status, ac.vm_min, ac.vm_max, plan.converged, plan.angle_spread_deg, r.stats.as_ref().unwrap().n_buses, plan.branches));
                    }
                }
            }
        }
    }
    println!(
        "{total} runs, {} failures, widest planned spread {worst_spread:.1}°, highest branch/bus ratio {ratio_max:.2}",
        fails.len()
    );
    assert!(fails.is_empty(), "{}", fails.join("\n"));
}
