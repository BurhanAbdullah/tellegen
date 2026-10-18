import { describe, expect, it } from 'vitest';
import type { DistGraph } from '@tellegen/engine';
import {
	displayTree,
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
