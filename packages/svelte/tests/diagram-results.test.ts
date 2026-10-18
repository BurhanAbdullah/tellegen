import { describe, expect, it } from 'vitest';
import type { McPfResult } from '@tellegen/engine';
import {
	exceedance,
	magnitudeUnbalance,
	pairZone,
	rankIssues,
	sequenceUnbalance,
	snapshotFromMcPf,
	snapshotSummary,
	type PairVoltage,
	type ResultSnapshot
} from '../src/lib/diagram/index.js';

const polar = (m: number, deg: number) => ({
	re: m * Math.cos((deg * Math.PI) / 180),
	im: m * Math.sin((deg * Math.PI) / 180)
});
const add = (a: { re: number; im: number }, b: { re: number; im: number }) => ({
	re: a.re + b.re,
	im: a.im + b.im
});
const pn = (
	t: string,
	volts: number,
	min: number | null = 207,
	max: number | null = 253
): PairVoltage => ({
	pair: [t, 'n'],
	volts,
	min,
	max
});
const pp = (a: string, b: string, volts: number): PairVoltage => ({
	pair: [a, b],
	volts,
	min: 19000,
	max: 21000
});

function snapshot(): ResultSnapshot {
	return {
		kind: 'solved',
		label: 'test',
		iterations: 3,
		buses: [
			{ pairs: [pp('1', '2', 20400), pp('2', '3', 20500), pp('3', '1', 20450)], unbalance: null },
			{ pairs: [pn('1', 230), pn('2', 232), pn('3', 205)], unbalance: null },
			{ pairs: [pn('1', 255), pn('2', 240), pn('3', 240)], unbalance: null },
			{ pairs: [], unbalance: null }
		],
		branches: [
			{
				ends: [
					{ p: 100, q: 10, currents: [] },
					{ p: -98, q: -9, currents: [] }
				],
				loading: 95,
				basis: null
			},
			{
				ends: [
					{ p: 50, q: 5, currents: [] },
					{ p: -49.5, q: -4.8, currents: [] }
				],
				loading: 120,
				basis: null
			},
			{ ends: [null, null], loading: null, basis: null },
			{
				ends: [
					{ p: 10, q: 1, currents: [] },
					{ p: -10, q: -1, currents: [] }
				],
				loading: 101,
				basis: null
			}
		]
	};
}

describe('sequenceUnbalance', () => {
	it('is zero for a balanced positive-sequence set and recovers an injected negative sequence', () => {
		const balanced = [polar(230, 0), polar(230, -120), polar(230, 120)] as const;
		expect(sequenceUnbalance(...balanced)).toBeCloseTo(0, 10);
		const negative = [polar(4.6, 0), polar(4.6, 120), polar(4.6, -120)];
		const [a, b, c] = balanced.map((v, i) => add(v, negative[i]));
		expect(sequenceUnbalance(a, b, c)).toBeCloseTo(2, 10);
	});

	it('returns null without a positive sequence', () => {
		const zero = { re: 0, im: 0 };
		expect(sequenceUnbalance(zero, zero, zero)).toBeNull();
	});
});

