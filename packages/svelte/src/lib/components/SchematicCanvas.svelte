<script lang="ts">
	import type {
		Deck,
		Layer,
		OrthographicView,
		OrthographicViewState,
		PickingInfo
	} from '@deck.gl/core';
	import { untrack } from 'svelte';
	import { mcSchematicLayout, type SchematicStrategy } from '@tellegen/engine';
	import type { MulticonductorCase } from '../state.svelte.js';
	import type { RGBA } from '../colors.js';
	import { priceGradient, sensGradient } from '../colors.js';
	import { edgeColor } from '../multiconductor.js';
	import { getPanelLayout } from '../panels.svelte.js';
	import { getAppState } from '../context.svelte.js';
	import {
		bandColour,
		branchLabel,
		busLabel,
		chordsInto,
		displayTree,
		ease,
		fitText,
		graphInputs,
		diagramLayer,
		EMPTY_GEOMETRY,
		fromEngineLayout,
		lerpInto,
		loadingColour,
		MISSING_COLOUR,
		MORPH_MAX_BUSES,
		MORPH_MS,
		placeLabels,
		screenAnchored,
		snapshotFromMcPf,
		sourceLayout,
		TITLE_BLOCK_HEIGHT,
		titleBlock,
		viewportSvg,
		worstBand,
		attachmentGlyph,
		ATTACHMENT_NAMES,
		bandPosition,
		describeBus,
		treeWalk,
		type WalkKey,
		BASEMAP_ATTRIBUTION,
		BASEMAP_STYLE,
		basemapCamera,
		cameraFromMap,
		fanRoute,
		routeMiddle,
		type FannedBranch,
		galvanicZones,
		landmarkCandidates,
		landmarkGlyph,
		landmarkStrokes,
		placeLandmarks,
		type Landmark,
		zoneLevel,
		zoneSummary,
		zoneVoltage,
		zoneHull,
		zoneOutline,
		zoneState,
		type GalvanicZone,
		type ZoneState,
		conductorSet,
		conductorTicks,
		elementPowers,
		flowArrows,
		formatPower,
		energisation,
		shortNames,
		branchGlyph,
		glyphPath,
		schematicEquipment,
		type EquipmentItem,
		type Glyph,
		type LabelCandidate,
		type SchematicGeometry
	} from '../diagram/index.js';

	let {
		mc,
		onselectbus,
		onselectedge,
		onclose
	}: {
		mc: MulticonductorCase;
		onselectbus: (id: string) => void;
		onselectedge: (id: string) => void;
		onclose: () => void;
	} = $props();

	type Layout = 'schematic' | 'source';
	type Colour = 'none' | 'voltage-band' | 'loading-heat';
	const COLOURS: Record<Colour, string> = {
		none: 'Equipment and topology',
		'voltage-band': 'Voltage within declared band',
		'loading-heat': 'Loading, % of rating'
	};
	const app = getAppState();
	const panels = getPanelLayout();
	const INK: RGBA = [32, 36, 43, 255];
	const ACCENT: RGBA = [178, 94, 0, 255];
	const PAPER: RGBA = [252, 251, 247, 255];
	const DANGER: RGBA = [184, 50, 42, 255];
	const WARNING: RGBA = [178, 94, 0, 255];

	let layout = $state<Layout>('schematic');
	let strategy = $state<SchematicStrategy>('tidy');
	/** The geometry on screen; replaced by `show`, which animates between layouts. */
	let shown = $state.raw<SchematicGeometry | null>(null);
	let colour = $state<Colour>('none');
	let width = $state(0);
	let height = $state(0);
	let canvas = $state<HTMLCanvasElement>();
	let deck = $state.raw<Deck<OrthographicView> | null>(null);
	let modules: {
		core: typeof import('@deck.gl/core');
		layers: typeof import('@deck.gl/layers');
	} | null = null;
	let camera = $state.raw<{ target: [number, number, number]; zoom: number }>({
		target: [0, 0, 0],
		zoom: 0
	});
	let labels = $state.raw<(LabelCandidate & { position: [number, number] })[]>([]);
	/** Map tiles under geographic positions, as for the main map; they fade in and out with the
	 * layout switch. While fading out they stay pinned to the screen as the camera moves on. */
	const BASEMAP_STORAGE = 'tellegen.schematic.basemap';
	let basemapOn = $state(
		(() => {
			try {
				return localStorage.getItem(BASEMAP_STORAGE) !== 'off';
			} catch {
				return true;
			}
		})()
	);
	function rememberBasemap(on: boolean) {
		basemapOn = on;
		try {
			localStorage.setItem(BASEMAP_STORAGE, on ? 'on' : 'off');
		} catch {
			// Storage can be unavailable; the toggle still works for this view.
		}
	}
	let basemapOpacity = $state(0);
	const BASEMAP_FADE_MS = 700;
	let mapBox = $state<HTMLDivElement>();
	let basemap: import('maplibre-gl').Map | null = null;
	let basemapLoading = false;
	/** Landmarks placed for the current view, with their fixed-pixel glyph strokes. */
	let marks = $state.raw<{
		placed: Landmark[];
		strokes: { sources: Float32Array; targets: Float32Array; owner: Int32Array };
	} | null>(null);
	let status = $state<string | null>('Loading the schematic renderer…');

	const graph = $derived(mc.graph!);
	const tree = $derived(displayTree(graph));
	const inputs = $derived(graphInputs(graph));
	const source = $derived(
		mc.view
			? sourceLayout(graph, mc.view.buses, mc.coordsKind === 'geographic', tree, mc.view.edges)
			: null
	);
	const geometry = $derived<SchematicGeometry>(shown ?? EMPTY_GEOMETRY);
	const basemapWanted = $derived(
		basemapOn && layout === 'source' && mc.coordsKind === 'geographic' && !!source?.mercatorOrigin
	);
	let fadeFrame = 0;
	$effect(() => {
		const target = basemapWanted ? 1 : 0;
		untrack(() => {
			cancelAnimationFrame(fadeFrame);
			const start = basemapOpacity;
			if (start === target) return;
			if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
				basemapOpacity = target;
				return;
			}
			const t0 = performance.now();
			const step = (now: number) => {
				const k = Math.min(1, (now - t0) / BASEMAP_FADE_MS);
				basemapOpacity = start + (target - start) * ease(k);
				if (k < 1) fadeFrame = requestAnimationFrame(step);
			};
			fadeFrame = requestAnimationFrame(step);
		});
	});

	// The basemap map is created the first time it is wanted, and follows the schematic camera only
	// while wanted: fading out, it stays where it was on screen as the drawing moves to its new layout.
	$effect(() => {
		if (!basemapWanted || !mapBox || basemap || basemapLoading) return;
		basemapLoading = true;
		const container = mapBox;
		Promise.all([
			import('maplibre-gl'),
			import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url')
		])
			.then(([maplibre, worker]) => {
				maplibre.setWorkerUrl(worker.default);
				const origin = source?.mercatorOrigin ?? [0, 0];
				basemap = new maplibre.Map({
					container,
					style: BASEMAP_STYLE,
					interactive: false,
					attributionControl: false,
					...basemapCamera(camera, origin)
				});
			})
			.catch(() => {
				basemapLoading = false;
			});
	});
	$effect(() => {
		const origin = source?.mercatorOrigin;
		void [width, height];
		if (!basemapWanted || !origin) return;
		const view = basemapCamera(camera, origin);
		untrack(() => {
			basemap?.resize();
			basemap?.jumpTo(view);
		});
	});
	$effect(() => () => basemap?.remove());
	const powers = $derived(mc.overviewResult ? elementPowers(mc.overviewResult) : null);
	const snapshot = $derived(
		mc.overviewResult ? snapshotFromMcPf(mc.overviewResult, inputs.buses, inputs.branches) : null
	);
	/** Equipment symbols on the shown layout: branch symbols interrupt their line. */
	const equipment = $derived(shown ? schematicEquipment(graph, shown) : null);
	/** Symbols draw once they are legible (a glyph about 6 px across); below that the plain lines
	 * and their kind colours carry the topology. */
	const symbolsOn = $derived(!!equipment && equipment.unit * 2 ** camera.zoom >= 3);
	/** The branch geometry as drawn, interrupted under symbols when they show. */
	const drawn = $derived<SchematicGeometry>(symbolsOn && equipment ? equipment.cut : geometry);
	/** Galvanic zones: buses joined without passing a transformer. Those without a source (the LV
	 * networks of a feeder) get a translucent outline tinted by their worst state. */
	const zones = $derived(galvanicZones(graph, tree));
	const zoneStates = $derived(zones.zones.map((z) => zoneState(z, snapshot)));
	const zoneShapes = $derived.by(() => {
		if (!shown) return [];
		const g = shown;
		const engine = !!g.attachmentGap;
		// Column spacing of the engine layout: any tree edge spans exactly one column.
		let dx = 0;
		for (let i = 0; i < graph.buses.length && !dx; i++)
			if (tree.parent[i] !== i) dx = Math.abs(g.positions[i * 3] - g.positions[tree.parent[i] * 3]);
		const gap = g.attachmentGap ?? 0;
		const below = graph.buses.map((b) => {
			const kinds = new Set(
				Object.values(b.terminal_attachments ?? {}).flatMap((list) => list.map((a) => a.kind))
			);
			return kinds.size * gap;
		});
		return zones.zones.flatMap((zone, z) => {
			if (zone.hasSource || zone.buses.length < 2) return [];
			const polygon =
				engine && dx > 0
					? zoneOutline(zone, g.positions, below, { dx, pad: gap * 0.5 })
					: zoneHull(zone, g.positions);
			return polygon.length >= 3 ? [{ z, polygon }] : [];
		});
	});
	const ZONE_COLOURS: Record<ZoneState, [RGBA, RGBA]> = {
		missing: [
			[70, 110, 150, 16],
			[70, 110, 150, 90]
		],
		normal: [
			[70, 110, 150, 16],
			[70, 110, 150, 90]
		],
		warning: [
			[178, 94, 0, 30],
			[178, 94, 0, 170]
		],
		violation: [
			[184, 50, 42, 34],
			[184, 50, 42, 190]
		]
	};
	/** MV (from 1 kV phase–phase) is drawn heavier than LV, as on a paper single-line diagram; a
	 * transformer takes its higher side. */
	const zoneMv = $derived(
		zones.zones.map((z) => zoneLevel(z, zoneVoltage(z, graph, snapshot)) === 'mv')
	);
	const edgeMv = $derived(
		Uint8Array.from(graph.edges, (e, k) => {
			const { from, to } = inputs.names.branches[k];
			const mv = (i: number) => (i >= 0 ? zoneMv[zones.busZone[i]] : false);
			return mv(from) || (e.kind === 'transformer' && mv(to)) ? 1 : 0;
		})
	);
	/** Zoomed out, LV detail fades so the MV backbone, zone outlines and states read first. */
	const zoomedOut = $derived(!symbolsOn);
	const mvBuses = $derived(graph.buses.flatMap((_, i) => (zoneMv[zones.busZone[i]] ? [i] : [])));
	const allBuses = $derived(graph.buses.map((_, i) => i));
	/** Landmark strokes in ink; a transformer whose network has a problem takes that state's colour. */
	function landmarkColours(m: { placed: Landmark[]; strokes: { owner: Int32Array } }): Uint8Array {
		const out = new Uint8Array(m.strokes.owner.length * 4);
		for (let s = 0; s < m.strokes.owner.length; s++) {
			const l = m.placed[m.strokes.owner[s]];
			out.set(l.state === 'violation' ? DANGER : l.state === 'warning' ? WARNING : INK, s * 4);
		}
		return out;
	}
	function segmentWidths(g: SchematicGeometry): Float32Array {
		const [mv, lv] = colour === 'none' ? [2.4, 1.1] : [3, 1.8];
		return Float32Array.from(g.segmentEdge, (k) => (edgeMv[k] ? mv : lv));
	}
	const transformerNames = $derived.by(() => {
		const ks = graph.edges.flatMap((e, k) => (e.kind === 'transformer' ? [k] : []));
		const short = shortNames(
			ks.map((k) => graph.edges[k].id),
			16
		);
		return new Map(ks.map((k, j) => [k, short[j]]));
	});
	/** Zone tags at each outline's top-left: feeding transformer, size, and when solved the
	 * lowest voltage and highest loading. Drawn once the outline is wide enough on screen. */
	const zoneTags = $derived(
		zoneShapes.map(({ z, polygon }) => {
			const zone = zones.zones[z];
			const t = zone.transformers[0];
			const { minVolts, maxLoading } = zoneSummary(zone, snapshot);
			const xs = polygon.map((p) => p[0]);
			const ys = polygon.map((p) => p[1]);
			const v = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} kV` : `${x.toFixed(1)} V`);
			const text = [
				t === undefined ? 'network' : (transformerNames.get(t) ?? graph.edges[t].id),
				`${zone.buses.length} buses`,
				...(minVolts === null ? [] : [`min ${v(minVolts)}`]),
				...(maxLoading === null ? [] : [`${maxLoading.toFixed(0)} %`])
			].join(' · ');
			return {
				z,
				text,
				position: [Math.min(...xs), Math.min(...ys)] as [number, number],
				width: Math.max(...xs) - Math.min(...xs)
			};
		})
	);
	/** Sources, generators, IBRs and transformers stay findable when zoomed out: drawn at a fixed
	 * screen size and placed by priority (see `landmarks.ts`), handing over to the full symbols as
	 * the drawing grows. */
	const LANDMARKS_STORAGE = 'tellegen.schematic.landmarks';
	let landmarksOn = $state(
		(() => {
			try {
				return localStorage.getItem(LANDMARKS_STORAGE) !== 'off';
			} catch {
				return true;
			}
		})()
	);
	function rememberLandmarks(on: boolean) {
		landmarksOn = on;
		try {
			localStorage.setItem(LANDMARKS_STORAGE, on ? 'on' : 'off');
		} catch {
			// Storage can be unavailable; the toggle still works for this view.
		}
	}
	const landmarkPool = $derived(
		shown ? landmarkCandidates(graph, shown, equipment, zones, zoneStates, powers) : []
	);
	const markName = $derived.by(() => {
		const ids = [...new Set(landmarkPool.flatMap((l) => (l.kind === 'transformer' ? [] : l.ids)))];
		const short = shortNames(ids, 16);
		return new Map(ids.map((id, j) => [id, short[j]]));
	});
	function landmarkTip(l: Landmark): string {
		const name = {
			source: 'source',
			generator: 'generator',
			ibr: 'inverter-based resource',
			transformer: 'transformer'
		}[l.kind];
		const ids = l.ids.slice(0, 4).join(', ') + (l.ids.length > 4 ? ` +${l.ids.length - 4}` : '');
		const where = l.bus >= 0 ? ` at ${graph.buses[l.bus].id}` : '';
		return `${l.ids.length > 1 ? `${l.ids.length} ${name}s` : name} ${ids}${where}`;
	}
	/** Zoom in quarter steps: zone tags appear and go only when this changes, not on every pan. */
	const tagZoom = $derived(Math.floor(camera.zoom * 4) / 4);
	function zoneLabel(z: number): string {
		const zone = zones.zones[z];
		const t = zone.transformers[0];
		const state = zoneStates[z];
		const verdict =
			state === 'violation'
				? 'a limit is violated'
				: state === 'warning'
					? 'a branch is near its rating'
					: state === 'normal'
						? 'within limits'
						: 'no result';
		const fed =
			t === undefined ? 'Network' : `Network fed by ${graph.edges[t].kind} ${graph.edges[t].id}`;
		return `${fed}: ${zone.buses.length} buses, ${verdict}`;
	}
	/** Conductor marks need a closer view than symbols; bus names closer still. */
	const ticksOn = $derived(!!equipment && equipment.unit * 2 ** camera.zoom >= 6);
	const namesOn = $derived(!!equipment && equipment.unit * 2 ** camera.zoom >= 9);
	/** Solved values beside symbols and flow arrows on branches, once there is room for them. */
	const valuesOn = $derived(!!snapshot && ticksOn);
	const arrows = $derived(
		equipment && snapshot
			? flowArrows(
					equipment,
					snapshot.branches.map((b) => b.ends),
					graph.edges.map((e) => e.closed)
				)
			: null
	);
	/** An attachment's text: its count when several, and its solved P and Q when values show.
	 * Generators, IBRs and sources read as output; loads and shunts as consumption. */
	function itemText(d: EquipmentItem): string {
		const parts = d.ids.length > 1 ? [`×${d.ids.length}`] : [];
		if (valuesOn && powers) {
			let p = 0;
			let q = 0;
			let found = false;
			for (const id of d.ids) {
				const row = powers.get(id);
				if (!row) continue;
				p += row.p;
				q += row.q;
				found = true;
			}
			const output = d.kind === 'generator' || d.kind === 'ibr' || d.kind === 'source';
			// Below 1 VA (an earthing shunt, say) the value is noise, not information.
			if (found && Math.hypot(p, q) >= 1)
				parts.push(output ? formatPower(-p, -q) : formatPower(p, q));
		}
		return parts.join(' ');
	}
	const SYMBOL_INK: RGBA = [52, 56, 62, 255];
	/** Not connected to any source through closed branches: drawn faint in every colour mode. */
	const DEAD: RGBA = [196, 191, 182, 110];
	const live = $derived(energisation(graph));
	const names = $derived(shortNames(graph.buses.map((b) => b.id)));
	/** Whether the symbol key is expanded; remembered per viewer. */
	const KEY_STORAGE = 'tellegen.schematic.key';
	let keyOpen = $state(
		(() => {
			try {
				return localStorage.getItem(KEY_STORAGE) !== 'closed';
			} catch {
				return true;
			}
		})()
	);
	function rememberKey(open: boolean) {
		keyOpen = open;
		try {
			localStorage.setItem(KEY_STORAGE, open ? 'open' : 'closed');
		} catch {
			// Storage can be unavailable (private windows); the key still toggles.
		}
	}
	/** Keyboard cursor: the bus the arrow keys walk from, distinct from the selection. */
	let cursor = $state(-1);
	let announcement = $state('');
	const walk = $derived(treeWalk(tree, geometry.positions));
	function voltageNote(i: number): string | null {
		const pairs = snapshot?.buses[i]?.pairs ?? [];
		if (!pairs.length) return null;
		const worst = pairs.reduce((a, b) =>
			Math.abs(bandPosition(b) ?? 0) > Math.abs(bandPosition(a) ?? 0) ? b : a
		);
		const t = bandPosition(worst);
		const v = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(3)} kV` : `${x.toFixed(1)} V`);
		const band =
			worst.min !== null && worst.max !== null
				? `, ${t !== null && Math.abs(t) > 1 ? 'outside' : 'within'} ${v(worst.min)} to ${v(worst.max)}`
				: '';
		return `Worst voltage ${worst.pair.join('–')} ${v(worst.volts)}${band}`;
	}
	// A new graph invalidates the cursor's bus index.
	$effect(() => {
		void graph;
		untrack(() => {
			cursor = -1;
			announcement = '';
		});
	});
	/** Shared-route member chosen with Tab at the cursor bus (−1 for none). */
	let tabEdge = -1;
	function moveCursor(to: number) {
		if (to < 0) return;
		tabEdge = -1;
		cursor = to;
		announcement = describeBus(graph, tree, walk, to, voltageNote(to));
		bringIntoView([geometry.positions[to * 3], geometry.positions[to * 3 + 1]]);
	}
	// Shared routes: branches drawn along exactly the same segment (MV and LV on shared poles).
	// At rest the route carries a count badge; hovering it fans its members apart by a few pixels,
	// tapering into the shared ends, with a card listing them; clicking pins it open. The key can
	// keep every shared route separated.
	const SEPARATE_STORAGE = 'tellegen.schematic.separate';
	let separateAll = $state(
		(() => {
			try {
				return localStorage.getItem(SEPARATE_STORAGE) === 'on';
			} catch {
				return false;
			}
		})()
	);
	function rememberSeparate(on: boolean) {
		separateAll = on;
		try {
			localStorage.setItem(SEPARATE_STORAGE, on ? 'on' : 'off');
		} catch {
			// Storage can be unavailable; the toggle still works for this view.
		}
	}
	let hoverGroup = $state<number | null>(null);
	let pinnedGroup = $state<number | null>(null);
	let cardHovered = false;
	let collapseTimer: ReturnType<typeof setTimeout> | null = null;
	function openGroup(g: number) {
		if (collapseTimer) clearTimeout(collapseTimer);
		collapseTimer = null;
		if (hoverGroup !== g) hoverGroup = g;
	}
	function leaveGroup() {
		if (hoverGroup === null || collapseTimer || cardHovered) return;
		collapseTimer = setTimeout(() => {
			collapseTimer = null;
			if (!cardHovered) hoverGroup = null;
		}, 350);
	}
	/** The one route whose card shows: pinned, else hovered. */
	const activeGroup = $derived(equipment && symbolsOn ? (pinnedGroup ?? hoverGroup) : null);
	/** Routes drawn fanned out now. */
	const fannedGroups = $derived(
		!equipment || !symbolsOn
			? []
			: separateAll
				? equipment.routeGroups.map((_, g) => g)
				: activeGroup === null
					? []
					: [activeGroup]
	);
	const fannedEdges = $derived(
		new Set(fannedGroups.flatMap((g) => equipment?.routeGroups[g] ?? []))
	);
	function fanned(): FannedBranch[] {
		if (!equipment || !fannedGroups.length) return [];
		const scale = 2 ** tagZoom;
		return fannedGroups.flatMap((g) =>
			fanRoute(equipment.routeGroups[g], equipment.host, geometry, scale, {
				spreadPx: 11,
				taperPx: 18
			})
		);
	}
	/** Whether a drawn segment lies on its edge's shared (host) segment, so it is replaced by the
	 * fanned path while its route is fanned. */
	function onHost(d: SchematicGeometry, s: number, k: number): boolean {
		const h = equipment?.host[k] ?? -1;
		if (h < 0) return false;
		const [ax, ay, bx, by] = [
			geometry.sources[h * 3],
			geometry.sources[h * 3 + 1],
			geometry.targets[h * 3],
			geometry.targets[h * 3 + 1]
		];
		const len = Math.hypot(bx - ax, by - ay) || 1;
		const off = (x: number, y: number) =>
			Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len;
		const tol = len * 1e-6 + 1e-9;
		return (
			off(d.sources[s * 3], d.sources[s * 3 + 1]) <= tol &&
			off(d.targets[s * 3], d.targets[s * 3 + 1]) <= tol
		);
	}
	/** A drawn segment replaced by its fanned path right now. */
	function hiddenUnderFan(d: SchematicGeometry, s: number): boolean {
		const k = d.segmentEdge[s];
		return fannedEdges.has(k) && onHost(d, s, k);
	}
	const HIDDEN: RGBA = [0, 0, 0, 0];
	/** Per symbol stroke: ink, or faint when its bus or branch is not energised; hidden for a branch
	 * whose route is fanned (its marks are redrawn on the fanned path). */
	function strokeColours(owner: Int32Array): Uint8Array {
		const out = new Uint8Array(owner.length * 4);
		for (let s = 0; s < owner.length; s++) {
			const o = owner[s];
			if (o >= 0 && fannedEdges.has(o)) {
				out.set(HIDDEN, s * 4);
				continue;
			}
			const on = o >= 0 ? live.edges[o] : live.buses[-o - 1];
			out.set(on ? SYMBOL_INK : DEAD, s * 4);
		}
		return out;
	}
	function routeCardRows(g: number) {
		const members = equipment?.routeGroups[g] ?? [];
		return members.map((k) => {
			const e = graph.edges[k];
			const { phases, neutral } = conductorSet(graph, k);
			const loading = snapshot?.branches[k]?.loading ?? null;
			return {
				k,
				id: e.id,
				kind: e.kind,
				level: edgeMv[k] ? 'MV' : 'LV',
				wires: `${phases}${neutral ? '+N' : ''}`,
				loading: loading === null ? null : `${loading.toFixed(0)} %`,
				state:
					loading === null
						? 'normal'
						: loading > 100
							? 'violation'
							: loading >= 90
								? 'warning'
								: 'normal'
			};
		});
	}
	const legendGlyphs = $derived(
		equipment
			? (
					[
						['transformer', branchGlyph('transformer', true), 'transformer'],
						['switch', branchGlyph('switch', true), 'switch, closed'],
						['switch', branchGlyph('switch', false), 'switch, open'],
						...(['source', 'generator', 'ibr', 'load', 'shunt'] as const).map(
							(k) => [k, attachmentGlyph(k), ATTACHMENT_NAMES[k]] as const
						)
					] as [EquipmentItem['kind'], Glyph | null, string][]
				).filter(
					([kind, glyph, label]) =>
						glyph &&
						equipment.kinds.has(kind) &&
						(kind !== 'switch' ||
							graph.edges.some(
								(e) => e.kind === 'switch' && e.closed === (label === 'switch, closed')
							))
				)
			: []
	);
	const branchTip = (k: number) => {
		const e = graph.edges[k];
		const { phases, neutral } = conductorSet(graph, k);
		const wires = `${phases} phase${phases === 1 ? '' : 's'}${neutral ? ' + neutral' : ''}`;
		const shared = equipment?.sharedRoute[k] ?? 1;
		const route =
			shared > 1
				? ` · drawn on a route shared with ${shared - 1} other branch${shared > 2 ? 'es' : ''}`
				: '';
		return `${e.kind} ${e.id} · ${wires}${e.closed ? '' : ' · open'}${live.edges[k] ? '' : ' · not energised'}${route}`;
	};
	const itemLabel = (d: EquipmentItem) => {
		const name = d.kind in ATTACHMENT_NAMES ? ATTACHMENT_NAMES[d.kind as 'load'] : d.kind;
		const ids = d.ids.slice(0, 4).join(', ') + (d.ids.length > 4 ? ` +${d.ids.length - 4}` : '');
		return d.bus >= 0
			? `${d.ids.length > 1 ? `${d.ids.length} ${name}s` : name} ${ids} at ${graph.buses[d.bus].id}`
			: `${name} ${ids}${graph.edges[d.edge].closed ? '' : ' (open)'}`;
	};
	/** Toolbar and legend start right of the left dock, so no panel covers them. */
	const toolLeft = $derived(panels.compact ? 12 : panels.dockWidth('left') + 24);
	const busIndex = $derived(new Map(graph.buses.map((b, i) => [b.id, i])));
	const selectedBus = $derived(
		mc.selectedBusId === null ? -1 : (busIndex.get(mc.selectedBusId) ?? -1)
	);
	const selectedEdges = $derived(
		new Set(
			mc.selectedEdgeId === null
				? []
				: graph.edges.flatMap((e, k) => (e.id === mc.selectedEdgeId ? [k] : []))
		)
	);

	const hoveredBus = $derived(
		mc.hovered?.kind === 'bus' ? (busIndex.get(mc.hovered.id) ?? -1) : -1
	);
	const hoveredEdges = $derived(
		new Set(
			mc.hovered?.kind === 'branch'
				? graph.edges.flatMap((e, k) => (e.id === mc.hovered!.id ? [k] : []))
				: []
		)
	);

	/** Per-edge and per-bus colours for the active mode; results never recolour inactive branches. */
	const edgeColours = $derived(
		graph.edges.map((e, k): RGBA => {
			if (!live.edges[k]) return DEAD;
			if (!e.closed || colour === 'none' || !snapshot) return edgeColor(e.kind, e.closed);
			if (colour === 'loading-heat') {
				const loading = snapshot.branches[k].loading;
				return loading === null ? MISSING_COLOUR : loadingColour(loading);
			}
			const { from, to } = inputs.names.branches[k];
			if (from < 0 || to < 0) return MISSING_COLOUR;
			const t = worstBand(snapshot.buses[tree.depth[from] > tree.depth[to] ? from : to].pairs);
			return t === null ? MISSING_COLOUR : bandColour(t);
		})
	);
	const busColours = $derived(
		graph.buses.map((_, i): RGBA => {
			if (!live.buses[i]) return DEAD;
			if (colour !== 'voltage-band' || !snapshot) return INK;
			const t = worstBand(snapshot.buses[i].pairs);
			return t === null ? MISSING_COLOUR : bandColour(t);
		})
	);

	/** Whether `view` shows at least one bus of `g`. */
	function showsAny(
		g: SchematicGeometry,
		view: { target: [number, number, number]; zoom: number }
	) {
		const scale = 2 ** view.zoom;
		const [hw, hh] = [width / 2 / scale, height / 2 / scale];
		for (let i = 0; i < g.positions.length; i += 3) {
			const dx = g.positions[i] - view.target[0];
			const dy = g.positions[i + 1] - view.target[1];
			if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return true;
		}
		return false;
	}

	/** Leaving from geographic positions (Close, or *Show map* in the overview), hand the view back
	 * so the map continues from it. */
	function handOffCamera() {
		const origin = source?.mercatorOrigin;
		if (layout !== 'source' || !origin || !shown) return;
		const view = basemapCamera(camera, origin);
		app.camera = { center: view.center, zoom: view.zoom, bearing: 0, pitch: 0 };
		app.cameraHandoff = true;
	}

	/** Screen insets of the area no panel or toolbar covers. */
	function freeArea() {
		return {
			left: panels.compact ? 28 : panels.dockWidth('left') + 44,
			right: panels.compact ? 28 : panels.dockWidth('right') + 44,
			top: panels.top + 64,
			bottom: panels.compact ? app.sheetInset + 24 : 88
		};
	}

	function fitCamera(g: SchematicGeometry) {
		const [x0, y0, x1, y1] = g.bounds;
		const { left, right, top, bottom } = freeArea();
		const w = Math.max(80, width - left - right);
		const h = Math.max(80, height - top - bottom);
		const zoom = Math.log2(Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0)));
		const scale = 2 ** zoom;
		// Centre the drawing in the free area between the docked panels.
		const cx = (x0 + x1) / 2 - (left - right) / 2 / scale;
		const cy = (y0 + y1) / 2 - (top - bottom) / 2 / scale;
		// Schematic units are sized for about 1:1 to 2:1; closer, a small network's symbols balloon.
		const max = g.attachmentGap ? 1 : 4;
		return { target: [cx, cy, 0] as [number, number, number], zoom: Math.min(zoom, max) };
	}

	function segmentColours(g: SchematicGeometry): Uint8Array {
		const out = new Uint8Array(g.segmentEdge.length * 4);
		for (let s = 0; s < g.segmentEdge.length; s++) {
			const k = g.segmentEdge[s];
			const c = edgeColours[k];
			let alpha = g.role[k] === 2 ? Math.min(110, c[3]) : c[3];
			if (hiddenUnderFan(g, s)) alpha = 0;
			if (zoomedOut && !edgeMv[k]) alpha *= 0.45;
			out.set([c[0], c[1], c[2], alpha], s * 4);
		}
		return out;
	}

	let morph: {
		from: Float32Array;
		cur: Float32Array;
		s: Float32Array;
		t: Float32Array;
		endpoints: Int32Array;
		start: number | null;
		warm: boolean;
		raf: number;
	} | null = null;

	function layers(): Layer[] {
		if (!modules) return [];
		const { LineLayer, ScatterplotLayer, TextLayer } = modules.layers;
		const g = geometry;
		const common = { coordinateSystem: modules.core.COORDINATE_SYSTEM.CARTESIAN };
		if (morph) {
			return [
				new LineLayer({
					...common,
					id: 'morph-chords',
					data: {
						length: morph.endpoints.length / 2,
						attributes: {
							getSourcePosition: { value: morph.s, size: 3 },
							getTargetPosition: { value: morph.t, size: 3 }
						}
					},
					getColor: [120, 114, 102, 200],
					getWidth: 1,
					widthUnits: 'pixels'
				}),
				new ScatterplotLayer({
					...common,
					id: 'morph-buses',
					data: {
						length: graph.buses.length,
						attributes: { getPosition: { value: morph.cur, size: 3 } }
					},
					getFillColor: INK,
					getRadius: 2,
					radiusUnits: 'pixels'
				})
			];
		}
		const d = drawn;
		const selectedSegments: number[] = [];
		if (selectedEdges.size)
			for (let s = 0; s < d.segmentEdge.length; s++)
				if (selectedEdges.has(d.segmentEdge[s]) && !hiddenUnderFan(d, s)) selectedSegments.push(s);
		const point = (i: number): [number, number] => [g.positions[i * 3], g.positions[i * 3 + 1]];
		// Bus ids index `graph.buses`, so picks map back whatever subset is drawn.
		const base = {
			length: d.segmentEdge.length,
			attributes: {
				getSourcePosition: { value: d.sources, size: 3 },
				getTargetPosition: { value: d.targets, size: 3 }
			}
		};
		const symbols = symbolsOn && equipment ? equipment : null;
		const hoveredSegments: number[] = [];
		if (hoveredEdges.size)
			for (let s = 0; s < d.segmentEdge.length; s++)
				if (hoveredEdges.has(d.segmentEdge[s]) && !hiddenUnderFan(d, s)) hoveredSegments.push(s);
		return [
			// Zone outlines sit beneath everything; they pick only where nothing else is.
			new modules.layers.PolygonLayer({
				...common,
				id: 'zones',
				// On geographic positions, outlines (convex hulls) overlap; close in they only cloud the map.
				data: layout === 'source' && symbolsOn ? [] : zoneShapes,
				getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
				getFillColor: (d: { z: number }) => ZONE_COLOURS[zoneStates[d.z]][0],
				getLineColor: (d: { z: number }) => ZONE_COLOURS[zoneStates[d.z]][1],
				getLineWidth: 1,
				lineWidthUnits: 'pixels',
				lineWidthMinPixels: 1,
				pickable: true,
				updateTriggers: { getFillColor: zoneStates, getLineColor: zoneStates }
			}),
			new TextLayer({
				...common,
				id: 'zone-tags',
				data:
					layout === 'source' && symbolsOn
						? []
						: zoneTags.filter((t) => t.width * 2 ** tagZoom >= 150),
				getPosition: (t: { position: [number, number] }) => [...t.position, 0],
				getText: (t: { text: string }) => t.text,
				getColor: (t: { z: number }) => {
					const s = zoneStates[t.z];
					return s === 'violation' ? DANGER : s === 'warning' ? WARNING : [70, 110, 150, 255];
				},
				getSize: 10,
				getTextAnchor: 'start',
				getAlignmentBaseline: 'bottom',
				getPixelOffset: [2, -2],
				background: true,
				getBackgroundColor: [...PAPER.slice(0, 3), 220] as RGBA,
				backgroundPadding: [3, 1],
				fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
				characterSet: 'auto',
				updateTriggers: { getColor: zoneStates }
			}),
			// Result colours are quiet for normal values; a faint underlay keeps the topology legible.
			...(colour === 'none'
				? []
				: [
						new LineLayer({
							...common,
							id: 'topology-underlay',
							data: base,
							getColor: [120, 114, 102, 70],
							getWidth: 1,
							widthUnits: 'pixels'
						})
					]),
			new LineLayer({
				...common,
				id: `branches-${layout}`,
				data: {
					length: d.segmentEdge.length,
					attributes: {
						getSourcePosition: { value: d.sources, size: 3 },
						getTargetPosition: { value: d.targets, size: 3 },
						getColor: { value: segmentColours(d), size: 4, normalized: true },
						getWidth: { value: segmentWidths(d), size: 1 }
					}
				},
				widthUnits: 'pixels',
				pickable: true
			}),
			new LineLayer({
				...common,
				id: 'selected-branch',
				data: selectedSegments,
				getSourcePosition: (s: number) => [d.sources[s * 3], d.sources[s * 3 + 1], 0],
				getTargetPosition: (s: number) => [d.targets[s * 3], d.targets[s * 3 + 1], 0],
				getColor: ACCENT,
				getWidth: 4,
				widthUnits: 'pixels'
			}),
			...sharedRouteLayers(common, d),
			...(symbols
				? [
						new LineLayer({
							...common,
							id: 'equipment',
							data: {
								length: symbols.sources.length / 3,
								attributes: {
									getSourcePosition: { value: symbols.sources, size: 3 },
									getTargetPosition: { value: symbols.targets, size: 3 },
									getColor: { value: strokeColours(symbols.owner), size: 4, normalized: true }
								}
							},
							getWidth: 1.25,
							widthUnits: 'pixels'
						}),
						...(valuesOn && arrows
							? [
									new LineLayer({
										...common,
										id: 'flow-arrows',
										data: {
											length: arrows.edge.length,
											attributes: {
												getSourcePosition: { value: arrows.sources, size: 3 },
												getTargetPosition: { value: arrows.targets, size: 3 },
												getColor: {
													value: Uint8Array.from({ length: arrows.edge.length * 4 }, (_, i) =>
														fannedEdges.has(arrows.edge[i >> 2]) ? 0 : ACCENT[i & 3]
													),
													size: 4,
													normalized: true
												}
											}
										},
										getWidth: 1.5,
										widthUnits: 'pixels'
									})
								]
							: []),
						...(ticksOn
							? [
									new LineLayer({
										...common,
										id: 'conductor-ticks',
										data: {
											length: symbols.ticks.edge.length,
											attributes: {
												getSourcePosition: { value: symbols.ticks.sources, size: 3 },
												getTargetPosition: { value: symbols.ticks.targets, size: 3 },
												getColor: {
													value: strokeColours(symbols.ticks.edge),
													size: 4,
													normalized: true
												}
											}
										},
										getWidth: 1,
										widthUnits: 'pixels'
									})
								]
							: []),
						// Invisible discs over each symbol make it clickable and give it a tooltip.
						new ScatterplotLayer({
							...common,
							id: 'equipment-hits',
							data: symbols.items,
							getPosition: (d: EquipmentItem) => [d.x, d.y, 0],
							getRadius: symbols.unit * 1.3,
							radiusUnits: 'common',
							getFillColor: [0, 0, 0, 1],
							pickable: true
						}),
						new TextLayer({
							...common,
							id: 'equipment-text',
							data: symbols.items.filter((d) => d.bus >= 0 && itemText(d)),
							getPosition: (d: EquipmentItem) => [d.x + symbols.unit * 1.1, d.y, 0],
							getText: itemText,
							updateTriggers: { getText: [valuesOn, powers] },
							getColor: SYMBOL_INK,
							getSize: 10,
							getTextAnchor: 'start',
							getAlignmentBaseline: 'center',
							fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
							characterSet: 'auto'
						})
					]
				: []),
			new ScatterplotLayer({
				...common,
				id: `buses-${layout}`,
				// Zoomed out, LV bus dots are noise unless they carry the voltage colouring.
				data: zoomedOut && colour !== 'voltage-band' ? mvBuses : allBuses,
				getPosition: (i: number) => [...point(i), 0],
				getFillColor: (i: number) => busColours[i],
				// Zoomed out, small dots keep dense chains from merging into bars.
				getRadius: symbolsOn ? 2.6 : 1.4,
				radiusUnits: 'pixels',
				radiusMinPixels: 1,
				pickable: true,
				updateTriggers: {
					getFillColor: [colour, snapshot],
					getPosition: layout,
					getRadius: symbolsOn
				}
			}),
			new ScatterplotLayer({
				...common,
				id: 'selected-bus',
				data: selectedBus >= 0 ? [selectedBus] : [],
				getPosition: (i: number) => [...point(i), 0],
				getFillColor: [0, 0, 0, 0],
				getLineColor: ACCENT,
				stroked: true,
				filled: false,
				getRadius: 7,
				radiusUnits: 'pixels',
				lineWidthUnits: 'pixels',
				getLineWidth: 2.5
			}),
			// Hovered in a linked view (profile, table) or here: a soft halo.
			new ScatterplotLayer({
				...common,
				id: 'hovered-bus',
				data: hoveredBus >= 0 ? [hoveredBus] : [],
				getPosition: (i: number) => [...point(i), 0],
				getFillColor: [...ACCENT.slice(0, 3), 60] as RGBA,
				getRadius: 9,
				radiusUnits: 'pixels'
			}),
			new LineLayer({
				...common,
				id: 'hovered-branch',
				data: hoveredSegments,
				getSourcePosition: (s: number) => [d.sources[s * 3], d.sources[s * 3 + 1], 0],
				getTargetPosition: (s: number) => [d.targets[s * 3], d.targets[s * 3 + 1], 0],
				getColor: [...ACCENT.slice(0, 3), 110] as RGBA,
				getWidth: 7,
				widthUnits: 'pixels'
			}),
			...(marks && marks.placed.length
				? [
						// A paper halo lifts each marker off the faded drawing; it is also the pick target.
						new ScatterplotLayer({
							...common,
							id: 'landmark-halos',
							data: marks.placed,
							getPosition: (l: Landmark) => [l.x, l.y, 0],
							// Semi-transparent: lifts the marker without blanking the drawing under it.
							getFillColor: [...PAPER.slice(0, 3), 150] as RGBA,
							getRadius: 11,
							radiusUnits: 'pixels',
							pickable: true
						}),
						new LineLayer({
							...common,
							id: 'landmarks',
							data: {
								length: marks.strokes.owner.length,
								attributes: {
									getSourcePosition: { value: marks.strokes.sources, size: 3 },
									getTargetPosition: { value: marks.strokes.targets, size: 3 },
									getColor: {
										value: landmarkColours(marks),
										size: 4,
										normalized: true
									}
								}
							},
							getWidth: 1.6,
							widthUnits: 'pixels'
						}),
						new TextLayer({
							...common,
							id: 'landmark-names',
							data: marks.placed.filter((l) => l.kind === 'source' || l.kind === 'generator'),
							getPosition: (l: Landmark) => [l.x, l.y, 0],
							getText: (l: Landmark) =>
								(markName.get(l.ids[0]) ?? l.ids[0]) +
								(l.ids.length > 1 ? ` +${l.ids.length - 1}` : ''),
							getColor: INK,
							getSize: 10,
							getTextAnchor: 'middle',
							getAlignmentBaseline: 'top',
							getPixelOffset: [0, 14],
							background: true,
							getBackgroundColor: [...PAPER.slice(0, 3), 220] as RGBA,
							backgroundPadding: [2, 1],
							fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
							characterSet: 'auto'
						})
					]
				: []),
			new ScatterplotLayer({
				...common,
				id: 'keyboard-cursor',
				data: cursor >= 0 ? [cursor] : [],
				getPosition: (i: number) => [...point(i), 0],
				getLineColor: INK,
				stroked: true,
				filled: false,
				getRadius: 11,
				radiusUnits: 'pixels',
				lineWidthUnits: 'pixels',
				getLineWidth: 1.5
			}),
			new TextLayer({
				...common,
				id: 'labels',
				data: labels,
				getPosition: (d: { position: [number, number] }) => [...d.position, 0],
				getText: (d: LabelCandidate) => d.text,
				getColor: (d: LabelCandidate) =>
					d.state === 'violation' ? DANGER : d.state === 'warning' ? WARNING : INK,
				getSize: 11,
				getTextAnchor: 'start',
				// Above-right of the point: attachment symbols hang below buses.
				getAlignmentBaseline: 'bottom',
				getPixelOffset: [6, -5],
				background: true,
				getBackgroundColor: [...PAPER.slice(0, 3), 230] as RGBA,
				backgroundPadding: [3, 1],
				fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
				characterSet: 'auto'
			})
		];
	}

	/** Fanned members of shared routes (with their marks), and the count badges of the others. */
	function sharedRouteLayers(common: object, d: SchematicGeometry): Layer[] {
		if (!modules || !equipment || !symbolsOn) return [];
		const { LineLayer, TextLayer } = modules.layers;
		const eq = equipment;
		const fans = fanned();
		const src: number[] = [];
		const dst: number[] = [];
		const owner: number[] = [];
		for (const f of fans)
			for (let i = 1; i < f.path.length; i++) {
				src.push(f.path[i - 1][0], f.path[i - 1][1], 0);
				dst.push(f.path[i][0], f.path[i][1], 0);
				owner.push(f.edge);
			}
		// Marks on the fanned paths: the branch's symbol, or its conductor marks.
		const mSrc: number[] = [];
		const mDst: number[] = [];
		for (const f of fans) {
			const e = graph.edges[f.edge];
			const glyph = branchGlyph(e.kind, e.closed);
			const { phases, neutral } = conductorSet(graph, f.edge);
			const shape = glyph ?? (ticksOn ? conductorTicks(phases, neutral) : null);
			if (!shape) continue;
			const [cos, sin] = f.dir;
			const u = eq.unit * (glyph ? 0.8 : 1);
			for (const line of shape)
				for (let i = 1; i < line.length; i++) {
					const [ax, ay] = line[i - 1];
					const [bx, by] = line[i];
					mSrc.push(f.mid[0] + u * (ax * cos - ay * sin), f.mid[1] + u * (ax * sin + ay * cos), 0);
					mDst.push(f.mid[0] + u * (bx * cos - by * sin), f.mid[1] + u * (bx * sin + by * cos), 0);
				}
		}
		const colours = new Uint8Array(owner.length * 4);
		const widths = new Float32Array(owner.length);
		const [mv, lv] = colour === 'none' ? [2.4, 1.1] : [3, 1.8];
		owner.forEach((k, i) => {
			const hovered = hoveredEdges.has(k);
			colours.set(
				selectedEdges.has(k)
					? ACCENT
					: hovered
						? ([...ACCENT.slice(0, 3), 150] as RGBA)
						: edgeColours[k],
				i * 4
			);
			widths[i] = selectedEdges.has(k) ? 3.5 : hovered ? 4 : edgeMv[k] ? mv : lv;
		});
		const badges = ticksOn
			? eq.routeGroups.flatMap((members, g) => {
					if (fannedGroups.includes(g)) return [];
					const p = routeMiddle(members, eq.host, geometry);
					return p ? [{ g, n: members.length, position: p }] : [];
				})
			: [];
		void d;
		return [
			...(owner.length
				? [
						new LineLayer({
							...common,
							id: 'fan-branches',
							data: {
								length: owner.length,
								attributes: {
									getSourcePosition: { value: Float32Array.from(src), size: 3 },
									getTargetPosition: { value: Float32Array.from(dst), size: 3 },
									getColor: { value: colours, size: 4, normalized: true },
									getWidth: { value: widths, size: 1 }
								}
							},
							widthUnits: 'pixels',
							pickable: true
						}),
						new LineLayer({
							...common,
							id: 'fan-marks',
							data: {
								length: mSrc.length / 3,
								attributes: {
									getSourcePosition: { value: Float32Array.from(mSrc), size: 3 },
									getTargetPosition: { value: Float32Array.from(mDst), size: 3 }
								}
							},
							getColor: SYMBOL_INK,
							getWidth: 1,
							widthUnits: 'pixels'
						})
					]
				: []),
			...(badges.length
				? [
						new TextLayer({
							...common,
							id: 'route-badges',
							data: badges,
							getPosition: (b: { position: [number, number] }) => [...b.position, 0],
							getText: (b: { n: number }) => `×${b.n}`,
							getColor: SYMBOL_INK,
							getSize: 11,
							getPixelOffset: [0, -10],
							background: true,
							getBackgroundColor: [...PAPER.slice(0, 3), 230] as RGBA,
							backgroundPadding: [3, 1],
							fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
							characterSet: 'auto',
							pickable: true
						})
					]
				: [])
		];
	}
	/** The route a pick belongs to, if it is shared. */
	function pickedGroup(info: PickingInfo): number | null {
		if (!equipment || info.index < 0 || !info.layer) return null;
		const id = info.layer.id;
		if (id === 'route-badges') return (info.object as { g: number }).g;
		const k =
			id === 'fan-branches'
				? fanEdgeAt(info.index)
				: id.startsWith('branches-')
					? drawn.segmentEdge[info.index]
					: -1;
		const g = k >= 0 ? equipment.routeOf[k] : -1;
		return g >= 0 ? g : null;
	}
	/** Edge of the n-th fanned segment (three per member, in `fanned()` order). */
	function fanEdgeAt(index: number): number {
		const fans = fanned();
		return fans[Math.floor(index / 3)]?.edge ?? -1;
	}

	/** Value labels for the view, placed by priority: selection, then severity, then magnitude. */
	function updateLabels() {
		const g = geometry;
		const scale = 2 ** camera.zoom;
		const x0 = camera.target[0] - width / 2 / scale;
		const y0 = camera.target[1] - height / 2 / scale;
		const screen = (x: number, y: number): [number, number] => [(x - x0) * scale, (y - y0) * scale];
		const inView = (x: number, y: number) => {
			const [sx, sy] = screen(x, y);
			return sx >= 0 && sx <= width && sy >= 0 && sy <= height;
		};
		const candidates: (LabelCandidate & { position: [number, number] })[] = [];
		if (selectedBus >= 0) {
			const [x, y] = [g.positions[selectedBus * 3], g.positions[selectedBus * 3 + 1]];
			candidates.push({
				text: names[selectedBus],
				state: 'normal',
				priority: Infinity,
				selected: true,
				screen: screen(x, y),
				position: [x, y]
			});
		}
		if (snapshot && camera.zoom > -3) {
			if (colour === 'voltage-band') {
				for (let i = 0; i < graph.buses.length && candidates.length < 4000; i++) {
					const [x, y] = [g.positions[i * 3], g.positions[i * 3 + 1]];
					if (i === selectedBus || !inView(x, y)) continue;
					const c = busLabel(snapshot, i);
					if (c) candidates.push({ ...c, screen: screen(x, y), position: [x, y] });
				}
			} else if (colour === 'loading-heat') {
				const seen = new Set<number>();
				for (let s = 0; s < g.segmentEdge.length && candidates.length < 4000; s++) {
					const k = g.segmentEdge[s];
					if (seen.has(k)) continue;
					seen.add(k);
					const [x, y] = [
						(g.sources[s * 3] + g.targets[s * 3]) / 2,
						(g.sources[s * 3 + 1] + g.targets[s * 3 + 1]) / 2
					];
					if (!inView(x, y)) continue;
					const c = branchLabel(snapshot, k, 'loading');
					if (c)
						candidates.push({
							...c,
							selected: selectedEdges.has(k),
							screen: screen(x, y),
							position: [x, y]
						});
				}
			}
		}
		if (cursor >= 0 && cursor !== selectedBus) {
			const [x, y] = [g.positions[cursor * 3], g.positions[cursor * 3 + 1]];
			candidates.push({
				text: names[cursor],
				state: 'normal',
				priority: Infinity,
				selected: true,
				screen: screen(x, y),
				position: [x, y]
			});
		}
		// Close in, with no result values to show, name the buses (short names; hover for the full id).
		if (namesOn && (colour === 'none' || !snapshot))
			for (let i = 0; i < graph.buses.length && candidates.length < 4000; i++) {
				const [x, y] = [g.positions[i * 3], g.positions[i * 3 + 1]];
				if (i === selectedBus || !inView(x, y)) continue;
				candidates.push({
					text: names[i],
					state: 'normal',
					priority: 0,
					screen: screen(x, y),
					position: [x, y]
				});
			}
		labels = placeLabels(candidates, { width, height, budget: 60 });
		if (zoomedOut && landmarksOn && landmarkPool.length) {
			const placed = placeLandmarks(landmarkPool, screen, { width, height });
			marks = { placed, strokes: landmarkStrokes(placed, 8 / scale) };
		} else marks = null;
	}

	function render() {
		deck?.setProps({ layers: layers() });
	}

	// Build the renderer once the canvas exists.
	$effect(() => {
		if (!canvas || deck) return;
		const element = canvas;
		let cancelled = false;
		Promise.all([import('@deck.gl/core'), import('@deck.gl/layers')])
			.then(([core, layers]) => {
				if (cancelled) return;
				modules = { core, layers };
				camera = fitCamera(geometry);
				deck = new core.Deck({
					canvas: element,
					width: '100%',
					height: '100%',
					views: new core.OrthographicView({ id: 'schematic', flipY: true }),
					initialViewState: { ...camera, minZoom: -24, maxZoom: 8 },
					controller: { doubleClickZoom: true },
					pickingRadius: 6,
					getCursor: ({ isHovering, isDragging }) =>
						isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
					onViewStateChange: ({ viewState }) => {
						const v = viewState as OrthographicViewState;
						camera = { target: v.target as [number, number, number], zoom: v.zoom as number };
					},
					onHover: (info: PickingInfo) => {
						const id = info.layer?.id ?? '';
						let next: { kind: 'bus' | 'branch'; id: string } | null = null;
						if (info.index >= 0 && id.startsWith('buses-'))
							next = { kind: 'bus', id: graph.buses[info.object as number].id };
						else if (info.index >= 0 && id.startsWith('branches-'))
							next = { kind: 'branch', id: graph.edges[drawn.segmentEdge[info.index]].id };
						else if (info.index >= 0 && id === 'fan-branches')
							next = { kind: 'branch', id: graph.edges[fanEdgeAt(info.index)].id };
						else if (info.index >= 0 && id === 'equipment-hits') {
							const item = info.object as EquipmentItem;
							next =
								item.edge >= 0
									? { kind: 'branch', id: graph.edges[item.edge].id }
									: { kind: 'bus', id: graph.buses[item.bus].id };
						}
						if (next?.kind !== mc.hovered?.kind || next?.id !== mc.hovered?.id) mc.hovered = next;
						const g = symbolsOn ? pickedGroup(info) : null;
						if (g !== null) openGroup(g);
						else leaveGroup();
					},
					onClick: (info: PickingInfo) => {
						if (info.index < 0 || !info.layer) {
							// A click on empty canvas closes a pinned shared route.
							pinnedGroup = null;
							return;
						}
						if (info.layer.id === 'route-badges') {
							pinnedGroup = (info.object as { g: number }).g;
							return;
						}
						if (info.layer.id === 'fan-branches') {
							pickedHere = true;
							setTimeout(() => (pickedHere = false));
							pinnedGroup = pickedGroup(info);
							onselectedge(graph.edges[fanEdgeAt(info.index)].id);
							return;
						}
						// A shared route is ambiguous when collapsed: open its members instead of guessing.
						const shared = info.layer.id.startsWith('branches-') ? pickedGroup(info) : null;
						if (shared !== null && !separateAll) {
							pinnedGroup = shared;
							return;
						}
						// Skip the fly-to for this selection; cleared after effects run, as a click on the
						// already-selected item changes nothing.
						pickedHere = true;
						setTimeout(() => (pickedHere = false));
						if (info.layer.id === 'landmark-halos') {
							const l = info.object as Landmark;
							if (l.edge >= 0) onselectedge(graph.edges[l.edge].id);
							else onselectbus(graph.buses[l.bus].id);
							bringIntoView([l.x, l.y]);
							return;
						}
						if (info.layer.id === 'zones') {
							fitZone(zones.zones[(info.object as { z: number }).z]);
							return;
						}
						if (info.layer.id.startsWith('buses-'))
							onselectbus(graph.buses[info.object as number].id);
						else if (info.layer.id.startsWith('branches-'))
							onselectedge(graph.edges[drawn.segmentEdge[info.index]].id);
						else if (info.layer.id === 'equipment-hits') {
							const item = info.object as EquipmentItem;
							if (item.edge >= 0) onselectedge(graph.edges[item.edge].id);
							else onselectbus(graph.buses[item.bus].id);
						}
					},
					getTooltip: (info: PickingInfo) =>
						info.index >= 0 && info.layer?.id === 'fan-branches'
							? null
							: info.index >= 0 && info.layer?.id === 'route-badges'
								? `${(info.object as { n: number }).n} branches share this route. Hover to separate them; click to keep them open.`
								: info.index >= 0 && info.layer?.id === 'landmark-halos'
									? landmarkTip(info.object as Landmark)
									: info.index >= 0 && info.layer?.id === 'zones'
										? `${zoneLabel((info.object as { z: number }).z)}. Click to fit.`
										: info.index >= 0 && info.layer?.id.startsWith('buses-')
											? `${graph.buses[info.object as number].id}`
											: info.index >= 0 && info.layer?.id.startsWith('branches-')
												? // A shared route's card names its branches; its hidden true route stays silent.
													equipment &&
													symbolsOn &&
													equipment.routeOf[drawn.segmentEdge[info.index]] >= 0
													? null
													: branchTip(drawn.segmentEdge[info.index])
												: info.index >= 0 && info.layer?.id === 'equipment-hits'
													? itemLabel(info.object as EquipmentItem)
													: null
				});
				// Open where the user just was: the case's own positions (the map they were looking at),
				// when it has them. The schematic is laid out meanwhile, so switching to it is quick.
				if (source) {
					void show('source', strategy);
					void target('schematic', strategy).catch(() => {});
				} else void show('schematic', strategy);
			})
			.catch(
				(e: unknown) =>
					(status = `The schematic could not load: ${e instanceof Error ? e.message : e}`)
			);
		return () => {
			cancelled = true;
		};
	});
	$effect(() => () => {
		if (morph) cancelAnimationFrame(morph.raf);
		handOffCamera();
		deck?.finalize();
	});

	// Redraw when the data, colours or selection change; relabel when the camera moves.
	$effect(() => {
		void [
			geometry,
			drawn,
			edgeColours,
			busColours,
			selectedBus,
			selectedEdges,
			labels,
			cursor,
			valuesOn,
			arrows,
			hoveredBus,
			hoveredEdges,
			zoomedOut,
			zoneTags,
			tagZoom,
			marks,
			fannedGroups,
			fannedEdges
		];
		if (!morph) render();
	});
	let labelFrame = 0;
	$effect(() => {
		void [
			camera,
			landmarksOn,
			landmarkPool,
			zoomedOut,
			colour,
			snapshot,
			selectedBus,
			selectedEdges,
			geometry,
			width,
			height,
			namesOn,
			cursor
		];
		if (!deck) return;
		cancelAnimationFrame(labelFrame);
		labelFrame = requestAnimationFrame(updateLabels);
	});

	/** Set while a click in the canvas changes the selection: that selection is already in view. */
	let pickedHere = false;
	const ready = $derived(!!deck && !!shown);
	/** Where the selection is drawn: its bus, or its branch's symbol or conductor marks. */
	function selectionPoint(): [number, number] | null {
		const g = geometry;
		if (selectedBus >= 0) return [g.positions[selectedBus * 3], g.positions[selectedBus * 3 + 1]];
		for (const k of selectedEdges) {
			const a = equipment?.anchors;
			if (a && Number.isFinite(a[k * 2])) return [a[k * 2], a[k * 2 + 1]];
			const { from, to } = inputs.names.branches[k];
			if (from >= 0 && to >= 0)
				return [
					(g.positions[from * 3] + g.positions[to * 3]) / 2,
					(g.positions[from * 3 + 1] + g.positions[to * 3 + 1]) / 2
				];
		}
		return null;
	}

	// Fly to a selection made outside the canvas (issues, search, tables, profile) when it is off
	// screen or drawn too small to read, zooming in until symbols show. Panning afterwards is free.
	// On opening, the view continues from the map: an existing selection is centred if it is off
	// screen, but not zoomed into.
	let opened = false;
	$effect(() => {
		void [selectedBus, selectedEdges, mc.revealSeq];
		if (!ready) return;
		untrack(() => {
			if (pickedHere || morph) {
				pickedHere = false;
				return;
			}
			const p = selectionPoint();
			if (p) bringIntoView(p, opened);
			opened = true;
		});
	});

	/** Fit the view to a zone. */
	function fitZone(zone: GalvanicZone) {
		let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
		for (const i of zone.buses) {
			const [x, y] = [geometry.positions[i * 3], geometry.positions[i * 3 + 1]];
			[x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
		}
		const pad = (equipment?.unit ?? 1) * 3;
		setCamera(fitCamera({ ...geometry, bounds: [x0 - pad, y0 - pad, x1 + pad, y1 + pad] }), true);
	}

	/** Centre `p` in the uncovered view when it is outside it or drawn too small to read. */
	function bringIntoView(p: [number, number], zoomIn = true) {
		if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
		const legible = equipment && zoomIn ? Math.log2(8 / equipment.unit) : camera.zoom;
		const zoom = Math.min(8, Math.max(camera.zoom, legible));
		const { left, right, top, bottom } = freeArea();
		const scale = 2 ** camera.zoom;
		const sx = (p[0] - camera.target[0]) * scale + width / 2;
		const sy = (p[1] - camera.target[1]) * scale + height / 2;
		const visible = sx > left && sx < width - right && sy > top && sy < height - bottom;
		if (visible && zoom === camera.zoom) return;
		// Centre it in the free area, not behind a docked panel.
		const k = 2 ** zoom;
		const target: [number, number, number] = [
			p[0] - (left - right) / 2 / k,
			p[1] - (top - bottom) / 2 / k,
			0
		];
		setCamera({ target, zoom }, true);
	}

	function setCamera(next: { target: [number, number, number]; zoom: number }, fly = false) {
		camera = next;
		const animate = fly && modules && !matchMedia('(prefers-reduced-motion: reduce)').matches;
		deck?.setProps({
			initialViewState: {
				...next,
				minZoom: -24,
				maxZoom: 8,
				...(animate
					? {
							transitionDuration: 450,
							transitionInterpolator: new modules!.core.LinearInterpolator(['target', 'zoom'])
						}
					: {})
			}
		});
	}

	// The schematic is laid out in the engine (Rust); each strategy is computed once per graph.
	const engineLayouts = new Map<SchematicStrategy, Promise<SchematicGeometry>>();
	let showSeq = 0;
	function target(nextLayout: Layout, nextStrategy: SchematicStrategy): Promise<SchematicGeometry> {
		if (nextLayout === 'source' && source) return Promise.resolve(source);
		let pending = engineLayouts.get(nextStrategy);
		if (!pending) {
			pending = mcSchematicLayout(graph, { strategy: nextStrategy }).then(fromEngineLayout);
			engineLayouts.set(nextStrategy, pending);
			pending.catch(() => engineLayouts.delete(nextStrategy));
		}
		return pending;
	}

	/** Show a layout. Buses glide from where they are on screen to the new layout along straight
	 * chords; a warm-up frame uploads the target geometry before the clock starts. */
	async function show(nextLayout: Layout, nextStrategy: SchematicStrategy) {
		if (nextLayout === 'source' && !source) return;
		const seq = ++showSeq;
		const slow = setTimeout(() => {
			if (seq === showSeq) status = 'Laying out the schematic…';
		}, 150);
		let next: SchematicGeometry;
		try {
			next = await target(nextLayout, nextStrategy);
		} catch (e) {
			status = `The schematic could not be laid out: ${e instanceof Error ? e.message : e}`;
			return;
		} finally {
			clearTimeout(slow);
		}
		if (seq !== showSeq) return;
		status = null;
		const previous = shown;
		const from = { ...camera };
		layout = nextLayout;
		strategy = nextStrategy;
		shown = next;
		// Opening on geographic positions, continue from the main map's view when it shows part of
		// this feeder; otherwise fit the drawing.
		const fromMap =
			!previous && nextLayout === 'source' && next.mercatorOrigin && app.camera
				? cameraFromMap(app.camera, next.mercatorOrigin)
				: null;
		const to = fromMap && showsAny(next, fromMap) ? fromMap : fitCamera(next);
		setCamera(to);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!previous || !deck || reduced || graph.buses.length > MORPH_MAX_BUSES) return;
		if (morph) cancelAnimationFrame(morph.raf);
		const before = previous.positions;
		const endpoints = Int32Array.from(
			graph.edges.flatMap((_, k) => {
				const { from: a, to: b } = inputs.names.branches[k];
				return a >= 0 && b >= 0 ? [a, b] : [];
			})
		);
		const n = endpoints.length / 2;
		morph = {
			from: screenAnchored(before, from, to),
			cur: new Float32Array(before.length),
			s: new Float32Array(n * 3),
			t: new Float32Array(n * 3),
			endpoints,
			start: null,
			warm: false,
			raf: 0
		};
		const destination = next.positions;
		const tick = (now: number) => {
			const m = morph;
			if (!m) return;
			if (!m.warm) {
				m.warm = true;
				m.raf = requestAnimationFrame(tick);
				return;
			}
			m.start ??= now;
			const k = ease(Math.min(1, (now - m.start) / MORPH_MS));
			lerpInto(m.cur, m.from, destination, k);
			chordsInto(m.s, m.t, m.endpoints, m.cur);
			if (k < 1) {
				render();
				m.raf = requestAnimationFrame(tick);
			} else {
				morph = null;
				render();
			}
		};
		morph.raf = requestAnimationFrame(tick);
	}

	function zoomBy(delta: number) {
		setCamera({ target: camera.target, zoom: Math.max(-24, Math.min(8, camera.zoom + delta)) });
	}
	const WALK: Record<string, WalkKey> = {
		ArrowLeft: 'parent',
		ArrowRight: 'child',
		ArrowUp: 'previous',
		ArrowDown: 'next',
		Home: 'root'
	};
	function onkeydown(e: KeyboardEvent) {
		const step = 80 / 2 ** camera.zoom;
		const pan: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		if (WALK[e.key] && !e.shiftKey && shown && !morph) {
			// Walk the tree; the first key starts at the selection, or at the first source.
			e.preventDefault();
			moveCursor(
				cursor < 0
					? selectedBus >= 0
						? selectedBus
						: walk.step(-1, 'root')
					: walk.step(cursor, WALK[e.key])
			);
		} else if (e.key === 'Tab' && !e.shiftKey && cursor >= 0 && equipment) {
			// Cycle the branches on shared routes at the cursor bus; past the last, Tab moves on.
			const members = graph.edges.flatMap((_, k) => {
				const { from, to } = inputs.names.branches[k];
				return (from === cursor || to === cursor) && equipment!.routeOf[k] >= 0 ? [k] : [];
			});
			const next = members.indexOf(tabEdge) + 1;
			if (next >= members.length) {
				tabEdge = -1;
				pinnedGroup = null;
				return;
			}
			e.preventDefault();
			tabEdge = members[next];
			pinnedGroup = equipment.routeOf[tabEdge];
			mc.hovered = { kind: 'branch', id: graph.edges[tabEdge].id };
			announcement = `${branchTip(tabEdge)}. Enter selects; Tab for the next.`;
		} else if (e.key === 'Enter' && tabEdge >= 0) {
			e.preventDefault();
			onselectedge(graph.edges[tabEdge].id);
		} else if (e.key === 'Enter' && cursor >= 0) {
			e.preventDefault();
			onselectbus(graph.buses[cursor].id);
		} else if (e.key === 'Escape' && pinnedGroup !== null) {
			pinnedGroup = null;
			tabEdge = -1;
		} else if (e.key === 'Escape' && cursor >= 0) {
			cursor = -1;
			announcement = '';
		} else if (pan[e.key]) {
			e.preventDefault();
			setCamera({
				target: [camera.target[0] + pan[e.key][0], camera.target[1] + pan[e.key][1], 0],
				zoom: camera.zoom
			});
		} else if (e.key === '+' || e.key === '=') zoomBy(0.5);
		else if (e.key === '-' || e.key === '_') zoomBy(-0.5);
		else if (e.key === 'f' || e.key === 'F') setCamera(fitCamera(geometry));
	}

	const layoutName = $derived(
		layout === 'schematic'
			? `Schematic (${strategy === 'tidy' ? 'tidy' : 'leaf order'} from the sources)`
			: mc.coordsKind === 'geographic'
				? 'Source positions (Web Mercator)'
				: 'Source positions (drawing)'
	);
	function exportTitle() {
		return titleBlock({
			dataset: mc.label,
			layout: layoutName,
			view: COLOURS[colour],
			camera,
			result: snapshot
				? {
						kind: 'solved',
						label: snapshot.label,
						iterations: snapshot.iterations,
						revision: `solve ${mc.result?.solve_count ?? '?'}`
					}
				: null,
			exported: new Date().toISOString()
		});
	}
	const fileStem = () => `${mc.label.replace(/[^\w.-]+/g, '_')}-schematic`;
	function download(blob: Blob, name: string) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	function exportPng() {
		if (!deck || !canvas) return;
		// Read the drawing buffer in the same task as a forced draw, before it is cleared.
		deck.redraw('export');
		const k = canvas.width / canvas.clientWidth;
		const out = document.createElement('canvas');
		const ctx = out.getContext('2d');
		if (!ctx) return;
		out.width = canvas.width;
		out.height = canvas.height + TITLE_BLOCK_HEIGHT * k;
		ctx.fillStyle = 'rgb(252 251 247)';
		ctx.fillRect(0, 0, out.width, out.height);
		ctx.drawImage(canvas, 0, 0);
		const t = exportTitle();
		for (const [col, lines] of [t.left, t.right].entries())
			lines.forEach((line, i) => {
				const lead = col === 0 && i === 0;
				ctx.font = `${lead ? '600 ' : ''}${(lead ? 12 : 11) * k}px "IBM Plex Mono", monospace`;
				ctx.fillStyle = lead ? 'rgb(32 36 43)' : 'rgb(77 81 86)';
				ctx.fillText(
					fitText(line, canvas!.clientWidth / 2),
					(col * out.width) / 2 + 12 * k,
					canvas!.height + (18 + i * 15) * k
				);
			});
		out.toBlob((blob) => blob && download(blob, `${fileStem()}.png`), 'image/png');
	}
	/** The schematic as a PowerIO diagram layer: load it with the case to reuse the layout. */
	function exportLayer() {
		const layer = diagramLayer(graph, geometry, {
			strategy,
			version: geometry.version ?? 0
		});
		download(new Blob([layer], { type: 'application/geo+json' }), `${fileStem()}.geo.json`);
	}
	function exportSvg() {
		const g = geometry;
		const scale = 2 ** camera.zoom;
		const x0 = camera.target[0] - width / 2 / scale;
		const y0 = camera.target[1] - height / 2 / scale;
		const css = (c: RGBA) => `rgb(${c[0]} ${c[1]} ${c[2]})`;
		try {
			const svg = viewportSvg({
				bounds: [x0, y0, x0 + width / scale, y0 + height / scale],
				scale,
				width: Math.round(width),
				height: Math.round(height),
				background: css(PAPER),
				ink: css(INK),
				muted: 'rgb(77 81 86)',
				lineSets: [
					{
						sources: drawn.sources,
						targets: drawn.targets,
						colors: segmentColours(drawn),
						count: drawn.segmentEdge.length,
						widths: segmentWidths(drawn)
					},
					...(symbolsOn && equipment
						? [
								{
									sources: equipment.sources,
									targets: equipment.targets,
									colors: strokeColours(equipment.owner),
									count: equipment.sources.length / 3,
									width: 1.25
								},
								...(ticksOn
									? [
											{
												sources: equipment.ticks.sources,
												targets: equipment.ticks.targets,
												colors: strokeColours(equipment.ticks.edge),
												count: equipment.ticks.edge.length,
												width: 1
											}
										]
									: [])
							]
						: [])
				],
				points: {
					positions: g.positions,
					colors: Uint8Array.from(busColours.flat()),
					count: graph.buses.length,
					radius: 2.6
				},
				markers:
					selectedBus >= 0
						? [
								{
									position: g.positions.subarray(selectedBus * 3, selectedBus * 3 + 2),
									radius: 7,
									stroke: css(ACCENT)
								}
							]
						: [],
				texts: labels.map((l) => ({
					position: l.position,
					text: l.text,
					dx: 6,
					dy: -8,
					color: css(l.state === 'violation' ? DANGER : l.state === 'warning' ? WARNING : INK)
				})),
				title: exportTitle()
			});
			download(new Blob([svg], { type: 'image/svg+xml' }), `${fileStem()}.svg`);
		} catch (e) {
			status = e instanceof Error ? e.message : String(e);
			setTimeout(() => (status = null), 4000);
		}
	}
