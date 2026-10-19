import type { DistGraph } from '@tellegen/engine';
import type { DisplayTree } from './display-tree.js';
import type { ResultSnapshot } from './snapshot.js';
import type { SchematicGeometry } from './schematic-layout.js';
import { busState, loadingState } from './summary.js';

/** The part of the display tree below one transformer that holds no further transformer: on a
 * distribution feeder, an LV area. Zoomed out, the schematic draws each as one box with its worst
 * state instead of an illegible cluster of buses. */
export interface LvArea {
	/** The transformer edge feeding the area, which stays drawn. */
	transformer: number;
	/** The bus on the transformer's far side. */
	root: number;
	buses: number[];
	/** Branches inside the area: tree edges below the root and links with both ends inside. */
	edges: number[];
}

export interface LvAreas {
	areas: LvArea[];
	/** Per bus and per edge: the area index, or −1. */
	busArea: Int32Array;
	edgeArea: Int32Array;
}

/** Innermost transformer subtrees of at least `minBuses` buses. */
export function lvAreas(graph: DistGraph, tree: DisplayTree, minBuses = 3): LvAreas {
	const n = graph.buses.length;
	const children: number[][] = Array.from({ length: n }, () => []);
	for (let i = 0; i < n; i++) if (tree.parent[i] !== i) children[tree.parent[i]].push(i);
	const viaTransformer = (i: number) =>
		tree.parentEdge[i] >= 0 && graph.edges[tree.parentEdge[i]].kind === 'transformer';
	const busArea = new Int32Array(n).fill(-1);
	const edgeArea = new Int32Array(graph.edges.length).fill(-1);
	const areas: LvArea[] = [];
	for (let root = 0; root < n; root++) {
		if (!viaTransformer(root)) continue;
		const buses: number[] = [];
		const stack = [root];
		let nested = false;
		while (stack.length && !nested) {
			const i = stack.pop()!;
			buses.push(i);
			for (const c of children[i]) {
				if (viaTransformer(c)) nested = true;
				stack.push(c);
			}
		}
		if (nested || buses.length < minBuses) continue;
		const a = areas.length;
		for (const i of buses) {
			busArea[i] = a;
			if (i !== root) edgeArea[tree.parentEdge[i]] = a;
		}
		areas.push({ transformer: tree.parentEdge[root], root, buses, edges: [] });
	}
	const index = new Map(graph.buses.map((b, i) => [b.id.toLowerCase(), i]));
	graph.edges.forEach((e, k) => {
		const a = busArea[index.get(e.from.toLowerCase()) ?? -1] ?? -1;
		const b = busArea[index.get(e.to.toLowerCase()) ?? -1] ?? -1;
		if (edgeArea[k] < 0 && a >= 0 && a === b) edgeArea[k] = a;
		if (edgeArea[k] >= 0) areas[edgeArea[k]].edges.push(k);
	});
	return { areas, busArea, edgeArea };
}

export type AreaState = 'normal' | 'warning' | 'violation' | 'missing';

/** An area's worst state: a voltage outside its band or a branch over its rating is a violation,
 * loading at or above the warning threshold a warning. The feeding transformer counts. */
export function areaState(area: LvArea, snapshot: ResultSnapshot | null): AreaState {
	if (!snapshot) return 'missing';
	let state: AreaState = 'missing';
	const raise = (s: AreaState) => {
		const rank = { missing: 0, normal: 1, warning: 2, violation: 3 };
		if (rank[s] > rank[state]) state = s;
	};
	for (const i of area.buses) {
		const s = busState(snapshot.buses[i]);
		raise(s === 'violation' ? 'violation' : s === 'normal' ? 'normal' : 'missing');
	}
	for (const k of [area.transformer, ...area.edges]) {
		const s = loadingState(snapshot.branches[k]?.loading ?? null);
		if (s !== 'missing') raise(s);
	}
	return state;
}

/** Bounding box `[x0, y0, x1, y1]` of an area's buses, padded by `pad`. */
export function areaBox(
	area: LvArea,
	positions: ArrayLike<number>,
	pad: number
): [number, number, number, number] {
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const i of area.buses) {
		const x = positions[i * 3];
		const y = positions[i * 3 + 1];
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	}
	return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** `geometry` without the segments of edges inside an area, for the collapsed view. */
export function outsideAreas(geometry: SchematicGeometry, edgeArea: Int32Array): SchematicGeometry {
	const keep: number[] = [];
	for (let s = 0; s < geometry.segmentEdge.length; s++)
		if (edgeArea[geometry.segmentEdge[s]] < 0) keep.push(s);
	if (keep.length === geometry.segmentEdge.length) return geometry;
	const sources = new Float32Array(keep.length * 3);
	const targets = new Float32Array(keep.length * 3);
	keep.forEach((s, o) => {
		sources.set(geometry.sources.subarray(s * 3, s * 3 + 3), o * 3);
		targets.set(geometry.targets.subarray(s * 3, s * 3 + 3), o * 3);
	});
	return {
		...geometry,
		sources,
		targets,
		segmentEdge: Int32Array.from(keep, (s) => geometry.segmentEdge[s])
	};
}