describe('snapshotFromMcPf', () => {
	const terminal = (bus: string, t: string, v: { re: number; im: number }) => ({
		bus,
		terminal: t,
		voltage: v,
		current_into_network: { re: 0, im: 0 },
		power_into_network: { re: 0, im: 0 }
	});
	const port = (element: string, bus: string, t: string, amps: number, kw: number) => ({
		element,
		kind: 'line',
		branch: 0,
		bus,
		terminal: t,
		current_into_element: { re: amps, im: 0 },
		power_into_element: { re: kw * 1000, im: kw * 100 }
	});
	const result = {
		iterations: 4,
		terminals: [
			terminal('A', '1', polar(20000 / Math.sqrt(3), 0)),
			terminal('A', '2', polar(20000 / Math.sqrt(3), -120)),
			terminal('A', '3', polar(20000 / Math.sqrt(3), 120)),
			terminal('B', '1', polar(231, 0)),
			terminal('B', '2', polar(229, -120)),
			terminal('B', '3', polar(205, 120)),
			terminal('B', 'n', polar(1, 0))
		],
		element_ports: [
			port('L1', 'A', '1', 90, 10),
			port('L1', 'A', '2', 110, 11),
			port('L1', 'A', '3', 176, 12),
			port('L1', 'B', '1', 90, -10),
			port('L1', 'B', '2', 110, -10.5),
			port('L1', 'B', '3', 176, -11.4)
		]
	} as unknown as McPfResult;
	const buses = [
		{
			id: 'A',
			terminals: ['1', '2', '3'],
			limits: { reference: 'phase-phase' as const, min: 19000, max: 21000 }
		},
		{
			id: 'B',
			terminals: ['1', '2', '3', 'n'],
			limits: { reference: 'phase-neutral' as const, min: [207, 207, 207], max: [253, 253, 253] }
		}
	];
	const branch = {
		id: 'L1',
		from: 'A',
		to: 'B',
		fromTerminals: ['1', '2', '3'],
		toTerminals: ['1', '2', '3'],
		inService: true,
		rating: { kind: 'current' as const, amps: [200, 200, 200] }
	};

	it('derives declared pair voltages, phasor unbalance and signed end totals', () => {
		const s = snapshotFromMcPf(result, buses, [branch]);
		expect(s.iterations).toBe(4);
		expect(s.buses[0].pairs.map((p) => p.pair.join('-'))).toEqual(['1-2', '2-3', '3-1']);
		expect(s.buses[0].pairs[0].volts).toBeCloseTo(20000, 6);
		expect(s.buses[0].unbalance?.percent).toBeCloseTo(0, 8);
		expect(s.buses[1].pairs.map((p) => p.pair)).toEqual([
			['1', 'n'],
			['2', 'n'],
			['3', 'n']
		]);
		expect(s.buses[1].pairs[2].min).toBe(207);
		expect(s.buses[1].unbalance?.definition).toBe('VUF');
		expect(s.buses[1].unbalance?.percent).toBeGreaterThan(2);
		const [from, to] = s.branches[0].ends;
		expect(from?.p).toBeCloseTo(33, 10);
		expect(to?.p).toBeCloseTo(-31.9, 10);
		expect(from?.currents.map((c) => c.amps)).toEqual([90, 110, 176]);
		expect(s.branches[0].loading).toBeCloseTo(88, 10);
	});

	it('leaves ends null for missing ports and out-of-service branches, and loading unknown', () => {
		const s = snapshotFromMcPf(result, buses, [
			{ ...branch, inService: false },
			{ ...branch, id: 'L2' }
		]);
		expect(s.branches[0].ends).toEqual([null, null]);
		expect(s.branches[1].ends).toEqual([null, null]);
		expect(s.branches[1].loading).toBeNull();
	});

	it('keeps undeclared limits as null rather than inventing a band', () => {
		const s = snapshotFromMcPf(result, [{ id: 'B', terminals: ['1', '2', '3', 'n'] }], []);
		expect(s.buses[0].pairs.every((p) => p.min === null && p.max === null)).toBe(true);
		expect(rankIssues(s)).toEqual([]);
	});
});

describe('issues and summary', () => {
	it('zones follow the declared reference and exceedance is relative to the violated limit', () => {
		expect(pairZone(['1', 'n'])).toBe('phase–neutral');
		expect(pairZone(['1', '2'])).toBe('phase–phase');
		expect(exceedance(pn('1', 205))).toBeCloseTo((100 * 2) / 207, 12);
		expect(exceedance(pn('1', 230))).toBeLessThan(0);
		expect(exceedance(pn('1', 230, null, null))).toBe(Number.NEGATIVE_INFINITY);
	});

	it('ranks violations before warnings, then by exceedance, with deterministic ties', () => {
		const issues = rankIssues(snapshot());
		expect(issues.map((i) => [i.kind, i.severity, i.target.index])).toEqual([
			['loading', 'violation', 1],
			['loading', 'violation', 3],
			['voltage', 'violation', 1],
			['voltage', 'violation', 2],
			['loading', 'warning', 0]
		]);
		const low = issues.find((i) => i.kind === 'voltage' && i.target.index === 1);
		expect([low?.low, low?.limit, low?.pair]).toEqual([true, 207, ['3', 'n']]);
	});

	it('summarises losses over active branches, per-zone extremes and the worst unbalance', () => {
		const s = snapshotSummary(snapshot());
		expect(s.loss.p).toBeCloseTo(2.5, 12);
		expect(s.loss.q).toBeCloseTo(1.2, 12);
		expect(s.loss.branches).toBe(3);
		expect(s.loading).toEqual({ branch: 1, value: 120 });
		expect(s.counts).toEqual({ voltage: 2, overload: 2, warning: 1 });
		const lv = s.zones.find((z) => z.zone === 'phase–neutral');
		expect([lv?.min.bus, lv?.min.volts, lv?.min.state, lv?.max.volts, lv?.buses]).toEqual([
			1,
			205,
			'violation',
			255,
			2
		]);
		expect(s.unbalance?.bus).toBe(1);
		expect(s.unbalance?.definition).toBe('IEEE PVUR');
	});

	it('prefers phasor unbalance and labels the magnitude fallbacks by standard', () => {
		const s = snapshot();
		s.buses[0].unbalance = { percent: 50, definition: 'VUF' };
		expect(snapshotSummary(s).unbalance).toEqual({ percent: 50, definition: 'VUF', bus: 0 });
		expect(magnitudeUnbalance(s.buses[0].pairs)?.definition).toBe('NEMA LVUR');
		expect(magnitudeUnbalance([pn('1', 230), pn('2', 230)])).toBeNull();
	});
});
