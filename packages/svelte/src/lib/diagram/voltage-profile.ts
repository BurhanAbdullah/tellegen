import type { DistGraph } from '@tellegen/engine';
import { treePath, type DisplayTree } from './display-tree.js';
import { feederEnvelope, rowEnvelopes, type EnvelopeBand } from './feeder-envelope.js';
import type { PairVoltage, ResultSnapshot } from './snapshot.js';

export const MAX_PROFILE_POINTS = 256;

export interface ProfileRow {
	bus: number;
	/** Branch steps from the root: topology distance, not length. */
	step: number;
	pairs: PairVoltage[];
	envelope: EnvelopeBand | null;
}

export interface ProfileZone {
	reason: 'Root-side zone' | 'Transformer boundary' | 'Voltage reference changes';
	rows: ProfileRow[];
}

export interface VoltageProfile {
	target: number;
	root: number;
	/** Buses on the full path; `zones` may show only its last {@link MAX_PROFILE_POINTS}. */
	pathBuses: number[];
	zones: ProfileZone[];
	notice: string;
}

/** The display-tree path from its root to `target`, split into zones wherever a transformer is
 * crossed or the declared pair references change, so phase–phase and phase–neutral values never
 * share an axis. Each row carries the min–max of all peers at its depth and reference. */
export function voltageProfile(
	graph: DistGraph,
	tree: DisplayTree,
	result: ResultSnapshot,
	target: number,
	envelope = feederEnvelope(tree, result)
): VoltageProfile {
	const path = treePath(tree, target);
	const start = Math.max(0, path.buses.length - MAX_PROFILE_POINTS);
	const zones: ProfileZone[] = [];
	let signature: string | null = null;
	for (let k = start; k < path.buses.length; k++) {
		const bus = path.buses[k];
		const pairs = result.buses[bus].pairs;
		const next = JSON.stringify(pairs.map((p) => p.pair));
		const transformer = k > 0 && graph.edges[path.edges[k - 1]]?.kind === 'transformer';
		if (!zones.length || transformer || next !== signature)
			zones.push({
				reason: !zones.length
					? 'Root-side zone'
					: transformer
						? 'Transformer boundary'
						: 'Voltage reference changes',
				rows: []
			});
		const [band] = rowEnvelopes(envelope, tree, [{ bus, pairs }]);
		zones[zones.length - 1].rows.push({ bus, step: k, pairs, envelope: band });
		signature = next;
	}
	return {
		target,
		root: path.buses[0],
		pathBuses: path.buses,
		zones,
		notice: start
			? `Showing the last ${MAX_PROFILE_POINTS} of ${path.buses.length} path buses.`
			: 'Branch steps are topology distance, not length. The path follows the display tree.'
	};
}
