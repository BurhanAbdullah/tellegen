#!/usr/bin/env python3
"""Synthetic generation evidence through the native CLI.

  references  measure the reference cases staged in the repository with
              `tellegen stats` and write reference_stats.json
  run         generate every declared spec and seed with `tellegen generate`
              and write result.json: hashes, verdicts, and each structural
              statistic beside the reference and published ranges
  sweep       generate each country-scale spec (written by regions.py) once
              and write sweep.json and sweep.md: peak demand against the
              official peak of peak_references.json, branches per bus,
              parallel circuits, the DC OPF and AC power flow verdicts and
              the engine time

Nothing here vendors third-party data: the reference cases are the PGLib-OPF
fixtures already in the repository, plus any case the operator staged with
scripts/stage-data.sh and names with --case.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
REFERENCES = HERE / 'reference_stats.json'
PEAK_REFERENCES = HERE / 'peak_references.json'
DEFAULT_CASES = [
    ROOT / 'crates/tellegen-server/fixtures/pglib/pglib_opf_case200_activ.m',
    ROOT / 'crates/tellegen-server/fixtures/pglib/pglib_opf_case500_goc.m',
]
# Statistics compared with the reference cases, and the published ranges
# (Birchfield et al., IEEE TPWRS 32(4), 2017) where the generator's
# calibration targets state one.
METRICS = ['avg_degree', 'max_degree', 'clustering_coefficient', 'branch_bus_ratio',
           'hv_share', 'gen_load_margin', 'algebraic_connectivity']


def digest(path):
    return 'sha256:' + hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tellegen(binary, *args):
    result = subprocess.run([str(binary), *args], text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return json.loads(result.stdout)


def references(args):
    cases = args.case or DEFAULT_CASES
    out = {
        'schema': 'tellegen.synth-reference-stats/1',
        'command': 'tellegen stats --case PATH',
        'note': 'MATPOWER cases carry no coordinates, so the length based statistics '
                '(line lengths, minimum spanning tree ratio, Delaunay fraction) are '
                'zero for them and are not compared.',
        'published': {
            'set_id': 'birchfield-2017-published',
            'source': 'Birchfield et al., IEEE TPWRS 32(4) 2017, Table II',
            'avg_degree': [2.2, 3.0],
            'hv_share': [0.08, 0.35],
        },
        'cases': [],
    }
    for case in cases:
        case = Path(case).resolve()
        stats = tellegen(args.tellegen, 'stats', '--case', str(case))
        stats.pop('reference', None)
        try:
            shown = str(case.relative_to(ROOT))
        except ValueError:
            shown = case.name
        out['cases'].append({'id': case.stem, 'source': shown,
                             'source_sha256': digest(case), 'stats': stats})
    args.output.write_text(json.dumps(out, indent=2) + '\n')
    print(f'wrote {args.output} ({len(cases)} case(s))')


def ranges(reference):
    out = {}
    for metric in METRICS:
        values = [c['stats'].get(metric) for c in reference['cases']]
        values = [v for v in values if isinstance(v, (int, float))]
        if values:
            out[metric] = [min(values), max(values)]
    return out


def compare(stats, reference_ranges, published):
    rows = []
    for metric in METRICS:
        value = stats.get(metric)
        if not isinstance(value, (int, float)):
            continue
        row = {'metric': metric, 'value': value}
        if metric in reference_ranges:
            lo, hi = reference_ranges[metric]
            row['reference_range'] = [lo, hi]
            row['within_reference'] = lo <= value <= hi
        if metric in published:
            lo, hi = published[metric]
            row['published_range'] = [lo, hi]
            row['within_published'] = lo <= value <= hi
        rows.append(row)
    return rows


def run(args):
    args.output.mkdir(parents=True, exist_ok=False)
    reference = json.loads(args.references.read_text())
    reference_ranges = ranges(reference)
    published = {k: v for k, v in reference['published'].items() if isinstance(v, list)}
    packet = {
        'schema': 'tellegen.synth-evidence/1',
        'tellegen_sha256': digest(args.tellegen),
        'references_sha256': digest(args.references),
        'places_sha256': digest(args.places) if args.places else 'embedded',
        'specs': {},
        'runs': [],
    }
    for spec_path in args.spec:
        spec = json.loads(spec_path.read_text())
        packet['specs'][spec['id']] = digest(spec_path)
        for seed in spec['seeds']:
            directory = args.output / f"{spec['id']}-s{seed}"
            directory.mkdir()
            request = dict(spec['request'], seed=seed)
            request_path = directory / 'request.json'
            request_path.write_text(json.dumps(request, indent=2) + '\n')
            command = ['generate', '--request', str(request_path), '--out', str(directory),
                       '--export', 'matpower', '--gridfm']
            if args.places:
                command += ['--places', str(args.places)]
            tellegen(args.tellegen, *command)
            report = json.loads((directory / 'report.json').read_text())
            dc, ac, plan = report['dc_opf'], report['ac_pf'], report['planning']
            stats = report['stats']
            entry = {
                'spec': spec['id'], 'seed': seed,
                'request_sha256': report['provenance']['request_sha256'],
                'places_sha256': report['provenance']['places']['sha256'],
                'buses': stats['n_buses'], 'branches': stats['n_branches'],
                'peak_demand_mw': report['context']['peak_demand_mw'],
                'dc_opf': {k: dc.get(k) for k in ('status', 'objective', 'max_loading', 'binding_fraction', 'message')},
                'ac_pf': {k: ac.get(k) for k in ('status', 'vm_min', 'vm_max', 'losses_mw', 'buses_outside_planning_band', 'message')},
                'calibration': report['calibration']['status'],
                'planning': {k: plan.get(k) for k in ('converged', 'rounds', 'branch_target', 'branches',
                                                      'capacity_circuits', 'stiffening_circuits', 'promoted_buses',
                                                      'angle_spread_deg', 'capacitor_mvar', 'reactor_mvar')},
                'warnings': [w['code'] for w in report['warnings']],
                'comparison': compare(stats, reference_ranges, published),
            }
            entry['valid'] = (dc['status'] == 'optimal' and ac['status'] == 'converged'
                              and 0.9 <= ac['vm_min'] and ac['vm_max'] <= 1.1)
            packet['runs'].append(entry)
            print(f"{spec['id']} seed {seed}: {stats['n_buses']} buses, DC {dc['status']}, "
                  f"AC {ac['status']}, plan converged {plan['converged']}")
    packet['all_valid'] = all(r['valid'] for r in packet['runs'])
    (args.output / 'result.json').write_text(json.dumps(packet, indent=2) + '\n')
    print(f"{sum(r['valid'] for r in packet['runs'])}/{len(packet['runs'])} runs valid; "
          f"wrote {args.output / 'result.json'}")


def peak_verdict(peak, reference, tolerance):
    """The modelled peak against an official one: the ratio, and a verdict
    only where the scopes match."""
    if reference is None:
        return None, 'no reference'
    ratio = peak / reference['reference_mw']
    if reference['comparable'] == 'no':
        return ratio, 'not comparable'
    if reference['comparable'] == 'flag':
        return ratio, 'flagged'
    return ratio, 'within' if abs(ratio - 1.0) <= tolerance else 'outside'


def sweep_row(spec, report, references, tolerance):
    context, plan, stats = report['context'], report['planning'], report['stats']
    dc, ac = report.get('dc_opf') or {}, report.get('ac_pf') or {}
    stages = {}
    for record in report.get('stages', []):
        if record.get('elapsed_ms') is not None:
            stages[record['stage']] = stages.get(record['stage'], 0.0) + record['elapsed_ms']
    reference = references.get(spec['id'])
    ratio, verdict = peak_verdict(context['peak_demand_mw'], reference, tolerance)
    generation_ms = sum(v for k, v in stages.items() if k in ('context', 'site_buses', 'topology', 'electrify'))
    return {
        'region': spec['id'],
        'label': spec['request']['region'].get('label'),
        'request_sha256': report['provenance']['request_sha256'],
        'buses': stats['n_buses'],
        'branches': stats['n_branches'],
        'branch_bus_ratio': stats['n_branches'] / max(stats['n_buses'], 1),
        'max_parallel_circuits': plan.get('max_parallel_circuits'),
        'capped_corridors': plan.get('capped_corridors'),
        'added_level_kv': plan.get('added_level_kv'),
        'plan_converged': plan.get('converged'),
        'angle_spread_deg': plan.get('angle_spread_deg'),
        'max_angle_difference_deg': plan.get('max_angle_difference_deg'),
        'peak_mw': context['peak_demand_mw'],
        'demand_basis': context['demand_basis'],
        'places_in_region': context['places_in_region'],
        'places_snapped': context.get('places_snapped'),
        'landmasses': context['landmasses'],
        'reference': reference,
        'peak_ratio': ratio,
        'peak_verdict': verdict,
        'dc_opf': dc.get('status'),
        'dc_message': dc.get('message'),
        'ac_pf': ac.get('status'),
        'ac_message': ac.get('message'),
        'vm': [ac.get('vm_min'), ac.get('vm_max')],
        'valid': (dc.get('status') == 'optimal' and ac.get('status') == 'converged'
                  and ac.get('vm_min') is not None and 0.9 <= ac['vm_min'] and ac['vm_max'] <= 1.1),
        'engine_ms': sum(stages.values()),
        'generation_ms': generation_ms,
        'stage_ms': stages,
        'warnings': [w['code'] for w in report['warnings']],
    }


def sweep_markdown(packet):
    def vm(r):
        lo, hi = r['vm']
        return f'{lo:.3f}–{hi:.3f}' if lo is not None else ''

    summary = packet['summary']
    lines = [
        f"{summary['valid']} of {summary['regions']} regions valid (DC OPF optimal and AC power flow "
        f"converged inside 0.9–1.1 pu); DC OPF optimal {summary['dc_optimal']}, AC power flow "
        f"converged {summary['ac_converged']}; peak within ±{packet['tolerance']:.0%} of the reference "
        f"for {summary['peak_within']} of the {summary['peak_scored']} regions whose reference scope matches.",
        '',
        '| Region | Buses | Peak MW | Reference MW (year) | Ratio | Peak verdict | Branch/bus | Max circuits | DC OPF | AC PF | Vm pu | Engine ms |',
        '| --- | ---: | ---: | --- | ---: | --- | ---: | ---: | --- | --- | --- | ---: |',
    ]
    for r in packet['rows']:
        ref = r['reference']
        shown = f"{ref['reference_mw']:,.0f} ({ref['year']})" if ref else ''
        ratio = f"{r['peak_ratio']:.2f}" if r['peak_ratio'] is not None else ''
        lines.append(
            f"| {r['region'].upper()} | {r['buses']} | {r['peak_mw']:,.0f} | {shown} | {ratio} | "
            f"{r['peak_verdict']} | {r['branch_bus_ratio']:.2f} | {r['max_parallel_circuits']} | "
            f"{r['dc_opf']} | {r['ac_pf']} | {vm(r)} | {r['engine_ms']:,.0f} |")
    lines += ['', '| Region | Reference scope | Source |', '| --- | --- | --- |']
    for r in packet['rows']:
        ref = r['reference']
        if ref:
            urls = ' '.join(f'<{u}>' for u in ref['urls'])
            lines.append(f"| {r['region'].upper()} | {ref['scope']}. Model: {ref['model_scope']}. | {ref['source']}: {urls} |")
    return '\n'.join(lines) + '\n'


def sweep(args):
    args.output.mkdir(parents=True, exist_ok=False)
    table = json.loads(args.references.read_text())
    references, tolerance = table['regions'], table['tolerance']
    packet = {
        'schema': 'tellegen.synth-sweep/1',
        'tellegen_sha256': digest(args.tellegen),
        'peak_references_sha256': digest(args.references),
        'seed': args.seed,
        'tolerance': tolerance,
        'specs': {},
        'rows': [],
    }
    for spec_path in args.spec:
        spec = json.loads(spec_path.read_text())
        packet['specs'][spec['id']] = digest(spec_path)
        directory = args.output / spec['id']
        directory.mkdir()
        request = dict(spec['request'], seed=args.seed)
        request_path = directory / 'request.json'
        request_path.write_text(json.dumps(request) + '\n')
        result = subprocess.run([str(args.tellegen), 'generate', '--request', str(request_path),
                                 '--out', str(directory)], text=True, capture_output=True, check=False)
        if result.stderr.strip():
            (directory / 'stderr.txt').write_text(result.stderr)
        if result.returncode:
            raise RuntimeError(f"{spec['id']}: {result.stderr.strip() or result.stdout.strip()}")
        report = json.loads((directory / 'report.json').read_text())
        row = sweep_row(spec, report, references, tolerance)
        packet['rows'].append(row)
        print(f"{spec['id']}: {row['buses']} buses, peak {row['peak_mw']:,.0f} MW "
              f"({row['peak_verdict']}), branch/bus {row['branch_bus_ratio']:.2f}, "
              f"circuits {row['max_parallel_circuits']}, DC {row['dc_opf']}, AC {row['ac_pf']}, "
              f"{row['engine_ms']:,.0f} ms", flush=True)
        if not args.keep:
            for name in ('network.pio.json', 'network.geo.json'):
                (directory / name).unlink(missing_ok=True)
    rows = packet['rows']
    packet['summary'] = {
        'regions': len(rows),
        'valid': sum(r['valid'] for r in rows),
        'dc_optimal': sum(r['dc_opf'] == 'optimal' for r in rows),
        'ac_converged': sum(r['ac_pf'] == 'converged' for r in rows),
        'peak_within': sum(r['peak_verdict'] == 'within' for r in rows),
        'peak_scored': sum(r['peak_verdict'] in ('within', 'outside') for r in rows),
    }
    (args.output / 'sweep.json').write_text(json.dumps(packet, indent=2) + '\n')
    (args.output / 'sweep.md').write_text(sweep_markdown(packet))
    print(json.dumps(packet['summary']))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    ref = sub.add_parser('references', help='measure the staged reference cases')
    ref.add_argument('--tellegen', type=Path, required=True)
    ref.add_argument('--case', type=Path, action='append', help='a case file; repeat for several')
    ref.add_argument('--output', type=Path, default=REFERENCES)
    gen = sub.add_parser('run', help='generate the declared specs and compare')
    gen.add_argument('spec', type=Path, nargs='+')
    gen.add_argument('--tellegen', type=Path, required=True)
    gen.add_argument('--output', type=Path, required=True)
    gen.add_argument('--places', type=Path, help='a places table instead of the bundled one')
    gen.add_argument('--references', type=Path, default=REFERENCES)
    sw = sub.add_parser('sweep', help='generate the country-scale specs and compare peaks')
    sw.add_argument('spec', type=Path, nargs='+')
    sw.add_argument('--tellegen', type=Path, required=True)
    sw.add_argument('--output', type=Path, required=True)
    sw.add_argument('--seed', type=int, default=1)
    sw.add_argument('--references', type=Path, default=PEAK_REFERENCES)
    sw.add_argument('--keep', action='store_true', help='keep the network files of every region')
    args = parser.parse_args()
    {'references': references, 'run': run, 'sweep': sweep}[args.command](args)


if __name__ == '__main__':
    main()
