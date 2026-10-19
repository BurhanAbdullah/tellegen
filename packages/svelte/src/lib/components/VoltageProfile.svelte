<script lang="ts">
	import { rgbaCss } from '../format.js';
	import { isPhaseTerminal, phaseColor } from '../multiconductor.js';
	import { pairState, type VoltageProfile } from '../diagram/index.js';

	let {
		profile,
		busIds,
		selectedBus,
		onselectbus
	}: {
		profile: VoltageProfile;
		/** Bus ids in graph order, for labels and selection. */
		busIds: string[];
		selectedBus: string | null;
		onselectbus: (id: string) => void;
	} = $props();

	let showEnvelope = $state(true);
	// One Tab stop for the whole profile (a deep feeder has hundreds of points); arrow keys move
	// along the path (Left/Right) and between pairs (Up/Down), Enter selects.
	const rows = $derived(profile.zones.flatMap((zone) => zone.rows));
	let cursor = $state<{ row: number; pair: number } | null>(null);
	const active = $derived.by(() => {
		if (cursor && cursor.row < rows.length && cursor.pair < rows[cursor.row].pairs.length)
			return cursor;
		const selected = rows.findIndex((r) => busIds[r.bus] === selectedBus);
		return { row: selected >= 0 ? selected : rows.length - 1, pair: 0 };
	});
	let svgRoot = $state<HTMLDivElement>();
	function move(e: KeyboardEvent, row: number, pair: number) {
		const keys: Record<string, [number, number]> = {
			ArrowRight: [row + 1, pair],
			ArrowLeft: [row - 1, pair],
			ArrowDown: [row, pair + 1],
			ArrowUp: [row, pair - 1],
			Home: [0, pair],
			End: [rows.length - 1, pair]
		};
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onselectbus(busIds[rows[row].bus]);
			return;
		}
		const next = keys[e.key];
		if (!next) return;
		e.preventDefault();
		const r = Math.max(0, Math.min(rows.length - 1, next[0]));
		const k = Math.max(0, Math.min(rows[r].pairs.length - 1, next[1]));
		cursor = { row: r, pair: k };
		requestAnimationFrame(() =>
			svgRoot?.querySelector<SVGElement>(`[data-point="${r}-${k}"]`)?.focus()
		);
	}
	/** Row index across all zones, for the roving cursor. */
	const rowOffset = (z: number) =>
		profile.zones.slice(0, z).reduce((n, zone) => n + zone.rows.length, 0);
	const W = 320;
	const H = 132;
	const left = 40;
	const right = 8;
	const top = 8;
	const bottom = 18;

	const colour = (terminal: string) =>
		isPhaseTerminal(terminal) ? rgbaCss(phaseColor(terminal)) : 'var(--text-secondary)';
	const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(1));

	/** Axis range over measured values, declared limits and (when shown) the envelope. */
	function chart(zone: VoltageProfile['zones'][number]) {
		const values = zone.rows.flatMap((r) => [
			...r.pairs.flatMap((p) => [p.volts, p.min ?? p.volts, p.max ?? p.volts]),
			...(showEnvelope && r.envelope ? [r.envelope.min, r.envelope.max] : [])
		]);
		const lo = Math.min(...values);
		const hi = Math.max(...values);
		const pad = Math.max((hi - lo) * 0.12, 0.5);
		const y0 = lo - pad;
		const y1 = hi + pad;
		const n = zone.rows.length;
		const x = (i: number) =>
			n === 1 ? (left + W - right) / 2 : left + (i * (W - left - right)) / (n - 1);
		const y = (v: number) => top + ((y1 - v) / (y1 - y0)) * (H - top - bottom);
		const envelope = showEnvelope
			? zone.rows.flatMap((r, i) => (r.envelope ? [[x(i), r.envelope] as const] : []))
			: [];
		const band =
			envelope.length > 1
				? [
						...envelope.map(([px, e]) => `${px},${y(e.max)}`),
						...[...envelope].reverse().map(([px, e]) => `${px},${y(e.min)}`)
					].join(' ')
				: null;
		const pairs = zone.rows[0].pairs.map((p, k) => ({
			pair: p.pair,
			color: colour(p.pair[0]),
			line: zone.rows
				.flatMap((r, i) => (r.pairs[k] ? [`${x(i)},${y(r.pairs[k].volts)}`] : []))
				.join(' '),
			min: p.min === null ? null : y(p.min),
			max: p.max === null ? null : y(p.max)
		}));
		return { x, y, band, pairs, ticks: [y1 - pad, (y0 + y1) / 2, y0 + pad] };
	}
