<script lang="ts">
	import type {
		Deck,
		Layer,
		OrthographicView,
		OrthographicViewState,
		PickingInfo
	} from '@deck.gl/core';
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
		leafOrderLayout,
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
	let status = $state<string | null>('Loading the schematic renderer…');

	const graph = $derived(mc.graph!);
	const tree = $derived(displayTree(graph));
	const inputs = $derived(graphInputs(graph));
	const schematic = $derived(leafOrderLayout(graph, tree));
	const source = $derived(
		mc.view ? sourceLayout(graph, mc.view.buses, mc.coordsKind === 'geographic', tree) : null
	);
	const geometry = $derived<SchematicGeometry>(layout === 'source' && source ? source : schematic);
	const snapshot = $derived(
		mc.overviewResult ? snapshotFromMcPf(mc.overviewResult, inputs.buses, inputs.branches) : null
	);
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

	/** Per-edge and per-bus colours for the active mode; results never recolour inactive branches. */
	const edgeColours = $derived(
		graph.edges.map((e, k): RGBA => {
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
			if (colour !== 'voltage-band' || !snapshot) return INK;
			const t = worstBand(snapshot.buses[i].pairs);
			return t === null ? MISSING_COLOUR : bandColour(t);
		})
	);

	function fitCamera(g: SchematicGeometry) {
		const [x0, y0, x1, y1] = g.bounds;
		const left = panels.compact ? 28 : panels.dockWidth('left') + 44;
		const right = panels.compact ? 28 : panels.dockWidth('right') + 44;
		const top = panels.top + 64;
		const bottom = panels.compact ? app.sheetInset + 24 : 88;
		const w = Math.max(80, width - left - right);
		const h = Math.max(80, height - top - bottom);
		const zoom = Math.log2(Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0)));
		const scale = 2 ** zoom;
		// Centre the drawing in the free area between the docked panels.
		const cx = (x0 + x1) / 2 - (left - right) / 2 / scale;
		const cy = (y0 + y1) / 2 - (top - bottom) / 2 / scale;
		return { target: [cx, cy, 0] as [number, number, number], zoom: Math.min(zoom, 4) };
	}

	function segmentColours(g: SchematicGeometry): Uint8Array {
		const out = new Uint8Array(g.segmentEdge.length * 4);
		for (let s = 0; s < g.segmentEdge.length; s++) {
			const k = g.segmentEdge[s];
			const c = edgeColours[k];
			out.set([c[0], c[1], c[2], g.role[k] === 2 ? 110 : c[3]], s * 4);
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
		const selectedSegments: number[] = [];
		if (selectedEdges.size)
			for (let s = 0; s < g.segmentEdge.length; s++)
				if (selectedEdges.has(g.segmentEdge[s])) selectedSegments.push(s);
		const point = (i: number): [number, number] => [g.positions[i * 3], g.positions[i * 3 + 1]];
		const base = {
			length: g.segmentEdge.length,
			attributes: {
				getSourcePosition: { value: g.sources, size: 3 },
				getTargetPosition: { value: g.targets, size: 3 }
			}
		};
		return [
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
					length: g.segmentEdge.length,
					attributes: {
						getSourcePosition: { value: g.sources, size: 3 },
						getTargetPosition: { value: g.targets, size: 3 },
						getColor: { value: segmentColours(g), size: 4, normalized: true }
					}
				},
				getWidth: colour === 'none' ? 1.6 : 2.2,
				widthUnits: 'pixels',
				pickable: true
			}),
			new LineLayer({
				...common,
				id: 'selected-branch',
				data: selectedSegments,
				getSourcePosition: (s: number) => [g.sources[s * 3], g.sources[s * 3 + 1], 0],
				getTargetPosition: (s: number) => [g.targets[s * 3], g.targets[s * 3 + 1], 0],
				getColor: ACCENT,
				getWidth: 4,
				widthUnits: 'pixels'
			}),
			new ScatterplotLayer({
				...common,
				id: `buses-${layout}`,
				data: graph.buses.map((_, i) => i),
				getPosition: (i: number) => [...point(i), 0],
				getFillColor: (i: number) => busColours[i],
				getRadius: 2.6,
				radiusUnits: 'pixels',
				radiusMinPixels: 2,
				pickable: true,
				updateTriggers: { getFillColor: [colour, snapshot], getPosition: layout }
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
				getAlignmentBaseline: 'top',
				getPixelOffset: [6, 6],
				background: true,
				getBackgroundColor: [...PAPER.slice(0, 3), 230] as RGBA,
				backgroundPadding: [3, 1],
				fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
				characterSet: 'auto'
			})
		];
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
				text: graph.buses[selectedBus].id,
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
		labels = placeLabels(candidates, { width, height, budget: 40 });
	}

	function render() {
		deck?.setProps({ layers: layers() });
	}

	// Build the renderer once the canvas exists.
	$effect(() => {
		if (!canvas || deck) return;
		const target = canvas;
		let cancelled = false;
		Promise.all([import('@deck.gl/core'), import('@deck.gl/layers')])
			.then(([core, layers]) => {
				if (cancelled) return;
				modules = { core, layers };
				camera = fitCamera(geometry);
				deck = new core.Deck({
					canvas: target,
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
					onClick: (info: PickingInfo) => {
						if (info.index < 0 || !info.layer) return;
						if (info.layer.id.startsWith('buses-')) onselectbus(graph.buses[info.index].id);
						else if (info.layer.id.startsWith('branches-'))
							onselectedge(graph.edges[geometry.segmentEdge[info.index]].id);
					},
					getTooltip: (info: PickingInfo) =>
						info.index >= 0 && info.layer?.id.startsWith('buses-')
							? `${graph.buses[info.index].id}`
							: info.index >= 0 && info.layer?.id.startsWith('branches-')
								? `${graph.edges[geometry.segmentEdge[info.index]].kind} ${graph.edges[geometry.segmentEdge[info.index]].id}`
								: null
				});
				status = null;
				updateLabels();
				render();
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
		deck?.finalize();
	});

	// Redraw when the data, colours or selection change; relabel when the camera moves.
	$effect(() => {
		void [geometry, edgeColours, busColours, selectedBus, selectedEdges, labels];
		if (!morph) render();
	});
	let labelFrame = 0;
	$effect(() => {
		void [camera, colour, snapshot, selectedBus, selectedEdges, geometry, width, height];
		if (!deck) return;
		cancelAnimationFrame(labelFrame);
		labelFrame = requestAnimationFrame(updateLabels);
	});

	// Bring an outside selection (overview, table, search) into view when it is off screen.
	$effect(() => {
		const i = selectedBus;
		if (i < 0 || !deck || morph) return;
		const g = geometry;
		const scale = 2 ** camera.zoom;
		const [x, y] = [g.positions[i * 3], g.positions[i * 3 + 1]];
		const sx = (x - camera.target[0]) * scale + width / 2;
		const sy = (y - camera.target[1]) * scale + height / 2;
		if (sx > 40 && sx < width - 40 && sy > 40 && sy < height - 40) return;
		setCamera({ target: [x, y, 0], zoom: camera.zoom });
	});

	function setCamera(next: { target: [number, number, number]; zoom: number }) {
		camera = next;
		deck?.setProps({ initialViewState: { ...next, minZoom: -24, maxZoom: 8 } });
	}

	/** Switch layout. Buses glide from where they are on screen to the new layout along straight
	 * chords; a warm-up frame uploads the target geometry before the clock starts. */
	function switchLayout(next: Layout) {
		if (next === layout || (next === 'source' && !source)) return;
		const before = geometry.positions;
		const from = { ...camera };
		layout = next;
		const to = fitCamera(geometry);
		setCamera(to);
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (!deck || reduced || graph.buses.length > MORPH_MAX_BUSES) return;
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
		const target = geometry.positions;
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
			lerpInto(m.cur, m.from, target, k);
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
	function onkeydown(e: KeyboardEvent) {
		const step = 80 / 2 ** camera.zoom;
		const pan: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step]
		};
		if (pan[e.key]) {
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
			? 'Schematic (leaf order from the sources)'
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
						sources: g.sources,
						targets: g.targets,
						colors: segmentColours(g),
						count: g.segmentEdge.length,
						width: 1.6
					}
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
					dy: 16,
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
		Arrow keys pan; plus and minus zoom; F fits the drawing. Select buses and branches from the
		overview, search or table, or click them here.
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
		<canvas bind:this={canvas}></canvas>
	</div>
	<div class="toolbar" style:top="{panels.top + 8}px" role="toolbar" aria-label="Schematic">
		<div class="segmented" role="group" aria-label="Layout">
			<button aria-pressed={layout === 'schematic'} onclick={() => switchLayout('schematic')}
				>Schematic</button
			>
			<button
				aria-pressed={layout === 'source'}
				disabled={!source}
				title={source ? 'Positions from the case data' : 'This case has no source positions'}
				onclick={() => switchLayout('source')}
				>{mc.coordsKind === 'geographic' ? 'Geographic' : 'Source positions'}</button
			>
		</div>
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
		<button onclick={exportPng} title="PNG of this view with a title block">PNG</button>
		<button onclick={exportSvg} title="Vector SVG of the visible region with a title block"
			>SVG</button
		>
		<button onclick={onclose} title="Return to the map">Close</button>
	</div>
	{#if colour !== 'none' && snapshot}
		<div class="legend" style:top="{panels.top + 50}px">
			{#if colour === 'loading-heat'}
				Loading <span>0 %</span><i style:background={priceGradient}></i><span>≥ 100 %</span>
			{:else}
				Voltage <span>min</span><i style:background={sensGradient}></i><span>max</span> of each declared
				band, worst pair
			{/if}
			· grey: no limit or rating
		</div>
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
		left: 50%;
		transform: translateX(-50%);
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
		left: 50%;
		transform: translateX(-50%);
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
