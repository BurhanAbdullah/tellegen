#!/usr/bin/env python3
"""Synthetic generation evidence through the native CLI.

  references  measure the reference cases staged in the repository with
              `tellegen stats` and write reference_stats.json
  run         generate every declared spec and seed with `tellegen generate`
              and write result.json: hashes, verdicts, and each structural
              statistic beside the reference and published ranges

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
    args = parser.parse_args()
    references(args) if args.command == 'references' else run(args)


if __name__ == '__main__':
    main()
