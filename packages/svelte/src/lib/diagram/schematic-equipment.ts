import type { DistAttachmentKind, DistGraph } from '@tellegen/engine';
import type { SchematicGeometry } from './schematic-layout.js';

/** A stroked glyph: polylines in symbol units, x along the connection, y down. */
export type Glyph = [number, number][][];

const circle = (cx: number, cy: number, r: number, from = 0, to = 360, steps = 20) => {
	const out: [number, number][] = [];
	for (let i = 0; i <= steps; i++) {
		const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
		out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
	}
	return out;
};
const sine = (cx: number, cy: number, half: number, amp: number, steps = 12) =>
	Array.from({ length: steps + 1 }, (_, i): [number, number] => {
		const t = i / steps;
		return [cx - half + 2 * half * t, cy - amp * Math.sin(2 * Math.PI * t)];
	});

/** Branch glyphs, centred on the branch and spanning `±INLINE_HALF` along it, where the drawn line
 * is interrupted. Shapes follow the #177 specimens: a two-winding transformer as two overlapping
 * circles (no conductor continuity), a generic switch as a blade between two contacts, open when
 * the pole is open. A line has no glyph. */
export const INLINE_HALF = 1.4;
export function branchGlyph(kind: string, closed: boolean): Glyph | null {
	if (kind === 'transformer')
		return [
			[
				[-1.4, 0],
				[-1.15, 0]
			],
			circle(-0.45, 0, 0.7),
			circle(0.45, 0, 0.7),
			[
				[1.15, 0],
				[1.4, 0]
			]
		];
	if (kind === 'switch')
		return [
			[
				[-1.4, 0],
				[-1.05, 0]
			],
			circle(-0.9, 0, 0.15, 0, 360, 8),
			circle(0.9, 0, 0.15, 0, 360, 8),
			[
				[1.05, 0],
				[1.4, 0]
			],
			closed
				? [
						[-0.9, 0],
						[1.05, 0]
					]
				: [
						[-0.9, 0],
						[0.7, -0.85]
					]
		];
	return null;
}

/** Attachment glyphs, connected at the origin and extending along +x. A load is a demand arrow, a
 * generator a machine circle with a G, an external source an AC supply circle with a sinusoid, an
 * inverter-based resource a converter box (DC bar, diagonal, AC wave), and a shunt a general
 * admittance block: BMOPF shunts can be conductive, so no capacitor is asserted. */
export function attachmentGlyph(kind: DistAttachmentKind): Glyph {
	const lead: [number, number][] = [
		[0, 0],
		[0.4, 0]
	];
	switch (kind) {
		case 'load':
			return [
				[
					[0, 0],
					[0.6, 0]
				],
				[
					[0.6, -0.7],
					[1.8, 0],
					[0.6, 0.7],
					[0.6, -0.7]
				]
			];
		case 'generator':
			return [lead, circle(1.3, 0, 0.9), [...circle(1.3, 0, 0.45, -45, -360, 14), [1.4, 0]]];
		case 'source':
			return [lead, circle(1.3, 0, 0.9), sine(1.3, 0, 0.5, 0.3)];
		case 'ibr':
			return [
				lead,
				[
					[0.4, -0.9],
					[2.2, -0.9],
					[2.2, 0.9],
					[0.4, 0.9],
					[0.4, -0.9]
				],
				[
					[0.4, 0.9],
					[2.2, -0.9]
				],
				[
					[0.6, -0.5],
					[1.1, -0.5]
				],
				sine(1.75, 0.5, 0.3, 0.18, 8)
			];
		case 'shunt':
			return [
				lead,
				[
					[0.4, -0.9],
					[2.0, -0.9],
					[2.0, 0.9],
					[0.4, 0.9],
					[0.4, -0.9]
				],
				[
					[0.8, -0.4],
					[1.2, 0],
					[0.8, 0.4]
				],
				[
					[1.2, 0],
					[1.7, 0]
				]
			];
	}
}

