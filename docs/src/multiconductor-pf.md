# Multiconductor AC power flow

Tellegen solves prescribed-load AC power flow on PowerIO's `MulticonductorNetwork`. Frederik Geth contributed the fixed-point solver, winding models, and independent comparison fixtures in [PR 109](https://github.com/eigenergy/tellegen/pull/109).

Import a BMOPF JSON case or load the 4-conductor example from Studies. Run AC power flow, then inspect terminal voltages, conductor currents, and source powers. Results use volts, degrees, amperes, watts, and var. A declared neutral also allows phase-to-neutral voltage comparisons. This calculation does not optimize generation or calculate LMPs.

Geographic GeoJSON can accompany the case or be attached to the selected case later. Bus points use equipment identities; line routes can use `bus_from` and `bus_to`. Geographic positions appear on the map. Drawing positions appear on a plain canvas. Attaching geometry retains the electrical input and any current result.

## Supported calculations

The solver uses one complex sparse LU factorization and updates compensated load currents until both voltage changes and physical KCL residuals meet their tolerances. Constant-power, constant-current, constant-impedance, ZIP, and exponential loads are included, along with ideal voltage sources, lines, shunts, explicit neutral conductors, and supported winding equipment. Phase-to-phase single-phase transformers, a two-winding entry expressed using BMOPF's n-winding representation, and PowerIO's three-coupled-winding lowering of a BMOPF centre-tap transformer are supported.

Finite source impedance, active device controls, generator/IBR injections, unsupported load models, unsupported per-phase taps, ideal zero-leakage winding models, and arbitrary multiwinding transformers require additional numerical models. Such data can remain available for inspection, but the calculation reports unsupported physics instead of silently simplifying it. Draft BMOPF 0.2 data remains subject to Task Force review.

A current result belongs to the input that produced it. Cancelling or failing a new calculation retains the preceding result. Numeric columns exported to PowerIO are ordered by bus/terminal and source/terminal identities, with missing or duplicate identities rejected.

After an initial solve, select a bus to edit each attached load branch's active and reactive power. The browser coalesces rapid changes and automatically warm-solves from the last converged voltages. It retains the same sparse factorization because load power changes alter the nonlinear current injection, not the passive network operator. The physical impedance and voltage-envelope terms still follow the edited power; only the fixed-point compensation reference is frozen. Resetting a row removes its override, and saved results contain the edited input as well as its matching solution. An edit changes only the solver's load laws: the network is not copied, and each edit returns a small summary in one round trip. The Studies panel then fetches only the selected bus and one page of equipment results. The portable input, solution, and complete result are built only for save, export, geography attachment, or an explicit full rebuild. [Multiconductor PF performance](mc-pf-performance.md) states the latency target and payload budgets with measurements.

## Operating-point overview

Above the detailed results, the Studies panel summarises the displayed operating point: limit violations, losses, the voltage range for each declared voltage reference, the most heavily loaded branch, and the largest voltage unbalance. Selecting a tile selects its bus or branch on the map. Issues are ranked with violations first, then by how far they exceed their limit: voltages outside the case's declared phase-to-neutral or phase-to-phase limits, and branches at 90 % of their declared rating or more. A case that declares no limits or ratings shows no issues and says so; nothing is ranked against invented bounds.

For a selected bus, bars place each terminal-pair voltage within its declared band. Unbalance is the voltage unbalance factor |V2|/|V1| from terminal phasors, shown beside the phase-to-neutral magnitude spread; when the spread is much larger, the difference is neutral shift, which the unbalance factor excludes. For a selected branch, bars show the current in every conductor at both ends on one scale, with the neutral's share of the largest phase current. A voltage profile follows the path from the source to the selection, split at transformers and wherever the voltage reference changes. Behind it, a shaded band shows the range of all buses at the same depth and reference. The path is a breadth-first tree over closed branches, not a claim about a unique path through a meshed network, and its steps count branches, not length.

*Show schematic* replaces the map with a schematic of the case. Buses are laid out by branch steps from the sources, every leaf on its own row, with tree branches drawn as right-angled routes; branches that close a loop and open switches are drawn straight so they cannot be mistaken for the tree. *Geographic* (or *Source positions* for a drawing) shows the case's own positions instead, and switching between the two moves each bus from where it is on screen to its new place, keeping the selection; it switches instantly when the system asks for reduced motion. Colour by voltage within the declared band or by loading as a percentage of the rating; a faint underlay keeps the network visible where results are unremarkable. PNG and SVG exports of the visible view carry a title block with the case, layout, colouring, camera and solve.

Once a study is saved, the address bar records it with the selection and view (`?study=…&sel=bus:…&view=schematic`), and *Copy link* copies that address. The link reopens the study in a browser that holds it, saved there or imported from an export; it does not carry the data itself.

