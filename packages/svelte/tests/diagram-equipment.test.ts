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
	describeBus,
	flowArrows,
	elementPowers,
	formatPower,
	galvanicZones,
	zoneState,
	zoneOutline,
	zoneHull,
	zoneVoltage,
	zoneLevel,
	zoneSummary
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

describe('solved values on the drawing', () => {
	const eq = schematicEquipment(graph, fromEngineLayout(layout));

	it('points flow arrows the way active power goes, upstream of each symbol', () => {
		// t1 carries power from S to M; l1 carries it back from L to M; the open switch none.
		const a = flowArrows(
			eq,
			[
				[{ p: 1000 }, null],
				[{ p: -500 }, null],
				[{ p: 10 }, null]
			],
			[true, true, false]
		);
		expect(Array.from(a.edge)).toEqual([0, 0, 1, 1]);
		const tipDx = (s: number) => a.targets[s * 3] - a.sources[s * 3];
		expect(tipDx(0)).toBeGreaterThan(0);
		expect(tipDx(2)).toBeLessThan(0);
		// The chevron sits before the transformer symbol, not on it.
		expect(a.targets[0]).toBeLessThan(eq.anchors[0] - INLINE_HALF * eq.unit);
		// A missing from end falls back to the to end with the sign flipped.
		const back = flowArrows(
			eq,
			[
				[null, { p: 1000 }],
				[null, null],
				[null, null]
			],
			[true, true, true]
		);
		expect(back.targets[0] - back.sources[0]).toBeLessThan(0);
	});

	it('sums element powers and reads sources as consumption', () => {
		const powers = elementPowers({
			element_ports: [
				{ element: 'ld1', power_into_element: { re: 100, im: 10 } },
				{ element: 'ld1', power_into_element: { re: 50, im: 5 } }
			],
			source_reactions: [{ source: 'grid', power_into_network: { re: 160, im: 20 } }]
		});
		expect(powers.get('ld1')).toEqual({ p: 150, q: 15 });
		expect(powers.get('grid')).toEqual({ p: -160, q: -20 });
		expect(formatPower(15_000, 5_000)).toBe('15.0 kW 5.0 kvar');
		expect(formatPower(2.5e6, -1e5)).toBe('2.5 MW -0.1 Mvar');
		expect(formatPower(160, 20)).toBe('160 W 20.0 var');
	});
});