/** Drawing order of attachment kinds below a bus. */
export const ATTACHMENT_ORDER: DistAttachmentKind[] = [
	'source',
	'generator',
	'ibr',
	'load',
	'shunt'
];
export const ATTACHMENT_NAMES: Record<DistAttachmentKind, string> = {
	source: 'source',
	generator: 'generator',
	ibr: 'inverter-based resource',
	load: 'load',
	shunt: 'shunt'
};

/** One symbol: what it stands for and where to pick it. */
export interface EquipmentItem {
	kind: DistAttachmentKind | 'transformer' | 'switch';
	/** Branch index for inline symbols, bus index for attachments. */
	edge: number;
	bus: number;
	ids: string[];
	x: number;
	y: number;
}

export interface EquipmentSymbols {
	/** Glyph strokes: `x, y, 0` per segment end. */
	sources: Float32Array;
	targets: Float32Array;
	items: EquipmentItem[];
	/** The geometry with each branch line interrupted where its symbol sits. */
	cut: SchematicGeometry;
	/** Symbol unit in drawing units: glyphs are about two units across. */
	unit: number;
	/** Kinds drawn, for the legend. */
	kinds: Set<EquipmentItem['kind']>;
}

function medianEdgeLength(geometry: SchematicGeometry): number {
	const lengths: number[] = [];
	for (let s = 0; s < geometry.segmentEdge.length; s++)
		lengths.push(
			Math.hypot(
				geometry.targets[s * 3] - geometry.sources[s * 3],
				geometry.targets[s * 3 + 1] - geometry.sources[s * 3 + 1]
			)
		);
	const positive = lengths.filter((l) => l > 0).sort((a, b) => a - b);
	return positive.length ? positive[positive.length >> 1] : 1;
}

/** Symbols for every branch and attachment of `graph` drawn on `geometry`.
 *
 * Inline symbols sit on the child-end segment of a tree route, a fixed distance from the child bus
 * so they line up in columns; other branches carry theirs at the middle of their middle segment.
 * Attachments hang from a riser below the bus, one slot per kind (the engine layout reserves that
 * room), each on a short tick with its count when there are several. */
