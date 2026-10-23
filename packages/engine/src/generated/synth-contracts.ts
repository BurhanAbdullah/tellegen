// Generated from Rust by synth_contract and generate-synth-contracts.mjs.
// Source SHA256: 43fd558d54af084e60ae6110582e78449c7822ef07607d5ae273fc2dcbcf760c

export type AcPfOutcome = "converged" | "not_converged" | "skipped";

export type AcPfReport = { "buses_outside_emergency_band": number; "buses_outside_planning_band": number; "islands": Array<IslandOutcome>; "losses_mw"?: number | null; "message"?: string | null; "newton_iterations"?: number | null; "residual"?: number | null; "solve_ms"?: number | null; "status": AcPfOutcome; "vm_max"?: number | null; "vm_min"?: number | null; };

export type BBox = { "east": number; "north": number; "south": number; "west": number; };

export type BranchAnnotation = { "boundary_role": string; "circuits": number; "class_kv": number; "id": number; "is_hvdc": boolean; "is_transformer": boolean; "length_km": number; "osm_ids"?: Array<number>; "rating_basis": string; "source": ElementSource; "uid": string; };

export type BusAnnotation = { "base_kv": number; "confidence": number; "id": number; "island": number; "kind": BusKind; "name": string; "place"?: string | null; "population_weight": number; "source": ElementSource; "tier": number; "uid": string; };

export type BusKind = "load" | "substation" | "generator" | "converter";

export type CalibrationOptions = { "allow_load_scale"?: boolean; "enabled"?: boolean; "max_iterations"?: number; "targets"?: (CalibrationTargets) | (null); };

export type CalibrationParameters = { "branch_rating_notches": { [key: string]: number; }; "gen_capacity_scale": { "coal"?: number; "gas"?: number; "hydro"?: number; "nuclear"?: number; "other"?: number; "solar"?: number; "storage"?: number; "wind"?: number; }; "load_scale": number; "rating_scale": { [key: string]: number; }; };

export type CalibrationReport = { "final_objective": number; "initial_objective": number; "iterations": number; "parameters": CalibrationParameters; "status": CalibrationStatus; "steps": Array<CalibrationStep>; "targets": CalibrationTargets; "terms_final": { [key: string]: number; }; "terms_initial": { [key: string]: number; }; "weights": { [key: string]: number; }; };

export type CalibrationStatus = ("converged") | ("improved") | ("unchanged") | ("infeasible") | ("disabled");

export type CalibrationStep = { "accepted": boolean; "after": number; "before": number; "dc_status": SolveOutcome; "iteration": number; "objective_after": number; "objective_before": number; "parameter": string; "reason": string; };

export type CalibrationTargets = { "avg_degree": [number, number]; "binding_fraction": [number, number]; "hv_share": [number, number]; "loading_p90_min": number; "loading_target": number; "set_id": string; "source": string; };

export type CostCoefficients = { "c0": number; "c1": number; "c2": number; };

export type DcOpfReport = { "binding_branches": Array<string>; "binding_fraction": number; "branch_loading"?: { [key: string]: number; }; "dispatch_by_fuel_mw": { "coal"?: number; "gas"?: number; "hydro"?: number; "nuclear"?: number; "other"?: number; "solar"?: number; "storage"?: number; "wind"?: number; }; "hvdc_as_fixed_transfer": number; "islands": Array<IslandOutcome>; "iterations"?: number | null; "lmp"?: (LmpSummary) | (null); "loading_histogram": Array<number>; "loading_mean"?: number | null; "loading_p90"?: number | null; "max_loading"?: number | null; "message"?: string | null; "objective"?: number | null; "solve_ms"?: number | null; "status": SolveOutcome; "unserved_mw"?: number | null; };

export type DemandBasis = ("population") | ("total_mw") | ("default_per_bus");

export type DemandSpec = ({ "kind": "population"; "peak_factor"?: number; "per_capita_kw"?: number; }) | ({ "kind": "total_mw"; "mw": number; });

export type Density = "low" | "medium" | "high";

export type ElementAnnotations = { "branches": Array<BranchAnnotation>; "buses": Array<BusAnnotation>; "generators": Array<GeneratorAnnotation>; };

export type ElementSource = ("synthetic" | "osm") | ("makeup") | ("interconnect");

export type ErrorPayload = { "branches"?: number | null; "buses"?: number | null; "code": string; "message": string; };

export type FallbackFrom = { "branches"?: number | null; "buses"?: number | null; "message"?: string | null; "reason": FallbackReason; "source": Source; };

export type FallbackReason = "osm_insufficient" | "overpass_failed";

export type FarIslandPolicy = ("cut") | ("keep");

export type Fidelity = "low" | "high";

export type Fuel = "gas" | "coal" | "nuclear" | "hydro" | "wind" | "solar" | "storage" | "other";

export type GenerationReport = { "ac_pf"?: (AcPfReport) | (null); "calibration"?: (CalibrationReport) | (null); "context"?: (RegionContext) | (null); "dc_opf"?: (DcOpfReport) | (null); "elements"?: (ElementAnnotations) | (null); "planning"?: (PlanningReport) | (null); "provenance": Provenance; "request": SynthRequest; "schema": string; "stages": Array<StageRecord>; "stats"?: (TopologyStats) | (null); "warnings": Array<Warning>; };

export type GeneratorAnnotation = { "bus": number; "cost": CostCoefficients; "fuel": Fuel; "makeup": boolean; "pmax_mw": number; "slack": boolean; "uid": string; };

export type IslandOptions = { "beyond"?: FarIslandPolicy; "max_interconnect_km"?: number; };

