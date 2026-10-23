#!/usr/bin/env python3
"""Write the country-scale sweep specs from Natural Earth's admin-0 countries.

usage: python3 -I evidence/synth/regions.py NE_ADMIN0_GEOJSON [--out DIR]

NE_ADMIN0_GEOJSON is ne_50m_admin_0_countries.geojson of Natural Earth
v5.1.2 (public domain), SOURCE_URL below; its SHA-256 must be SOURCE_SHA256,
so the specs are the ones the committed results came from. It is third-party
input: it is parsed as JSON, only Polygon and MultiPolygon coordinates are
copied, and nothing in it is executed. Coordinates are rounded to 1e-4
degrees (about 11 m). Each spec runs the generator's default request on one
whole country, plus one bounding box around Texas. The specs are not
committed; this script regenerates them.
"""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE_URL = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/'
              'geojson/ne_50m_admin_0_countries.geojson')
SOURCE_SHA256 = '3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb'
COUNTRIES = ['PRT', 'ESP', 'DEU', 'FRA', 'GBR', 'USA', 'IND', 'CHN', 'RUS', 'BRA', 'JPN',
             'AUS', 'ZAF', 'NGA', 'EGY', 'CHL', 'IDN']
TEXAS_BOX = (-106.65, 25.84, -93.51, 36.50)


def rounded(coords):
    if isinstance(coords, list) and coords and isinstance(coords[0], (int, float)):
        return [round(float(coords[0]), 4), round(float(coords[1]), 4)]
    return [rounded(c) for c in coords]


def spec(spec_id, description, geometry, label):
    return {
        'id': spec_id,
        'description': description,
        'seeds': [1],
        'request': {'region': {'geometry': geometry, 'label': label}},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('geojson', type=Path)
    parser.add_argument('--out', type=Path, default=HERE / 'sweep')
    args = parser.parse_args()
    raw = args.geojson.read_bytes()
    source = hashlib.sha256(raw).hexdigest()
    if source != SOURCE_SHA256:
        raise SystemExit(f'{args.geojson} has sha256 {source}, expected {SOURCE_SHA256} ({SOURCE_URL})')
    features = json.loads(raw)['features']
    by_code = {}
    for feature in features:
        props = feature.get('properties') or {}
        code = props.get('ADM0_A3')
        geometry = feature.get('geometry') or {}
        if code in COUNTRIES and geometry.get('type') in ('Polygon', 'MultiPolygon'):
            by_code[code] = (props.get('NAME_EN') or props.get('NAME') or code, geometry)
    missing = [c for c in COUNTRIES if c not in by_code]
    if missing:
        raise SystemExit(f'not in the file: {missing}')
    args.out.mkdir(parents=True, exist_ok=True)
    for code in COUNTRIES:
        name, geometry = by_code[code]
        geometry = {'type': geometry['type'], 'coordinates': rounded(geometry['coordinates'])}
        text = json.dumps(spec(code.lower(), f'{name} ({code}), the whole country: Natural Earth '
                               f'1:50m admin-0 polygon (source sha256 {source}).',
                               geometry, name), separators=(',', ':'))
        (args.out / f'{code.lower()}.json').write_text(text + '\n')
    west, south, east, north = TEXAS_BOX
    box = {'type': 'Polygon', 'coordinates': [[[west, south], [east, south], [east, north],
                                               [west, north], [west, south]]]}
    text = json.dumps(spec('texas-box', 'A bounding box around Texas; it also takes in parts of '
                           'Mexico, New Mexico, Oklahoma and Louisiana.', box, 'Texas box'),
                      indent=2)
    (args.out / 'texas-box.json').write_text(text + '\n')
    print(f'wrote {len(COUNTRIES) + 1} specs to {args.out}')


if __name__ == '__main__':
    main()
