import type { McComplex, McPfResult } from '@tellegen/engine';

/** One declared terminal-pair voltage magnitude and, when declared, its limits. */
export interface PairVoltage {
	pair: [string, string];
	volts: number;
	min: number | null;
	max: number | null;
}

export interface UnbalanceValue {
	percent: number;
	/** `VUF` uses phasors (|V2| / |V1|); the magnitude-only fallbacks name their standard. */
	definition: 'VUF' | 'IEEE PVUR' | 'NEMA LVUR';
}

export interface BusSnapshot {
	pairs: PairVoltage[];
	unbalance: UnbalanceValue | null;
}

export interface ConductorCurrent {
	terminal: string;
	amps: number;
}

/** End totals over every terminal of the element, positive into the equipment. */
export interface BranchEnd {
	p: number;
	q: number;
	currents: ConductorCurrent[];
}

export interface BranchSnapshot {
	ends: [BranchEnd | null, BranchEnd | null];
	loading: number | null;
	basis: string | null;
}

/** A result snapshot indexed like the drawing: `buses[i]` and `branches[b]` follow the network order. */
export interface ResultSnapshot {
	kind: 'solved' | 'stress';
	label: string;
	iterations: number | null;
	buses: BusSnapshot[];
	branches: BranchSnapshot[];
}

/** Declared limits for one bus. Phase–neutral limits list one band per phase terminal. */
export type BusLimits =
	| { reference: 'phase-neutral'; min: number[]; max: number[] }
	| { reference: 'phase-phase'; min: number; max: number };

export interface SnapshotBus {
	id: string;
	terminals: string[];
	neutral?: string | null;
	limits?: BusLimits | null;
}

export type BranchRating = { kind: 'current'; amps: number[] } | { kind: 'apparent'; va: number };

export interface SnapshotBranch {
	id: string;
	from: string;
	to: string;
	fromTerminals: string[];
	toTerminals: string[];
	inService: boolean;
	rating?: BranchRating | null;
}

const magnitude = (z: McComplex) => Math.hypot(z.re, z.im);
const sub = (a: McComplex, b: McComplex): McComplex => ({ re: a.re - b.re, im: a.im - b.im });

/** Voltage unbalance factor |V2| / |V1| in percent, from three phasors in phase order. The ratio
 * is the same for phase–neutral and phase–phase voltages, so either reference works. */
export function sequenceUnbalance(a: McComplex, b: McComplex, c: McComplex): number | null {
	// α = e^{j2π/3}: V1 = (a + α b + α² c) / 3, V2 = (a + α² b + α c) / 3.
	const h = Math.sqrt(3) / 2;
	const rot = (z: McComplex, s: number): McComplex => ({
		re: -0.5 * z.re - s * h * z.im,
		im: s * h * z.re - 0.5 * z.im
	});
	const v1 = { re: a.re + rot(b, 1).re + rot(c, -1).re, im: a.im + rot(b, 1).im + rot(c, -1).im };
	const v2 = { re: a.re + rot(b, -1).re + rot(c, 1).re, im: a.im + rot(b, -1).im + rot(c, 1).im };
	const positive = magnitude(v1);
	return positive > 0 ? (100 * magnitude(v2)) / positive : null;
}

