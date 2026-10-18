import type { DistGraph } from '@tellegen/engine';
import type { DisplayTree } from './display-tree.js';

/** Drawing geometry for one layout: bus positions and branch segments (several per routed edge). */
export interface SchematicGeometry {
	/** `x, y, 0` per bus in graph order; y grows downwards. */
	positions: Float32Array;
	sources: Float32Array;
	targets: Float32Array;
	/** Edge index (graph order) for each segment. */
	segmentEdge: Int32Array;
	/** Per edge: 0 tree route, 1 closed non-tree link, 2 open or unreachable. */
	role: Uint8Array;
	bounds: [number, number, number, number];
}

function segments(
	graph: DistGraph,
	positions: Float32Array,
	index: (id: string) => number,
	route: (edge: number, a: number, b: number) => number[][] | null
): Omit<SchematicGeometry, 'positions' | 'bounds' | 'role'> {
	const src: number[] = [];
	const dst: number[] = [];
	const owner: number[] = [];
	graph.edges.forEach((e, k) => {
		const a = index(e.from);
		const b = index(e.to);
		if (a < 0 || b < 0) return;
		const points = route(k, a, b) ?? [
			[positions[a * 3], positions[a * 3 + 1]],
			[positions[b * 3], positions[b * 3 + 1]]
		];
		for (let i = 1; i < points.length; i++) {
			src.push(points[i - 1][0], points[i - 1][1], 0);
			dst.push(points[i][0], points[i][1], 0);
			owner.push(k);
		}
	});
	return {
		sources: Float32Array.from(src),
		targets: Float32Array.from(dst),
		segmentEdge: Int32Array.from(owner)
	};
}

function bounds(positions: Float32Array): [number, number, number, number] {
	let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i += 3) {
		x0 = Math.min(x0, positions[i]);
		x1 = Math.max(x1, positions[i]);
		y0 = Math.min(y0, positions[i + 1]);
		y1 = Math.max(y1, positions[i + 1]);
	}
	return Number.isFinite(x0) ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

const indexer = (graph: DistGraph) => {
	const map = new Map(graph.buses.map((b, i) => [b.id.toLowerCase(), i]));
	return (id: string) => map.get(id.toLowerCase()) ?? -1;
};

/** Leaf-order schematic: depth runs left to right, every leaf gets its own row and each parent sits
 * at the middle of its children. Tree edges route as orthogonal elbows; closed non-tree links and
 * open branches are drawn straight so they read as exceptions, never as tree routes. */
export function leafOrderLayout(
	graph: DistGraph,
	tree: DisplayTree,
	{ dx = 120, dy = 28 } = {}
): SchematicGeometry {
	const n = graph.buses.length;
	const children: number[][] = Array.from({ length: n }, () => []);
	for (let i = 0; i < n; i++) if (tree.parent[i] !== i) children[tree.parent[i]].push(i);
	const positions = new Float32Array(n * 3);
	let row = 0;
	for (const root of tree.roots) {
		// Iterative post-order so deep feeders do not overflow the stack.
		const stack: [number, number][] = [[root, 0]];
		while (stack.length) {
			const top = stack[stack.length - 1];
			const [u, next] = top;
			if (next < children[u].length) {
				top[1]++;
				stack.push([children[u][next], 0]);
				continue;
			}
			stack.pop();
			const kids = children[u];
			positions[u * 3] = tree.depth[u] * dx;
			positions[u * 3 + 1] = kids.length
				? (positions[kids[0] * 3 + 1] + positions[kids[kids.length - 1] * 3 + 1]) / 2
				: row++ * dy;
		}
		row++; // A blank row between components.
	}
	const index = indexer(graph);
	const role = new Uint8Array(graph.edges.length);
	graph.edges.forEach((e, k) => {
		const a = index(e.from);
		const b = index(e.to);
		const treeEdge = a >= 0 && b >= 0 && (tree.parentEdge[a] === k || tree.parentEdge[b] === k);
		role[k] = !e.closed || a < 0 || b < 0 ? 2 : treeEdge ? 0 : 1;
	});
	const geometry = segments(graph, positions, index, (k, a, b) => {
		if (role[k] !== 0) return null;
		const [p, c] = tree.parent[b] === a ? [a, b] : [b, a];
		const [xp, yp, xc, yc] = [
			positions[p * 3],
			positions[p * 3 + 1],
			positions[c * 3],
			positions[c * 3 + 1]
		];
		const xm = xp + dx / 2;
		return yp === yc
			? [
					[xp, yp],
					[xc, yc]
				]
			: [
					[xp, yp],
					[xm, yp],
					[xm, yc],
					[xc, yc]
				];
	});
	return { positions, ...geometry, role, bounds: bounds(positions) };
}

/** Positions as placed in the source data: geographic longitude/latitude projected to Web Mercator
 * metres (y down), or planar drawing coordinates as given, relative to their centroid. Branches are
 * drawn straight. */
export function sourceLayout(
	graph: DistGraph,
	placed: { id: string; lon: number; lat: number }[],
	geographic: boolean,
	tree: DisplayTree
): SchematicGeometry {
	const R = 6_378_137;
	const byId = new Map(placed.map((b) => [b.id.toLowerCase(), b]));
	// Project in float64 and store relative to the centroid: absolute Web Mercator metres reach 1e7,
	// where float32 resolves only to about a metre and neighbouring LV buses would collapse.
	const xy = graph.buses.map((b) => {
		const p = byId.get(b.id.toLowerCase());
		if (!p) return null;
		if (!geographic) return [p.lon, -p.lat];
		const lat = Math.max(-85, Math.min(85, p.lat));
		return [
			(R * p.lon * Math.PI) / 180,
			-R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
		];
	});
	const known = xy.filter((p): p is number[] => p !== null);
	const cx = known.reduce((s, p) => s + p[0], 0) / Math.max(1, known.length);
	const cy = known.reduce((s, p) => s + p[1], 0) / Math.max(1, known.length);
	const positions = new Float32Array(graph.buses.length * 3);
	xy.forEach((p, i) => {
		if (!p) return;
		positions[i * 3] = p[0] - cx;
		positions[i * 3 + 1] = p[1] - cy;
	});
	const index = indexer(graph);
	const role = new Uint8Array(graph.edges.length);
	graph.edges.forEach((e, k) => {
		const a = index(e.from);
		const b = index(e.to);
		role[k] =
			!e.closed || a < 0 || b < 0
				? 2
				: tree.parentEdge[a] === k || tree.parentEdge[b] === k
					? 0
					: 1;
	});
	return {
		positions,
		...segments(graph, positions, index, () => null),
		role,
		bounds: bounds(positions)
	};
}
