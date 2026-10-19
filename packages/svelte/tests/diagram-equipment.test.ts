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
	displayTree
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
