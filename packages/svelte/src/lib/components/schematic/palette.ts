import type { RGBA } from '../../colors.js';
import type { ZoneState } from '../../diagram/index.js';

export const INK: RGBA = [32, 36, 43, 255];
export const ACCENT: RGBA = [178, 94, 0, 255];
export const PAPER: RGBA = [252, 251, 247, 255];
export const DANGER: RGBA = [184, 50, 42, 255];
export const WARNING: RGBA = [178, 94, 0, 255];
export const SYMBOL_INK: RGBA = [52, 56, 62, 255];
/** Not connected to any source through closed branches: drawn faint in every colour mode. */
export const DEAD: RGBA = [196, 191, 182, 110];
export const HIDDEN: RGBA = [0, 0, 0, 0];
/** Network tags for networks within limits. */
export const ZONE_INK: RGBA = [70, 110, 150, 255];

export const MONO = 'IBM Plex Mono, ui-monospace, monospace';

/** A colour at another opacity. */
export const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

/** Ink for a label or mark by severity. */
export const stateInk = (state: string | undefined): RGBA =>
	state === 'violation' ? DANGER : state === 'warning' ? WARNING : INK;

/** Screen width of a zone's corridor on geographic positions. */
export const CORRIDOR_PX = 9;

/** Muted tints for networks within limits, kept clear of the warning and violation colours.
 * Networks drawn near each other get different ones, so a customer's network reads at a glance
 * where corridors touch. */
export const ZONE_TINTS: [number, number, number][] = [
	[70, 110, 150],
	[40, 140, 140],
	[100, 145, 70],
	[125, 95, 165],
	[100, 105, 120],
	[160, 90, 140]
];

/** Fill and outline per zone state. */
export const ZONE_COLOURS: Record<ZoneState, [RGBA, RGBA]> = {
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

/** MV and LV line widths in pixels: heavier when results colour the lines. */
export const lineWidths = (resultColours: boolean): [number, number] =>
	resultColours ? [3, 1.8] : [2.4, 1.1];