export function schematicEquipment(
	graph: DistGraph,
	geometry: SchematicGeometry
): EquipmentSymbols {
	const engine = geometry.attachmentGap !== undefined && geometry.attachmentGap > 0;
	const gap = engine ? geometry.attachmentGap! : medianEdgeLength(geometry) * 0.25;
	const unit = gap * 0.4;
	const src: number[] = [];
	const dst: number[] = [];
	const items: EquipmentItem[] = [];
	const kinds = new Set<EquipmentItem['kind']>();
	const stroke = (glyph: Glyph, x: number, y: number, cos: number, sin: number) => {
		for (const line of glyph)
			for (let i = 1; i < line.length; i++) {
				const [ax, ay] = line[i - 1];
				const [bx, by] = line[i];
				src.push(x + unit * (ax * cos - ay * sin), y + unit * (ax * sin + ay * cos), 0);
				dst.push(x + unit * (bx * cos - by * sin), y + unit * (bx * sin + by * cos), 0);
			}
	};

	// Segments per edge, in order.
	const segs = new Map<number, number[]>();
	for (let s = 0; s < geometry.segmentEdge.length; s++) {
		const k = geometry.segmentEdge[s];
		const list = segs.get(k);
		if (list) list.push(s);
		else segs.set(k, [s]);
	}
	/** Per host segment: the interrupted interval as fractions along it. */
	const cuts = new Map<number, [number, number]>();
	const half = INLINE_HALF * unit;
	graph.edges.forEach((edge, k) => {
		const glyph = branchGlyph(edge.kind, edge.closed);
		const list = segs.get(k);
		if (!glyph || !list) return;
		const childEnd = engine && geometry.role[k] === 0;
		const s = childEnd ? list[list.length - 1] : list[list.length >> 1];
		const [x0, y0, x1, y1] = [
			geometry.sources[s * 3],
			geometry.sources[s * 3 + 1],
			geometry.targets[s * 3],
			geometry.targets[s * 3 + 1]
		];
		const len = Math.hypot(x1 - x0, y1 - y0);
		if (len < 2.4 * half) return;
		const cos = (x1 - x0) / len;
		const sin = (y1 - y0) / len;
		// From the child end: centre 2.5 half-widths back, clamped to the segment's middle.
		const along = childEnd ? Math.max(len / 2, len - 2.5 * half) : len / 2;
		const x = x0 + cos * along;
		const y = y0 + sin * along;
		stroke(glyph, x, y, cos, sin);
		cuts.set(s, [(along - half) / len, (along + half) / len]);
		items.push({
			kind: edge.kind as 'transformer' | 'switch',
			edge: k,
			bus: -1,
			ids: [edge.id],
			x,
			y
		});
		kinds.add(edge.kind as 'transformer' | 'switch');
	});

	graph.buses.forEach((bus, i) => {
		const byKind = new Map<DistAttachmentKind, Set<string>>();
		for (const list of Object.values(bus.terminal_attachments ?? {}))
			for (const a of list) {
				const ids = byKind.get(a.kind) ?? new Set<string>();
				ids.add(a.id);
				byKind.set(a.kind, ids);
			}
		if (!byKind.size) return;
		const [bx, by] = [geometry.positions[i * 3], geometry.positions[i * 3 + 1]];
		const present = ATTACHMENT_ORDER.filter((kind) => byKind.has(kind));
		// Riser from the bus down to the last slot.
		src.push(bx, by, 0);
		dst.push(bx, by + present.length * gap, 0);
		present.forEach((kind, slot) => {
			const y = by + (slot + 1) * gap;
			src.push(bx, y, 0);
			dst.push(bx + unit * 0.6, y, 0);
			stroke(attachmentGlyph(kind), bx + unit * 0.6, y, 1, 0);
			items.push({
				kind,
				edge: -1,
				bus: i,
				ids: [...byKind.get(kind)!],
				x: bx + unit * 1.8,
				y
			});
			kinds.add(kind);
		});
	});

	return {
		sources: Float32Array.from(src),
		targets: Float32Array.from(dst),
		items,
		cut: cuts.size ? interrupt(geometry, cuts) : geometry,
		unit,
		kinds
	};
}

/** A copy of `geometry` with each cut segment split around its interval; edge ownership is kept,
 * so picking either half selects the branch. */
function interrupt(
	geometry: SchematicGeometry,
	cuts: Map<number, [number, number]>
): SchematicGeometry {
	const m = geometry.segmentEdge.length + cuts.size;
	const sources = new Float32Array(m * 3);
	const targets = new Float32Array(m * 3);
	const segmentEdge = new Int32Array(m);
	let o = 0;
	const push = (k: number, a: number[], b: number[]) => {
		sources.set(a, o * 3);
		targets.set(b, o * 3);
		segmentEdge[o++] = k;
	};
	for (let s = 0; s < geometry.segmentEdge.length; s++) {
		const a = [geometry.sources[s * 3], geometry.sources[s * 3 + 1], 0];
		const b = [geometry.targets[s * 3], geometry.targets[s * 3 + 1], 0];
		const cut = cuts.get(s);
		const k = geometry.segmentEdge[s];
		if (!cut) {
			push(k, a, b);
			continue;
		}
		const at = (t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
		push(k, a, at(cut[0]));
		push(k, at(cut[1]), b);
	}
	return { ...geometry, sources, targets, segmentEdge };
}

/** An SVG path for a glyph in symbol units, for legends. */
export function glyphPath(glyph: Glyph, scale: number, dx = 0, dy = 0): string {
	const f = (v: number) => Math.round(v * 100) / 100;
	return glyph
		.map((line) =>
			line.map(([x, y], i) => `${i ? 'L' : 'M'}${f(dx + x * scale)} ${f(dy + y * scale)}`).join('')
		)
		.join(' ');
}