Search finds buses and branches by ID. The bus and branch tables sort, filter to issues, and follow the selection; arrow keys move it. CSV exports keep full precision and begin with the case and solve that produced them. Cases with more than 25,000 buses compute the overview when asked rather than after every load edit, because reading a full result of that size takes a noticeable fraction of a second ([evidence](https://github.com/eigenergy/tellegen/tree/main/evidence/diagram)).

Save a result in Studies to retain its input, solver options, terminal values, and PowerIO solution. Import/export moves the saved result between browsers. Reopening checks that its input and results agree without solving again. A geographic attachment updates both saved modules and retains all electrical values. These versioned multiconductor snapshots do not offer the balanced-network planning objectives or sensitivities.

Raw OpenDSS files remain available for inspection. The multiconductor calculation requires supported BMOPF data or a typed PowerIO AC power flow input with explicit source and device settings.

## Native and browser APIs

The native API accepts a typed `McAcPfInstance`:

```rust,ignore
let result = tellegen::solve_mc_ac_pf_instance(&instance, &tellegen::McPfOptions::default())?;
let portable = result.to_powerio_solution(&instance)?;
```

The command line accepts either PowerIO IR or BMOPF JSON:

```sh
tellegen solve-mc < case.pio.json
tellegen solve-mc-bmopf '{"max_iterations":200}' < case.bmopf.json
```

`tellegen describe` includes the options and result schemas.

The browser's distribution graph carries the case's declared limits when present: `DistGraphBus.voltage_limits` lists phase-to-neutral (`vpn_min`, `vpn_max`) or phase-to-phase (`vpp_min`, `vpp_max`) bounds in volts, and `DistGraphEdge.rating` gives per-conductor ampacity (`i_max`) or a transformer edge's smaller winding rating in volt-amperes (`s_rating`). The `McWorkbench` component in `@tellegen/svelte` renders the overview from a full `McPfResult` and the graph; `controller.multiFullResult(case)` supplies that result from a stored solve or the live session. The JSON result carries complex terminal voltages, currents, device powers, source reactions, iteration counts, and KCL residuals.

The browser package provides `solveMcModule(moduleJson, options, signal)` and `solveMcBmopf(text, options)`. The module operation runs in a separate worker so cancelling it leaves other calculations intact. Environments without workers check cancellation after synchronous execution and discard a cancelled result.

For interactive load changes, `createMcPfSession(moduleJson, options)` creates a `BrowserMcPfSession` in the shared engine worker; `initialSummary` describes its first solve. Its `replaceLoadPowers(edits)` method takes the complete absolute override set, warm-starts from the previous solution, reuses the prepared LU, and returns an `McPfSummary`: convergence, residuals, load voltage range and violation count, source power, passive loss, and counts. `lastTiming` records the edit's engine, transfer, and parse time, and `profile()` the engine's own phases. Detail is fetched on demand: `detail({ bus, element, port_offset, port_limit })` returns one bus's terminals and a page of equipment ports, `terminalIds()` with `terminalVoltages()` and `terminalCurrents()` return interleaved `Float64Array`s, and `result()` builds the complete `McPfResult`. `loadBranches()`, `inputModule()`, and `snapshot()` expose the editable identities and materialize the current solved state; `materializationCount()` confirms that ordinary edits build no edited network. `summarizeMcPfResult` and `mcPfResultDetail` give a stored result the same shapes. Native callers use `McPfSession` (`summary`, `detail`, `terminal_voltages`, `build_result`, `edited_instance`) and `McLoadPowerEdit`. A session must be rebuilt after structural changes such as topology, taps, source voltages, load connection maps, voltage-model parameters, or solver options.

`solveMcStudy`, `replayMcStudy`, and `applyMcStudyGeo` create, reopen, and update saved multiconductor results. Native callers use `McStudySnapshot` for the same operations.

An agent can use `inspect_case`, `solve_multiconductor_pf`, and `query_network`. A solve requires the case ID and displayed revision. Querying `voltage_v` ranks buses by their largest terminal-to-ground voltage; `terminal_values` lists the individual terminals. `price` remains unavailable for AC power flow.

## Evidence

The test suite includes analytic resistive feeders and comparisons against OpenDSS reference results for grounded, floating, and impedance-grounded neutrals, three-phase lines, delta loads, multiple winding connections, and a loaded split-phase centre-tap transformer. The centre-tap oracle checks voltage plus aggregated physical-terminal current orientation and complex power. The published tolerances distinguish voltage, current, and complex-power comparisons. These fixtures establish the supported calculations; they do not establish universal convergence or multiconductor AC OPF support.

Further tests exercise the real WASM worker, unsupported-data rejection through IR reload, geographic points and multi-point routes after attachment, and unchanged electrical results after geographic edits. Session tests check that edits reuse the factorization and build no edited network, that the summary equals the complete result it summarizes, and that portable output is byte-identical to the previous implementation. A generated ~10,000-bus regression runs in CI ([performance](mc-pf-performance.md)).