export type IslandOutcome = { "branches": number; "buses": number; "generators": number; "index": number; "load_mw": number; "message"?: string | null; "status": string; };

export type Limits = { "max_area_km2"?: number; "max_branch_factor"?: number; "max_bus_count"?: number; };

export type LmpSummary = { "max": number; "mean": number; "min": number; "spread": number; };

export type OsmIslands = ("connect") | ("cut") | ("keep");

export type OsmOptions = { "clip_buffer_km"?: number; "cluster_radius_m"?: number; "hvdc_snap_km"?: number; "islands"?: OsmIslands; "min_branches"?: number; "min_buses"?: number; "plant_snap_km"?: number; "snap_km"?: number; "voltage_floor_kv"?: number; };

export type OsmProvenance = { "counts": { [key: string]: number; }; "document_sha256": string; "elements": number; "generator": string; "timestamp_osm_base"?: string | null; };

export type PlacesProvenance = { "count": number; "sha256": string; };

export type PlanningReport = { "angle_spread_deg": number; "branch_target": number; "branches": number; "capacitor_banks": number; "capacitor_mvar": number; "capacity_circuits": number; "converged": boolean; "dispatch": string; "filler_circuits": number; "max_angle_difference_deg": number; "max_planning_loading": number; "overloaded_corridors": number; "promoted_buses": number; "reactor_banks": number; "reactor_mvar": number; "rounds": number; "stiffening_circuits": number; "upsized_transformers": number; "utilisation_target": number; };

export type Preview = { "branches": Array<PreviewBranch>; "buses": Array<PreviewBus>; "stage": Stage; };

export type PreviewBranch = { "base_kv": number; "from": number; "route": Array<[number, number]>; "to": number; };

export type PreviewBus = { "base_kv": number; "id": number; "kind": BusKind; "lat": number; "lon": number; };

export type Provenance = { "fallback_from"?: (FallbackFrom) | (null); "generator": string; "osm"?: (OsmProvenance) | (null); "parameter_table_version": string; "places"?: (PlacesProvenance) | (null); "powerio_version": string; "request_sha256": string; "seed": number; "spread_sigma": number; "tellegen_synth_version": string; "tellegen_version": string; };

export type Quantiles = { "max": number; "mean": number; "min": number; "p10": number; "p50": number; "p90": number; };

export type ReferenceComparison = { "metric": string; "reference_range": [number, number]; "value": number; "within": boolean; };

export type Region = { "geometry": unknown; "label"?: string; };

export type RegionContext = { "area_km2": number; "branch_factor": number; "center_lat": number; "center_lon": number; "crosses_antimeridian": boolean; "demand_basis": DemandBasis; "frame": BBox; "fuel_mix": { "coal"?: number; "gas"?: number; "hydro"?: number; "nuclear"?: number; "other"?: number; "solar"?: number; "storage"?: number; "wind"?: number; }; "label": string; "landmasses": number; "peak_demand_mw": number; "places_in_region": number; "population_in_region": number; "target_bus_count": number; "voltage_classes_kv": Array<number>; "voltage_levels_kv": Array<number>; };

export type SolveOutcome = "optimal" | "infeasible" | "skipped";

export type Source = ("synthetic") | ("osm");

export type Stage = "context" | "site_buses" | "topology" | "electrify" | "dc_opf" | "calibrate" | "ac_pf" | "finalize" | "done";

export type StageRecord = { "counts": { [key: string]: number; }; "elapsed_ms"?: number | null; "iteration"?: number | null; "stage": Stage; };

export type StepOutcome = { "done": boolean; "elapsed_ms"?: number | null; "iteration"?: number | null; "next"?: (Stage) | (null); "preview_changed": boolean; "progress": number; "stage": Stage; "warnings": Array<Warning>; };

export type SynthRequest = { "branch_factor"?: number | null; "calibration"?: CalibrationOptions; "demand"?: DemandSpec; "density"?: Density; "fallback_from"?: (FallbackFrom) | (null); "fidelity"?: Fidelity; "fuel_mix"?: { "coal"?: number; "gas"?: number; "hydro"?: number; "nuclear"?: number; "other"?: number; "solar"?: number; "storage"?: number; "wind"?: number; }; "generator_count"?: number | null; "islands"?: IslandOptions; "limits"?: Limits; "osm"?: (OsmOptions) | (null); "power_factor"?: number; "region": Region; "reserve_margin"?: number; "seed"?: number; "source"?: Source; "target_bus_count"?: number | null; "validation"?: ValidationOptions; "voltage_levels_kv"?: Array<number>; };

export type TopologyStats = { "algebraic_connectivity"?: number | null; "algebraic_connectivity_converged"?: boolean | null; "avg_degree": number; "branch_bus_ratio": number; "clustering_coefficient": number; "connected_components": number; "degree_histogram": Array<number>; "delaunay_edge_fraction": number; "gen_load_margin": number; "hv_share": number; "line_length_km": Quantiles; "max_degree": number; "max_line_loading"?: number | null; "mst_length_ratio": number; "n_branches": number; "n_buses": number; "n_generators": number; "n_hvdc": number; "n_loads": number; "n_transformers": number; "parallel_branches": number; "parallel_corridors": number; "reference"?: Array<ReferenceComparison>; "total_generation_capacity_mw": number; "total_line_length_km": number; "total_load_mw": number; "voltage_counts": { [key: string]: number; }; };

export type ValidationOptions = { "emergency_band"?: [number, number]; "run_ac_pf"?: boolean; "run_dc_opf"?: boolean; "voltage_band"?: [number, number]; };

export type Warning = { "code": string; "message": string; };
