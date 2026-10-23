mod common;

use tellegen_synth::electrical::params::{class_ratio, MAX_ANGLE_SPREAD_RAD, PLANNING_UTILISATION};
use tellegen_synth::{generate, DemandSpec};

/// Demand in line with the ACTIVSg2000 case (67 GW on 2000 buses, about
/// 33 MW per bus), so the structure test measures the topology rather than
/// the circuits the corridor plan adds for a heavily aggregated region.
fn activsg_like_demand(n: u32) -> DemandSpec {
    DemandSpec::TotalMw {
        mw: 33.0 * n as f64,
    }
}

#[test]
fn structure_matches_reference_ranges_across_sizes() {
    for &n in &[30u32, 100, 300] {
        let mut req = common::request(common::iraq_box(), 2026, Some(n));
        req.voltage_levels_kv = vec![500.0, 230.0, 115.0];
        req.demand = activsg_like_demand(n);
        req.validation.run_ac_pf = false;
        req.validation.run_dc_opf = false;
        let (_, report) = generate(req, common::places(), None).expect("generate");
        let plan = report.planning.as_ref().unwrap();
        let stats = report.stats.as_ref().unwrap();
        // The branch factor is met exactly unless the corridor plan needed
        // more for capacity or for the angle spread, and then it says so.
        if plan.branches > plan.branch_target {
            assert!(report
                .warnings
                .iter()
                .any(|w| w.code == "branch_target_exceeded"));
            assert_eq!(plan.filler_circuits, 0);
            assert!(
                plan.capacity_circuits + plan.stiffening_circuits > 0,
                "n={n} {plan:?}"
            );
        } else {
            assert_eq!(plan.branches, plan.branch_target, "n={n} {plan:?}");
            assert!(
                (1.4..=1.5).contains(&stats.branch_bus_ratio),
                "n={n} {}",
                stats.branch_bus_ratio
            );
        }
        assert_eq!(stats.connected_components, 1, "n={n}");
        assert!(stats.algebraic_connectivity.unwrap() > 0.0, "n={n}");
        assert!(
            (2.2..=3.0).contains(&stats.avg_degree),
            "n={n} avg degree {}",
            stats.avg_degree
        );
        assert!(stats.max_degree <= 8, "n={n}");
        assert!(
            stats.delaunay_edge_fraction > 0.9,
            "n={n} {}",
            stats.delaunay_edge_fraction
        );
        assert!(stats.mst_length_ratio >= 1.0, "n={n}");
        assert!(
            stats.hv_share > 0.05 && stats.hv_share < 0.2,
            "n={n} {}",
            stats.hv_share
        );
        assert!(
            stats.reference.iter().all(|r| r.within),
            "n={n} {:?}",
            stats.reference
        );
        assert_eq!(
            stats.degree_histogram.iter().sum::<u32>() as usize,
            n as usize
        );
    }
}

#[test]
fn heavy_demand_adds_circuits_keeps_ratings_physical_and_says_so() {
    // The Iraq box's population on 30 buses: over 1 GW per bus.
    let mut req = common::request(common::iraq_box(), 2026, Some(30));
    req.validation.run_ac_pf = false;
    req.validation.run_dc_opf = false;
    let (module, report) = generate(req, common::places(), None).unwrap();
    let net = module.value();
    let plan = report.planning.as_ref().unwrap();
    assert_eq!(plan.branches, net.branches().len());
    assert!(plan.branches > plan.branch_target, "{plan:?}");
    assert!(report
        .warnings
        .iter()
        .any(|w| w.code == "branch_target_exceeded"));
    assert!(plan.capacity_circuits + plan.stiffening_circuits > 0);
    assert!(plan.converged, "{plan:?}");
    assert!(plan.max_planning_loading <= PLANNING_UTILISATION + 1e-9);
    assert!(plan.angle_spread_deg <= MAX_ANGLE_SPREAD_RAD.to_degrees() + 1e-9);
    for br in net.branches() {
        let e = &br.extras["maptogrid"];
        let (class, ratio) = class_ratio(e["nominal_kv"].as_f64().unwrap());
        match e["rating_basis"].as_str().unwrap() {
            "thermal" | "loadability" => assert!(br.rate_a <= class.thermal_mva * ratio + 1e-9),
            "transformer" => assert!(br.rate_a <= e["transformer_mva"].as_f64().unwrap() + 1e-9),
            other => panic!("unexpected rating basis {other}"),
        }
    }
}

