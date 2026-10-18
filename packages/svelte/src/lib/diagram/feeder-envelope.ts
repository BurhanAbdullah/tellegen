import type { PairVoltage, ResultSnapshot } from './snapshot.js';
import { pairZone } from './summary.js';

export interface EnvelopeBand {
	min: number;
	max: number;
	count: number;
}

/** Display-tree placement the envelope groups by; layouts without a tree have none. */
export interface TreePlacement {
	depth: ArrayLike<number>;
	component: ArrayLike<number>;
}

const key = (component: number, depth: number, zone: string) => `${component}|${depth}|${zone}`;

/** Min/max over every bus at the same display-tree depth, component and pair reference, so
 * phase–phase and phase–neutral values never share a band. One pass; cache per snapshot. */
export function feederEnvelope(
	tree: TreePlacement,
	result: ResultSnapshot
): Map<string, EnvelopeBand> {
	const bands = new Map<string, EnvelopeBand>();
	result.buses.forEach((bus, i) => {
		for (const p of bus.pairs) {
			const k = key(tree.component[i], tree.depth[i], pairZone(p.pair));
			const band = bands.get(k);
			if (!band) bands.set(k, { min: p.volts, max: p.volts, count: 1 });
			else {
				band.min = Math.min(band.min, p.volts);
				band.max = Math.max(band.max, p.volts);
				band.count++;
			}
		}
	});
	return bands;
}

/** The band for each profile row, matched on the row's own depth and reference; `null` without peers. */
export function rowEnvelopes(
	bands: Map<string, EnvelopeBand>,
	tree: TreePlacement,
	rows: { bus: number; pairs: PairVoltage[] }[]
): (EnvelopeBand | null)[] {
	return rows.map((row) => {
		const p = row.pairs[0];
		return p
			? (bands.get(key(tree.component[row.bus], tree.depth[row.bus], pairZone(p.pair))) ?? null)
			: null;
	});
}