describe('galvanic zones', () => {
	// src —t0→ mv —l→ mv2; mv —t2→ a1 — a2 — a3; mv2 —t3→ b1 — b2.
	const g: DistGraph = {
		buses: ['src', 'hv', 'mv', 'mv2', 'a1', 'a2', 'a3', 'b1', 'b2'].map((id) =>
			bus(id, [], id === 'src')
		),
		edges: [
			edge('line', 's', 'src', 'hv'),
			edge('transformer', 't0', 'hv', 'mv'),
			edge('line', 'm', 'mv', 'mv2'),
			edge('transformer', 't2', 'mv', 'a1'),
			edge('line', 'a12', 'a1', 'a2'),
			edge('line', 'a23', 'a2', 'a3'),
			edge('transformer', 't3', 'mv2', 'b1'),
			edge('line', 'b12', 'b1', 'b2')
		]
	};
	const tree = displayTree(g);
	const found = galvanicZones(g, tree);
	const ids = (z: { buses: number[] }) => z.buses.map((i) => g.buses[i].id);

	it('splits the network at transformers and names each zone’s feeding transformer', () => {
		expect(found.zones.map(ids)).toEqual([
			['src', 'hv'],
			['mv', 'mv2'],
			['a1', 'a2', 'a3'],
			['b1', 'b2']
		]);
		expect(found.zones.map((z) => z.hasSource)).toEqual([true, false, false, false]);
		expect(found.zones.map((z) => g.edges[z.transformers[0]].id)).toEqual(['t0', 't0', 't2', 't3']);
		// The MV zone has three transformer windings in it, fed through t0.
		expect(found.zones[1].transformers.map((k) => g.edges[k].id)).toEqual(['t0', 't2', 't3']);
		expect(found.zones[2].edges.map((k) => g.edges[k].id)).toEqual(['a12', 'a23']);
	});

	it('reports the worst state inside, including the transformers', () => {
		const pair = (volts: number) => ({
			pair: ['a', 'n'] as [string, string],
			volts,
			min: 207,
			max: 253
		});
		const snap = (volts: number, tLoading: number) => ({
			kind: 'solved' as const,
			label: '',
			iterations: 1,
			buses: g.buses.map((_, i) => ({ pairs: [pair(i === 5 ? volts : 230)], unbalance: null })),
			branches: g.edges.map((_, k) => ({
				ends: [null, null] as [null, null],
				loading: k === 3 ? tLoading : 10,
				basis: null
			}))
		});
		const a = found.zones[2];
		expect(zoneState(a, null)).toBe('missing');
		expect(zoneState(a, snap(230, 50))).toBe('normal');
		expect(zoneState(a, snap(230, 95))).toBe('warning');
		expect(zoneState(a, snap(200, 50))).toBe('violation');
	});

	it('tells MV from LV by declared limits, then by solved voltages, then by the source', () => {
		const limited: DistGraph = {
			...g,
			buses: g.buses.map((b) =>
				b.id === 'mv' || b.id === 'mv2'
					? { ...b, voltage_limits: { vpp_min: [10_000], vpp_max: [12_000] } }
					: b.id.startsWith('a')
						? { ...b, voltage_limits: { vpn_min: [207], vpn_max: [253] } }
						: b
			)
		};
		expect(zoneVoltage(found.zones[1], limited, null)).toBe(11_000);
		expect(zoneVoltage(found.zones[2], limited, null)).toBeCloseTo(230 * Math.sqrt(3));
		expect(zoneVoltage(found.zones[3], limited, null)).toBeNull();
		expect(zoneLevel(found.zones[1], 11_000)).toBe('mv');
		expect(zoneLevel(found.zones[2], 398)).toBe('lv');
		expect(zoneLevel(found.zones[0], null)).toBe('mv');
		expect(zoneLevel(found.zones[3], null)).toBe('lv');
	});

	it('summarises a zone by its lowest phase–neutral voltage and highest loading', () => {
		const snap = {
			kind: 'solved' as const,
			label: '',
			iterations: 1,
			buses: g.buses.map((_, i) => ({
				pairs: [
					{ pair: ['a', 'b'] as [string, string], volts: 400, min: null, max: null },
					{ pair: ['a', 'n'] as [string, string], volts: 230 - i, min: null, max: null }
				],
				unbalance: null
			})),
			branches: g.edges.map((_, k) => ({
				ends: [null, null] as [null, null],
				loading: k * 10,
				basis: null
			}))
		};
		// Zone a: buses 4–6 (a3 lowest at 224 V); branches a12, a23 and transformer t2.
		expect(zoneSummary(found.zones[2], snap)).toEqual({ minVolts: 224, maxLoading: 50 });
		expect(zoneSummary(found.zones[2], null)).toEqual({ minVolts: null, maxLoading: null });
	});

	it('outlines a zone as a staircase over its drawing columns', () => {
		// Two columns at x = 100 (rows 0–20) and x = 200 (row 40, with one symbol slot below).
		const positions = [100, 0, 0, 100, 20, 0, 200, 40, 0];
		const outline = zoneOutline(
			{ buses: [0, 1, 2], edges: [], transformers: [], hasSource: false },
			positions,
			[0, 0, 10],
			{
				dx: 100,
				pad: 5
			}
		);
		expect(outline).toEqual([
			[85, -5],
			[150, -5],
			[150, 35],
			[240, 35],
			[240, 55],
			[150, 55],
			[150, 25],
			[85, 25]
		]);
		expect(
			zoneHull(
				{ buses: [0, 1, 2, 3], edges: [], transformers: [], hasSource: false },
				[0, 0, 0, 10, 0, 0, 10, 10, 0, 5, 5, 0]
			)
		).toHaveLength(3);
	});
});
