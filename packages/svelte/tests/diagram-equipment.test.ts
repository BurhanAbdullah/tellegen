import { describe, expect, it } from 'vitest';
import type { DistGraph, SchematicLayout } from '@tellegen/engine';
import {
	attachmentGlyph,
	branchGlyph,
	fromEngineLayout,
	glyphPath,
	INLINE_HALF,
	schematicEquipment,
	sourceLayout,
	displayTree,
	conductorSet,
	conductorTicks,
	energisation,
	shortNames,
	treeWalk,
	describeBus
} from '../src/lib/diagram/index.js';

const bus = (id: string, attachments: [string, string, string][] = [], source = false) => ({
	id,
	terminals: ['1', '2', '3', 'n'],
	grounded: [],
	load_kw: 0,
	gen_kw: 0,
	has_source: source,
	terminal_attachments: Object.fromEntries(
		[...new Set(attachments.map(([t]) => t))].map((t) => [
			t,
			attachments.filter(([at]) => at === t).map(([, kind, id]) => ({ kind: kind as 'load', id }))
		])
	)
});
const edge = (
	kind: 'line' | 'switch' | 'transformer',
	id: string,
	from: string,
	to: string,
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

// S —t1→ M —l1→ L, and an open switch M–X. M carries a generator and two loads; the loads appear
// on two terminals each, as multi-phase loads do in PowerIO graphs.
const graph: DistGraph = {
	buses: [
		bus('S', [['1', 'source', 'grid']], true),
		bus('M', [
			['1', 'load', 'ld1'],
			['2', 'load', 'ld1'],
			['2', 'load', 'ld2'],
			['3', 'generator', 'g1']
		]),
		bus('L'),
		bus('X')
	],
	edges: [
		edge('transformer', 't1', 'S', 'M'),
		edge('line', 'l1', 'M', 'L'),
		edge('switch', 'sw', 'M', 'X', false)
	]
};
// An engine layout as Rust returns it: t1 straight, l1 elbowed, sw straight and open.
const layout: SchematicLayout = {
	version: 1,
	strategy: 'tidy',
	positions: [0, 0, 120, 0, 240, 0, 240, 100],
	segments: [0, 0, 120, 0, 120, 0, 240, 0, 120, 0, 240, 100],
	segment_edge: [0, 1, 2],
	role: [0, 0, 2],
	parent: [0, 0, 1, 3],
	parent_edge: [-1, 0, 1, -1],
	depth: [0, 1, 2, 0],
	roots: [0, 3],
	bounds: [0, 0, 240, 100],
	attachment_gap: 22,
	attachment_slots: [1, 2, 0, 0]
};

describe('schematic equipment symbols', () => {
	const geometry = fromEngineLayout(layout);
	const eq = schematicEquipment(graph, geometry);

	it('draws transformers and switches on their branch and lines bare', () => {
		const inline = eq.items.filter((d) => d.edge >= 0);
		expect(inline.map((d) => [d.kind, d.ids[0]])).toEqual([
			['transformer', 't1'],
			['switch', 'sw']
		]);
		expect(branchGlyph('line', true)).toBeNull();
		// The tree transformer sits a fixed distance back from its child bus, the open switch mid-span.
		const unit = 22 * 0.4;
		expect(eq.unit).toBeCloseTo(unit);
		expect(inline[0].x).toBeCloseTo(120 - 2.5 * INLINE_HALF * unit);
		expect(inline[0].y).toBe(0);
		expect([inline[1].x, inline[1].y]).toEqual([180, 50]);
	});

	it('interrupts each symbol branch line and keeps edge ownership for picking', () => {
		expect(Array.from(eq.cut.segmentEdge)).toEqual([0, 0, 1, 2, 2]);
		const half = INLINE_HALF * eq.unit;
		const centre = 120 - 2.5 * half;
		expect(eq.cut.targets[0]).toBeCloseTo(centre - half);
		expect(eq.cut.sources[3]).toBeCloseTo(centre + half);
		// Bus positions are untouched.
		expect(eq.cut.positions).toBe(geometry.positions);
	});

	it('hangs one symbol per attachment kind in the reserved slots, with all ids', () => {
		const attached = eq.items.filter((d) => d.bus >= 0);
		expect(attached.map((d) => [d.kind, graph.buses[d.bus].id, d.ids])).toEqual([
			['source', 'S', ['grid']],
			['generator', 'M', ['g1']],
			['load', 'M', ['ld1', 'ld2']]
		]);
		expect(attached.map((d) => d.y)).toEqual([22, 22, 44]);
		expect([...eq.kinds].sort()).toEqual(['generator', 'load', 'source', 'switch', 'transformer']);
	});

	it('shows an open switch with its blade lifted off the far contact', () => {
		const closed = branchGlyph('switch', true)!;
		const open = branchGlyph('switch', false)!;
		expect(closed.at(-1)!.at(-1)).toEqual([1.05, 0]);
		expect(open.at(-1)!.at(-1)![1]).toBeLessThan(-0.5);
	});

	it('gives every attachment kind a distinct glyph connected at its origin', () => {
		const kinds = ['load', 'generator', 'source', 'ibr', 'shunt'] as const;
		const paths = kinds.map((k) => glyphPath(attachmentGlyph(k), 10));
		expect(new Set(paths).size).toBe(kinds.length);
		for (const k of kinds) expect(attachmentGlyph(k)[0][0]).toEqual([0, 0]);
	});

	it('scales symbols to the drawing for source positions', () => {
		const placed = [
			{ id: 'S', lon: 0, lat: 0 },
			{ id: 'M', lon: 400, lat: 0 },
			{ id: 'L', lon: 800, lat: 0 },
			{ id: 'X', lon: 400, lat: 300 }
		];
		const src = sourceLayout(graph, placed, false, displayTree(graph));
		const symbols = schematicEquipment(graph, src);
		expect(symbols.unit).toBeCloseTo(400 * 0.25 * 0.4);
		expect(symbols.items.find((d) => d.kind === 'transformer')!.x).toBeCloseTo(-200);
	});
});

describe('energisation', () => {
	it('dims what no source reaches through closed branches', () => {
		const g: DistGraph = {
			buses: [...graph.buses, bus('Y')],
			edges: [...graph.edges, edge('line', 'xy', 'X', 'Y')]
		};
		const e = energisation(g);
		expect(Array.from(e.buses)).toEqual([1, 1, 1, 0, 0]);
		// The open switch is live on its source side; the line beyond it is not.
		expect(Array.from(e.edges)).toEqual([1, 1, 1, 0]);
		expect(e.deadBuses).toBe(2);
	});
});

describe('conductor marks', () => {
	it('count phases and recognise the neutral from the bus', () => {
		const g: DistGraph = {
			buses: [
				{ ...bus('A', [], true), neutral_terminal: 'n' },
				{ ...bus('B'), neutral_terminal: 'n' }
			],
			edges: [
				{
					...edge('line', 'ab', 'A', 'B'),
					conductors: [
						['2', '2'],
						['n', 'n']
					]
				}
			]
		};
		expect(conductorSet(g, 0)).toEqual({ phases: 1, neutral: true });
		// One slash per conductor, and the neutral's slash carries a circle.
		expect(conductorTicks(1, true)).toHaveLength(3);
		expect(conductorTicks(3, false)).toHaveLength(3);
	});

	it('anchor every branch, and own every symbol stroke', () => {
		const eq = schematicEquipment(graph, fromEngineLayout(layout));
		for (let k = 0; k < graph.edges.length; k++)
			expect(Number.isFinite(eq.anchors[k * 2])).toBe(true);
		expect(eq.owner.length).toBe(eq.sources.length / 3);
		// The bare line l1 has no neutral terminal declared here, so no marks; others own symbols.
		expect(new Set(eq.owner)).toEqual(new Set([0, 2, -1, -2]));
	});
});

describe('short names', () => {
	it('keep short ids and shorten long ones uniquely', () => {
		const ids = [
			'lb',
			'lv_extension_02ad4cfa5ebe_0062383670bceb3c28d5',
			'lv_extension_02ad4cfa5ebe_9962383670bceb3c28d5',
			'lv_extension_02ad4cfa5ebe_0062383670bceb3c11d5'
		];
		const names = shortNames(ids);
		expect(names[0]).toBe('lb');
		expect(new Set(names).size).toBe(ids.length);
		expect(names[3]).toBe('lv_extension_0…c11d5');
		expect(names[1].length).toBeLessThan(ids[1].length);
		for (const n of names.slice(1)) expect(n).toContain('…');
	});
});

describe('keyboard walk', () => {
	const tree = displayTree(graph);
	const walk = treeWalk(tree, layout.positions, 2);
	const [S, M, L, X] = [0, 1, 2, 3];

	it('moves to the feeding bus, onward, and between drawn neighbours', () => {
		expect(walk.step(M, 'parent')).toBe(S);
		expect(walk.step(S, 'parent')).toBe(S);
		expect(walk.step(S, 'child')).toBe(M);
		expect(walk.step(M, 'child')).toBe(L);
		expect(walk.step(L, 'child')).toBe(L);
		// X is beyond the open switch, so it roots its own component below S.
		expect(walk.step(S, 'next')).toBe(X);
		expect(walk.step(X, 'previous')).toBe(S);
		expect(walk.step(L, 'root')).toBe(S);
		expect(walk.step(-1, 'child')).toBe(S);
	});

	it('describes where a bus sits and what hangs off it', () => {
		expect(describeBus(graph, tree, walk, M, 'Worst voltage a–n 230.0 V')).toBe(
			'M: 1 step from S, fed by transformer t1. 1 branch onward. 1 generator, 2 loads. Worst voltage a–n 230.0 V'
		);
		expect(describeBus(graph, tree, walk, X)).toBe(
			'X: not reached from a source. 0 branches onward'
		);
	});
});
