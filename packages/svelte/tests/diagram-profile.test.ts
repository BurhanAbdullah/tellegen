import { describe, expect, it } from 'vitest';
import type { DistGraph } from '@tellegen/engine';
import {
	displayTree,
	leafOrderLayout,
	sourceLayout,
	treePath,
	voltageProfile,
	MAX_PROFILE_POINTS,
	type PairVoltage,
	type ResultSnapshot
} from '../src/lib/diagram/index.js';

const bus = (id: string, source = false) => ({
	id,
	terminals: ['1', '2', '3', 'n'],
	grounded: [],
	load_kw: 0,
	gen_kw: 0,
	has_source: source
});
const edge = (
	id: string,
	from: string,
	to: string,
	kind: 'line' | 'switch' | 'transformer' = 'line',
	closed = true
) => ({
	kind,
	id,
	from,
	to,
	conductors: [] as [string, string][],
	closed,
	n_phases: 3
});
// MV source S → M → transformer → L1 → L2; an open switch to X; island Y.
const graph: DistGraph = {
	buses: [bus('S', true), bus('M'), bus('L1'), bus('L2'), bus('X'), bus('Y')],
	edges: [
		edge('e1', 'S', 'M'),
		edge('t1', 'M', 'L1', 'transformer'),
		edge('e2', 'l1', 'L2'),
		edge('sw', 'L2', 'X', 'switch', false)
	]
};
const pp = (v: number): PairVoltage => ({ pair: ['1', '2'], volts: v, min: 19000, max: 21000 });
const pn = (v: number): PairVoltage => ({ pair: ['1', 'n'], volts: v, min: 207, max: 253 });
const result: ResultSnapshot = {
	kind: 'solved',
	label: 't',
	iterations: 1,
	buses: [[pp(20500)], [pp(20400)], [pn(236)], [pn(231)], [pn(230)], []].map((pairs) => ({
		pairs,
		unbalance: null
	})),
	branches: []
};

describe('displayTree', () => {
	it('roots at sources, matches ids case-insensitively and does not cross open switches', () => {
		const tree = displayTree(graph);
		expect(tree.roots).toEqual([0, 4, 5]);
		expect([...tree.depth]).toEqual([0, 1, 2, 3, 0, 0]);
		expect([...tree.parent]).toEqual([0, 0, 1, 2, 4, 5]);
		expect([...tree.component]).toEqual([0, 0, 0, 0, 1, 2]);
		expect(treePath(tree, 3)).toEqual({ buses: [0, 1, 2, 3], edges: [0, 1, 2] });
	});
});

describe('voltageProfile', () => {
	it('splits zones at transformers and attaches the same-depth envelope', () => {
		const tree = displayTree(graph);
		const p = voltageProfile(graph, tree, result, 3);
		expect(p.pathBuses).toEqual([0, 1, 2, 3]);
		expect(p.zones.map((z) => [z.reason, z.rows.map((r) => r.bus)])).toEqual([
			['Root-side zone', [0, 1]],
			['Transformer boundary', [2, 3]]
		]);
		expect(p.zones[1].rows[1].envelope).toEqual({ min: 231, max: 231, count: 1 });
		expect(p.zones[1].rows[1].step).toBe(3);
	});

	it('shows only the last points of very deep paths and says so', () => {
		const n = MAX_PROFILE_POINTS + 20;
		const chain: DistGraph = {
			buses: Array.from({ length: n }, (_, i) => bus(`b${i}`, i === 0)),
			edges: Array.from({ length: n - 1 }, (_, i) => edge(`e${i}`, `b${i}`, `b${i + 1}`))
		};
		const snap: ResultSnapshot = {
			...result,
			buses: chain.buses.map(() => ({ pairs: [pn(230)], unbalance: null }))
		};
		const p = voltageProfile(chain, displayTree(chain), snap, n - 1);
		expect(p.pathBuses).toHaveLength(n);
		expect(p.zones[0].rows).toHaveLength(MAX_PROFILE_POINTS);
		expect(p.zones[0].rows[0].step).toBe(20);
		expect(p.notice).toContain(`last ${MAX_PROFILE_POINTS} of ${n}`);
	});
});

describe('schematic layouts', () => {
	it('gives leaves their own rows, centres parents and routes tree edges as elbows', () => {
		const tree = displayTree(graph);
		const g = leafOrderLayout(graph, tree, { dx: 100, dy: 20 });
		const at = (i: number) => [g.positions[i * 3], g.positions[i * 3 + 1]];
		expect(at(0)).toEqual([0, 0]);
		expect(at(3)).toEqual([300, 0]);
		expect(at(4)).toEqual([0, 40]);
		expect(at(5)).toEqual([0, 80]);
		expect([...g.role]).toEqual([0, 0, 0, 2]);
		expect([...g.segmentEdge].filter((k) => k === 3)).toHaveLength(1);
		expect(g.bounds).toEqual([0, 0, 300, 80]);
	});

	it('projects geographic positions to Web Mercator, y down, relative to the centroid', () => {
		const tree = displayTree(graph);
		const placed = graph.buses.map((b, i) => ({ id: b.id, lon: 150 + i * 1e-5, lat: -30 }));
		const geo = sourceLayout(graph, placed, true, tree);
		// One metre apart near longitude 150 stays one metre apart: no float32 collapse at 1.6e7 m.
		const metre = ((6_378_137 * Math.PI) / 180) * 1e-5;
		expect(geo.positions[3] - geo.positions[0]).toBeCloseTo(metre, 2);
		expect(Math.abs(geo.positions[0])).toBeLessThan(10);
		const north = sourceLayout(
			graph,
			[
				{ id: 'S', lon: 0, lat: 1 },
				{ id: 'M', lon: 0, lat: 0 }
			],
			true,
			tree
		);
		expect(north.positions[1]).toBeLessThan(north.positions[4]);
		const planar = sourceLayout(
			graph,
			graph.buses.map((b, i) => ({ id: b.id, lon: i, lat: i })),
			false,
			tree
		);
		expect(planar.positions[3] - planar.positions[0]).toBe(1);
		expect(planar.positions[4] - planar.positions[1]).toBe(-1);
		expect(planar.segmentEdge).toHaveLength(graph.edges.length);
	});
});