</script>

<div class="profile" bind:this={svgRoot}>
	<div class="heading">
		<span>{busIds[profile.root]} → {busIds[profile.target]} · {profile.pathBuses.length} buses</span
		>
		<label><input type="checkbox" bind:checked={showEnvelope} /> Envelope</label>
	</div>
	{#each profile.zones as zone, z (z)}
		{@const c = chart(zone)}
		<figure>
			<figcaption>
				{zone.reason} · {zone.rows[0].pairs.map((p) => p.pair.join('–')).join(' / ') || 'no pairs'}
			</figcaption>
			<svg viewBox="0 0 {W} {H}" role="group" aria-label="Volts versus branch steps, zone {z + 1}">
				{#each c.ticks as v, t (t)}
					<line class="grid" x1={left} x2={W - right} y1={c.y(v)} y2={c.y(v)} />
					<text x={left - 4} y={c.y(v) + 3} text-anchor="end">{fmt(v)}</text>
				{/each}
				{#if c.band}<polygon class="envelope" points={c.band}
						><title>Min–max of all buses at the same depth and reference</title></polygon
					>{/if}
				{#each c.pairs as p, k (k)}
					{#if p.min !== null}<line
							class="limit"
							x1={left}
							x2={W - right}
							y1={p.min}
							y2={p.min}
							stroke={p.color}
						/>{/if}
					{#if p.max !== null}<line
							class="limit"
							x1={left}
							x2={W - right}
							y1={p.max}
							y2={p.max}
							stroke={p.color}
						/>{/if}
					<polyline points={p.line} stroke={p.color} />
				{/each}
				{#each zone.rows as row, i (row.bus)}
					{#each row.pairs as p, k (k)}
						{@const bad = pairState(p) === 'violation'}
						{@const g = rowOffset(z) + i}
						<circle
							class="point"
							class:bad
							class:current={busIds[row.bus] === selectedBus}
							cx={c.x(i)}
							cy={c.y(p.volts)}
							r={bad ? 3.6 : 2.6}
							fill={bad ? 'var(--text-danger)' : 'var(--paper)'}
							stroke={colour(p.pair[0])}
							role="button"
							data-point="{g}-{k}"
							tabindex={active.row === g && active.pair === k ? 0 : -1}
							aria-label="{busIds[row.bus]} {p.pair.join('–')} {fmt(p.volts)} V{bad
								? ', violation'
								: ''}"
							onclick={() => onselectbus(busIds[row.bus])}
							onkeydown={(e) => move(e, g, k)}
							><title>{busIds[row.bus]} · {p.pair.join('–')} · {fmt(p.volts)} V</title></circle
						>
					{/each}
				{/each}
				<text x={left} y={H - 4}>step {zone.rows[0].step}</text>
				<text x={W - right} y={H - 4} text-anchor="end"
					>step {zone.rows[zone.rows.length - 1].step}</text
				>
			</svg>
		</figure>
	{/each}
	<p class="hint">
		{profile.notice} Arrow keys move along the path and between pairs. Dashed: declared limits{showEnvelope
			? ' · shaded: all buses at the same depth and reference'
			: ''}.
	</p>
</div>

<style>
	.profile {
		font-size: 11px;
	}
	.heading {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		color: var(--text-secondary);
	}
	.heading span {
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	figure {
		margin: 8px 0 0;
	}
	figcaption,
	.hint {
		color: var(--text-secondary);
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	svg text {
		font: 9px var(--font-mono);
		fill: var(--text-secondary);
	}
	.grid {
		stroke: var(--line);
		stroke-width: 0.6;
	}
	.envelope {
		fill: var(--text-secondary);
		fill-opacity: 0.14;
	}
	.limit {
		stroke-dasharray: 4 3;
		stroke-width: 0.8;
		opacity: 0.7;
	}
	polyline {
		fill: none;
		stroke-width: 1.5;
	}
	.point {
		cursor: pointer;
		stroke-width: 1.2;
	}
	.point.current {
		stroke-width: 2.4;
	}
	.point:focus-visible {
		outline: none;
		stroke: var(--accent);
		stroke-width: 3;
	}
</style>