function busSnapshot(bus: SnapshotBus, voltage: (terminal: string) => McComplex | undefined) {
	const neutral = bus.neutral ?? (bus.terminals.includes('n') ? 'n' : null);
	const phases = bus.terminals.filter((t) => t !== neutral);
	const pairs: PairVoltage[] = [];
	const phasors: McComplex[] = [];
	const zero: McComplex = { re: 0, im: 0 };
	const reference = bus.limits?.reference ?? (neutral ? 'phase-neutral' : 'phase-phase');
	if (reference === 'phase-neutral' && neutral) {
		const vn = voltage(neutral) ?? zero;
		phases.forEach((t, i) => {
			const v = voltage(t);
			if (!v) return;
			const limits = bus.limits?.reference === 'phase-neutral' ? bus.limits : null;
			pairs.push({
				pair: [t, neutral],
				volts: magnitude(sub(v, vn)),
				min: limits?.min[i] ?? null,
				max: limits?.max[i] ?? null
			});
			phasors.push(sub(v, vn));
		});
	} else if (phases.length === 3) {
		const limits = bus.limits?.reference === 'phase-phase' ? bus.limits : null;
		for (const [i, j] of [
			[0, 1],
			[1, 2],
			[2, 0]
		]) {
			const a = voltage(phases[i]);
			const b = voltage(phases[j]);
			if (!a || !b) continue;
			pairs.push({
				pair: [phases[i], phases[j]],
				volts: magnitude(sub(a, b)),
				min: limits?.min ?? null,
				max: limits?.max ?? null
			});
		}
		for (const t of phases) {
			const v = voltage(t);
			if (v) phasors.push(v);
		}
	}
	const vuf = phasors.length === 3 ? sequenceUnbalance(phasors[0], phasors[1], phasors[2]) : null;
	return { pairs, unbalance: vuf === null ? null : { percent: vuf, definition: 'VUF' as const } };
}

/** Project a full multiconductor power-flow result onto the drawing's bus and branch order.
 * Missing ports leave an end `null`; nothing is interpolated. */
export function snapshotFromMcPf(
	result: McPfResult,
	buses: SnapshotBus[],
	branches: SnapshotBranch[],
	label = 'Tellegen multiconductor power flow'
): ResultSnapshot {
	const voltages = new Map<string, McComplex>();
	for (const t of result.terminals) voltages.set(`${t.bus}\u0000${t.terminal}`, t.voltage);
	const ports = new Map<string, typeof result.element_ports>();
	for (const p of result.element_ports) {
		const key = `${p.element}\u0000${p.bus}`;
		ports.set(key, [...(ports.get(key) ?? []), p]);
	}
	const branchSnapshots = branches.map((branch): BranchSnapshot => {
		const ends = [branch.from, branch.to].map((bus, side): BranchEnd | null => {
			const rows = ports.get(`${branch.id}\u0000${bus}`);
			if (!branch.inService || !rows?.length) return null;
			const order = side ? branch.toTerminals : branch.fromTerminals;
			return {
				p: rows.reduce((s, r) => s + r.power_into_element.re, 0) / 1000,
				q: rows.reduce((s, r) => s + r.power_into_element.im, 0) / 1000,
				currents: order.flatMap((terminal) => {
					const row = rows.find((r) => r.terminal === terminal);
					return row ? [{ terminal, amps: magnitude(row.current_into_element) }] : [];
				})
			};
		}) as [BranchEnd | null, BranchEnd | null];
		return { ends, ...loadingOf(branch, ends) };
	});
	return {
		kind: 'solved',
		label,
		iterations: result.iterations,
		buses: buses.map((bus) => busSnapshot(bus, (t) => voltages.get(`${bus.id}\u0000${t}`))),
		branches: branchSnapshots
	};
}

function loadingOf(
	branch: SnapshotBranch,
	ends: [BranchEnd | null, BranchEnd | null]
): Pick<BranchSnapshot, 'loading' | 'basis'> {
	const rating = branch.rating;
	if (!rating || !ends[0] || !ends[1]) return { loading: null, basis: null };
	if (rating.kind === 'current') {
		const ratios = ends.flatMap((end, side) =>
			(end?.currents ?? []).map((c) => {
				const k = (side ? branch.toTerminals : branch.fromTerminals).indexOf(c.terminal);
				return rating.amps[k] > 0 ? c.amps / rating.amps[k] : NaN;
			})
		);
		return ratios.length && ratios.every(Number.isFinite)
			? {
					loading: 100 * Math.max(...ratios),
					basis: 'Maximum conductor |I| / rating across both ends'
				}
			: { loading: null, basis: null };
	}
	const apparent = Math.max(...ends.map((e) => Math.hypot(e?.p ?? 0, e?.q ?? 0) * 1000));
	return rating.va > 0
		? {
				loading: (100 * apparent) / rating.va,
				basis: 'Maximum end |S| / rating; aggregate, not worst winding'
			}
		: { loading: null, basis: null };
}
