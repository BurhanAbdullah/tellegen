import type { DistGraph } from '@tellegen/engine';
import type { DisplayTree } from './display-tree.js';
import type { ResultSnapshot } from './snapshot.js';
import { busState, loadingState } from './summary.js';

/** A galvanic zone: buses joined by lines and closed switches, separated from the rest only by
 * transformers. On a distribution feeder the zones without a source are the LV networks. */
export interface GalvanicZone {
	buses: number[];
	/** Branches inside the zone. */
	edges: number[];
	/** Transformers with a winding in the zone; the feeding one first when the display tree has it. */
	transformers: number[];
	hasSource: boolean;
}

export interface GalvanicZones {
	zones: GalvanicZone[];
	/** Zone index per bus. */
	busZone: Int32Array;
}

/** Connected components over closed non-transformer branches. */
export function galvanicZones(graph: DistGraph, tree?: DisplayTree): GalvanicZones {
	const n = graph.buses.length;
	const index = new Map(graph.buses.map((b, i) => [b.id.toLowerCase(), i]));
	const ends = graph.edges.map(
		(e) =>
			[index.get(e.from.toLowerCase()) ?? -1, index.get(e.to.toLowerCase()) ?? -1] as [
				number,
				number
			]
	);
	const root = Int32Array.from({ length: n }, (_, i) => i);
	const find = (i: number): number => {
		while (root[i] !== i) i = root[i] = root[root[i]];
		return i;
	};
	graph.edges.forEach((e, k) => {
		const [a, b] = ends[k];
		if (a < 0 || b < 0 || !e.closed || e.kind === 'transformer') return;
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) root[ra] = rb;
	});
	const busZone = new Int32Array(n).fill(-1);
	const zones: GalvanicZone[] = [];
	for (let i = 0; i < n; i++) {
		const r = find(i);
		if (busZone[r] < 0) {
			busZone[r] = zones.length;
			zones.push({ buses: [], edges: [], transformers: [], hasSource: false });
		}
		busZone[i] = busZone[r];
		const z = zones[busZone[i]];
		z.buses.push(i);
		if (graph.buses[i].has_source) z.hasSource = true;
	}
	graph.edges.forEach((e, k) => {
		const [a, b] = ends[k];
		if (a < 0 || b < 0) return;
		if (e.kind === 'transformer') {
			for (const z of new Set([busZone[a], busZone[b]])) zones[z].transformers.push(k);
		} else if (busZone[a] === busZone[b]) zones[busZone[a]].edges.push(k);
	});
	// The feeding transformer is the one the display tree enters the zone through.
	if (tree)
		for (const z of zones) {
			const feed = z.buses
				.map((i) => tree.parentEdge[i])
				.find((k) => k >= 0 && graph.edges[k].kind === 'transformer');
			if (feed !== undefined) z.transformers = [feed, ...z.transformers.filter((k) => k !== feed)];
		}
	return { zones, busZone };
}

export type ZoneState = 'normal' | 'warning' | 'violation' | 'missing';

/** A zone's worst state: a voltage outside its band or a branch over its rating is a violation,
 * loading at or above the warning threshold a warning. Its transformers count. */
export function zoneState(zone: GalvanicZone, snapshot: ResultSnapshot | null): ZoneState {
	if (!snapshot) return 'missing';
	const rank = { missing: 0, normal: 1, warning: 2, violation: 3 };
	let state: ZoneState = 'missing';
	const raise = (s: ZoneState) => {
		if (rank[s] > rank[state]) state = s;
	};
	for (const i of zone.buses) {
		const s = busState(snapshot.buses[i]);
		raise(s === 'violation' ? 'violation' : s === 'normal' ? 'normal' : 'missing');
	}
	for (const k of [...zone.transformers, ...zone.edges]) {
		const s = loadingState(snapshot.branches[k]?.loading ?? null);
		if (s !== 'missing') raise(s);
	}
	return state;
}

/** The outline of a zone in a schematic layout: one band per drawing column (depth), from the
 * zone's highest bus to the lowest attachment symbol below it, joined into a staircase. Tidy and
 * leaf-order layouts keep each subtree's rows contiguous per column, so neighbouring zones'
 * outlines do not overlap; a zone nested inside another sits inside its outline. */
export function zoneOutline(
	zone: GalvanicZone,
	positions: ArrayLike<number>,
	below: ArrayLike<number>,
	options: { dx: number; pad: number }
): [number, number][] {
	const columns = new Map<number, [number, number]>();
	for (const i of zone.buses) {
		const x = positions[i * 3];
		const y = positions[i * 3 + 1];
		const c = columns.get(x);
		if (c) {
			c[0] = Math.min(c[0], y);
			c[1] = Math.max(c[1], y + below[i]);
		} else columns.set(x, [y, y + below[i]]);
	}
	const xs = [...columns.keys()].sort((a, b) => a - b);
	const { dx, pad } = options;
	// The first column starts just after the feeding transformer's symbol; the last leaves room
	// for attachment symbols and their values to the right of the bus.
	const left = (j: number) => (j === 0 ? xs[0] - 0.15 * dx : (xs[j - 1] + xs[j]) / 2);
	const right = (j: number) => (j === xs.length - 1 ? xs[j] + 0.4 * dx : (xs[j] + xs[j + 1]) / 2);
	const top: [number, number][] = [];
	const bottom: [number, number][] = [];
	xs.forEach((x, j) => {
		const [lo, hi] = columns.get(x)!;
		top.push([left(j), lo - pad], [right(j), lo - pad]);
		bottom.push([left(j), hi + pad], [right(j), hi + pad]);
	});
	return [...top, ...bottom.reverse()];
}

/** Convex hull of a zone's buses, for source positions where columns mean nothing. */
export function zoneHull(zone: GalvanicZone, positions: ArrayLike<number>): [number, number][] {
	const points = zone.buses
		.map((i): [number, number] => [positions[i * 3], positions[i * 3 + 1]])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (points.length < 3) return points;
	const cross = (o: number[], a: number[], b: number[]) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const half = (list: [number, number][]) => {
		const out: [number, number][] = [];
		for (const p of list) {
			while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
			out.push(p);
		}
		out.pop();
		return out;
	};
	return [...half(points), ...half([...points].reverse())];
}