#[test]
fn city_anchoring_and_parallel_circuits() {
    let mut req = common::request(common::iraq_box(), 2026, None);
    req.validation.run_ac_pf = false;
    req.validation.run_dc_opf = false;
    let (module, report) = generate(req, common::places(), None).unwrap();
    let net = module.value();
    assert!(net
        .buses()
        .iter()
        .any(|b| b.name.as_deref() == Some("Baghdad")));
    assert_eq!(net.buses()[0].name.as_deref(), Some("Baghdad"));
    let elements = report.elements.as_ref().unwrap();
    assert!(elements.buses.iter().filter(|b| b.place.is_some()).count() > 5);
    let referenced: std::collections::HashSet<_> =
        net.branches().iter().flat_map(|b| [b.from, b.to]).collect();
    assert_eq!(referenced.len(), net.buses().len());
    assert_eq!(
        report.context.as_ref().unwrap().target_bus_count as usize,
        net.buses().len()
    );
}

#[test]
fn two_landmasses_within_reach_form_one_island() {
    let mut req = common::request(common::two_landmasses(), 4, Some(60));
    req.validation.run_ac_pf = false;
    let (module, report) = generate(req, common::places(), None).unwrap();
    let stats = report.stats.as_ref().unwrap();
    assert_eq!(stats.connected_components, 1);
    let roles = &report.elements.as_ref().unwrap().branches;
    assert!(roles.iter().any(|b| b.boundary_role == "interconnect"));
    assert_eq!(
        module
            .value()
            .buses()
            .iter()
            .filter(|b| b.kind == powerio::BusType::Ref)
            .count(),
        1
    );
    assert_eq!(
        report.dc_opf.as_ref().unwrap().status,
        tellegen_synth::SolveOutcome::Optimal
    );
}

#[test]
fn far_islands_kept_are_validated_separately() {
    let geom = serde_json::json!({"type": "MultiPolygon", "coordinates": [
        [[[42.0, 31.0], [46.0, 31.0], [46.0, 35.0], [42.0, 35.0], [42.0, 31.0]]],
        [[[-2.0, 5.0], [1.0, 5.0], [1.0, 8.0], [-2.0, 8.0], [-2.0, 5.0]]]
    ]});
    let mut req = common::request(
        tellegen_synth::Region {
            geometry: geom,
            label: "far".into(),
        },
        4,
        Some(60),
    );
    req.islands.beyond = tellegen_synth::FarIslandPolicy::Keep;
    req.validation.run_ac_pf = false;
    let (module, report) = generate(req, common::places(), None).unwrap();
    let stats = report.stats.as_ref().unwrap();
    assert_eq!(stats.connected_components, 2);
    assert_eq!(
        module
            .value()
            .buses()
            .iter()
            .filter(|b| b.kind == powerio::BusType::Ref)
            .count(),
        2
    );
    let dc = report.dc_opf.as_ref().unwrap();
    assert_eq!(dc.islands.len(), 2);
    assert_eq!(
        dc.status,
        tellegen_synth::SolveOutcome::Optimal,
        "{:?}",
        dc.message
    );
    assert!(report.warnings.iter().any(|w| w.code == "multiple_islands"));

    let mut req = common::request(
        tellegen_synth::Region {
            geometry: serde_json::json!({"type": "MultiPolygon", "coordinates": [
                [[[42.0, 31.0], [46.0, 31.0], [46.0, 35.0], [42.0, 35.0], [42.0, 31.0]]],
                [[[-2.0, 5.0], [1.0, 5.0], [1.0, 8.0], [-2.0, 8.0], [-2.0, 5.0]]]
            ]}),
            label: "cut".into(),
        },
        4,
        Some(60),
    );
    req.validation.run_ac_pf = false;
    req.validation.run_dc_opf = false;
    let (module, report) = generate(req, common::places(), None).unwrap();
    assert_eq!(report.stats.as_ref().unwrap().connected_components, 1);
    assert!(report.warnings.iter().any(|w| w.code == "islands_cut"));
    assert!(module
        .value()
        .buses()
        .iter()
        .all(|b| b.location.unwrap().x > 40.0));
}