</script>

<div class="schematic-stage" bind:clientWidth={width} bind:clientHeight={height}>
	<p id="schematic-keys" class="sr-only">
		Arrow keys walk the network from bus to bus: left to the feeding bus, right onward, up and down
		between neighbours; Home returns to the source; Enter selects; Escape stops. Where lines share a
		route, Tab at a bus steps through them. Shift with the arrow keys pans; plus and minus zoom; F
		fits the drawing.
	</p>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (The canvas supports keyboard panning and zooming; selection is also available from the overview.) -->
	<div
		class="canvas"
		role="application"
		aria-label="Schematic diagram"
		aria-describedby="schematic-keys"
		tabindex="0"
		{onkeydown}
	>
		<div class="basemap" bind:this={mapBox} style:opacity={basemapOpacity} aria-hidden="true"></div>
		<canvas bind:this={canvas}></canvas>
		<p class="sr-only" aria-live="polite">{announcement}</p>
	</div>
	<div
		class="toolbar"
		style:top="{panels.top + 8}px"
		style:left="{toolLeft}px"
		role="toolbar"
		aria-label="Schematic"
	>
		<div class="segmented" role="group" aria-label="Layout">
			<button
				aria-pressed={layout === 'source'}
				disabled={!source}
				title={source ? 'Positions from the case data' : 'This case has no source positions'}
				onclick={() => show('source', strategy)}
				>{mc.coordsKind === 'geographic' ? 'Geographic' : 'Source positions'}</button
			>
			<button aria-pressed={layout === 'schematic'} onclick={() => show('schematic', strategy)}
				>Schematic</button
			>
		</div>
		{#if layout === 'source' && mc.coordsKind === 'geographic'}
			<label class="check" title="Map tiles under the geographic positions, as on the main map"
				><input
					type="checkbox"
					checked={basemapOn}
					onchange={(e) => rememberBasemap(e.currentTarget.checked)}
				/> Basemap</label
			>
		{/if}
		{#if layout === 'schematic'}
			<label>
				<span class="sr-only">Schematic arrangement</span>
				<select
					value={strategy}
					title="Tidy packs subtrees closely; leaf order gives every leaf its own row"
					onchange={(e) => show('schematic', e.currentTarget.value as SchematicStrategy)}
				>
					<option value="tidy">Tidy</option>
					<option value="leaf-order">Leaf order</option>
				</select>
			</label>
		{/if}
		<label class="colour">
			<span class="sr-only">Colour by</span>
			<select
				bind:value={colour}
				disabled={!snapshot}
				title={snapshot ? 'Colour by' : 'Run the power flow to colour by results'}
			>
				{#each Object.entries(COLOURS) as [value, label] (value)}<option {value}>{label}</option
					>{/each}
			</select>
		</label>
		<button onclick={() => setCamera(fitCamera(geometry))} title="Fit the drawing (F)">Fit</button>
		{#if live.deadBuses}<span
				class="note"
				role="status"
				title="Buses with no path to a source through closed branches are drawn faint"
				>{live.deadBuses.toLocaleString()} bus{live.deadBuses === 1 ? '' : 'es'} not energised</span
			>{/if}
		<button onclick={exportPng} title="PNG of this view with a title block">PNG</button>
		<button onclick={exportSvg} title="Vector SVG of the visible region with a title block"
			>SVG</button
		>
		<button onclick={onclose} title="Return to the map">Close</button>
		{#if layout === 'schematic'}<button
				onclick={exportLayer}
				title="Download this schematic as a PowerIO diagram layer (.geo.json) to reuse with the case"
				>Layout</button
			>{/if}
	</div>
	{#if colour !== 'none' && snapshot}
		<div class="legend" style:top="{panels.top + 50}px" style:left="{toolLeft}px">
			{#if colour === 'loading-heat'}
				Loading <span>0 %</span><i style:background={priceGradient}></i><span>≥ 100 %</span>
			{:else}
				Voltage <span>min</span><i style:background={sensGradient}></i><span>max</span> of each declared
				band, worst pair
			{/if}
			· grey: no limit or rating{live.deadBuses ? ' · faint: not energised' : ''}
		</div>
	{/if}
	{#if colour === 'none' && zoomedOut && landmarkPool.length}
		<details
			class="key"
			style:bottom="{panels.compact ? app.sheetInset + 12 : 24}px"
			style:left="{toolLeft}px"
			open={keyOpen}
			ontoggle={(e) => rememberKey(e.currentTarget.open)}
		>
			<summary>Key</summary>
			<label class="toggle"
				><input
					type="checkbox"
					checked={landmarksOn}
					onchange={(e) => rememberLandmarks(e.currentTarget.checked)}
				/> Landmarks</label
			>
			{#if landmarksOn}
				<ul class="symbols" aria-label="Landmarks">
					{#each [['source', 'source, always shown'], ['generator', 'generator'], ['ibr', 'large inverter-based resource'], ['transformer', 'transformer']] as [kind, label] (kind)}
						{#if landmarkPool.some((l) => l.kind === kind)}
							<li>
								<svg viewBox="-14 -12 28 24" width="28" height="24" aria-hidden="true"
									><path d={glyphPath(landmarkGlyph(kind as Landmark['kind']), 7)} /></svg
								>{label}
							</li>
						{/if}
					{/each}
				</ul>
				<p class="hint">More appear as you zoom in.</p>
			{/if}
		</details>
	{/if}
	{#if colour === 'none' && symbolsOn && legendGlyphs.length}
		<details
			class="key"
			style:bottom="{panels.compact ? app.sheetInset + 12 : 24}px"
			style:left="{toolLeft}px"
			open={keyOpen}
			ontoggle={(e) => rememberKey(e.currentTarget.open)}
		>
			<summary>Key</summary>
			<ul class="symbols" aria-label="Symbols">
				{#if equipment?.routeGroups.length}
					<li>
						<label class="toggle"
							><input
								type="checkbox"
								checked={separateAll}
								onchange={(e) => rememberSeparate(e.currentTarget.checked)}
							/> Separate overlapping lines</label
						>
					</li>
				{/if}
				{#if ticksOn && equipment?.ticks.edge.length}
					<li>
						<svg viewBox="-2 -12 28 24" width="28" height="24" aria-hidden="true"
							><path class="wire" d="M-2 0H26" /><path
								d={glyphPath(conductorTicks(3, true), 8, 12, 0)}
							/></svg
						>phases, ○ neutral
					</li>
				{/if}
				{#if valuesOn && arrows?.edge.length}
					<li>
						<svg viewBox="-2 -12 28 24" width="28" height="24" aria-hidden="true"
							><path class="wire" d="M-2 0H26" /><path
								class="flow"
								d="M9.6 -3.2L14.4 0L9.6 3.2"
							/></svg
						>active power flow
					</li>
				{/if}
				{#each legendGlyphs as [kind, glyph, label], i (i)}
					<li>
						<svg viewBox="-2 -12 28 24" width="28" height="24" aria-hidden="true"
							><path
								d={glyphPath(glyph!, 8, kind === 'transformer' || kind === 'switch' ? 12 : 2, 0)}
							/>{#if kind === 'transformer' || kind === 'switch'}<path
									class="wire"
									d="M-2 0H0.8M23.2 0H26"
								/>{:else}<path class="wire" d="M-2 -10V0H2" />{/if}</svg
						>{label}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
	{#if activeGroup !== null && equipment}
		{@const middle = routeMiddle(equipment.routeGroups[activeGroup], equipment.host, geometry)}
		{#if middle}
			{@const k = 2 ** camera.zoom}
			{@const sx = (middle[0] - camera.target[0]) * k + width / 2}
			{@const sy = (middle[1] - camera.target[1]) * k + height / 2}
			<!-- svelte-ignore a11y_no_static_element_interactions (Pointer bookkeeping only: the rows are buttons.) -->
			<div
				class="route-card"
				style:left={sx + 440 < width ? `${sx + 16}px` : null}
				style:right={sx + 440 < width ? null : `${width - sx + 16}px`}
				style:top={sy + 180 < height ? `${sy + 16}px` : null}
				style:bottom={sy + 180 < height ? null : `${height - sy + 16}px`}
				onpointerenter={() => {
					cardHovered = true;
					if (collapseTimer) clearTimeout(collapseTimer);
					collapseTimer = null;
				}}
				onpointerleave={() => {
					cardHovered = false;
					leaveGroup();
				}}
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						pinnedGroup = null;
						hoverGroup = null;
					}
				}}
			>
				<p>
					{equipment.routeGroups[activeGroup].length} branches on this route{pinnedGroup !== null
						? ''
						: ' · click to keep open'}
				</p>
				<ul aria-label="Branches on this route">
					{#each routeCardRows(activeGroup) as row (row.k)}
						<li>
							<button
								aria-pressed={selectedEdges.has(row.k)}
								onpointerenter={() => (mc.hovered = { kind: 'branch', id: row.id })}
								onpointerleave={() => (mc.hovered = null)}
								onclick={() => {
									pinnedGroup = activeGroup;
									onselectedge(row.id);
								}}
							>
								<span class="id" title={row.id}>{row.id}</span>
								<span>{row.kind}</span>
								<span>{row.level}</span>
								<span>{row.wires}</span>
								{#if row.loading}<span class={row.state}>{row.loading}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{/if}
	{#if basemapOpacity > 0}
		<p
			class="attribution"
			style:opacity={basemapOpacity}
			style:right="{panels.compact ? 12 : panels.dockWidth('right') + 24}px"
			style:bottom="{panels.compact ? app.sheetInset + 8 : 8}px"
		>
			{BASEMAP_ATTRIBUTION}
		</p>
	{/if}
	{#if status}<p class="status" role="status">{status}</p>{/if}
</div>

<style>
	.schematic-stage {
		position: absolute;
		inset: 0;
		background: var(--bg);
		color: var(--ink);
	}
	.canvas,
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.canvas:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -3px;
	}
	.toolbar {
		position: absolute;
		flex-wrap: wrap;
		max-width: calc(100% - 24px);
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 5px;
		font-size: 11px;
		background: var(--surface-panel, var(--paper));
		border: 1px solid var(--line);
		border-radius: 4px;
		box-shadow: var(--elev-1);
	}
	.toolbar button,
	.toolbar select {
		font: inherit;
		color: var(--ink);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 3px;
		padding: 4px 8px;
		cursor: pointer;
	}
	.toolbar button:disabled,
	.toolbar select:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.note {
		color: var(--text-secondary);
		padding: 0 4px;
	}
	.segmented {
		display: flex;
	}
	.segmented button {
		border-radius: 0;
	}
	.segmented button:first-child {
		border-radius: 3px 0 0 3px;
	}
	.segmented button:last-child {
		border-radius: 0 3px 3px 0;
		border-left: 0;
	}
	.segmented button[aria-pressed='true'] {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.legend {
		position: absolute;
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 4px 8px;
		font: 10px var(--font-mono);
		color: var(--text-secondary);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 3px;
	}
	.key {
		position: absolute;
		padding: 4px 8px;
		font: 10px var(--font-mono);
		color: var(--text-secondary);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 3px;
		box-shadow: var(--elev-1);
	}
	.basemap {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.attribution {
		position: absolute;
		margin: 0;
		padding: 1px 6px;
		font: 10px var(--font-mono);
		color: var(--text-secondary);
		background: color-mix(in srgb, var(--paper) 80%, transparent);
		border-radius: 2px;
		pointer-events: none;
	}
	.toolbar .check {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.route-card {
		position: absolute;
		z-index: 2;
		width: max-content;
		min-width: 280px;
		max-width: 420px;
		padding: 4px 6px;
		font: 10px var(--font-mono);
		color: var(--text-secondary);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 3px;
		box-shadow: var(--elev-1);
	}
	.route-card p {
		margin: 0 0 3px;
	}
	.route-card ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.route-card button {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto auto;
		gap: 8px;
		width: 100%;
		padding: 2px 4px;
		font: inherit;
		text-align: left;
		color: var(--ink);
		background: none;
		border: 0;
		border-radius: 2px;
		cursor: pointer;
	}
	.route-card button:hover,
	.route-card button[aria-pressed='true'] {
		background: var(--accent-soft);
	}
	.route-card .id {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.route-card .violation {
		color: var(--text-danger);
	}
	.route-card .warning {
		color: var(--accent);
	}
	.key .toggle {
		display: flex;
		gap: 4px;
		align-items: center;
		margin-top: 4px;
		color: var(--ink);
	}
	.key .hint {
		margin: 2px 0 0;
	}
	.key summary {
		cursor: pointer;
		color: var(--ink);
	}
	.symbols {
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}
	.symbols li {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.symbols path {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.1;
	}
	.symbols path.flow {
		stroke: var(--accent);
		stroke-width: 1.5;
	}
	.symbols path.wire {
		stroke: var(--text-secondary);
	}
	.legend i {
		display: inline-block;
		width: 90px;
		height: 7px;
		border-radius: 2px;
	}
	.status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--text-secondary);
		pointer-events: none;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
