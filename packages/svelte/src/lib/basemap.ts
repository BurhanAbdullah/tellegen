import type { StyleSpecification } from 'maplibre-gl';

/** Basemap selection and fallback for `TellegenMap`.
 *
 * The primary basemap is an OpenFreeMap style (no key, CORS open). The
 * fallback is the matching CARTO vector style, optionally keyed. A host can
 * replace either with its own style URL or inline `StyleSpecification`, or
 * disable the fallback with `null`. */

export type BasemapTheme = 'light' | 'dark';
export type BasemapStyle = string | StyleSpecification;

/** `TellegenMap`'s `theme` prop: the basemap theme, which also picks the
 * overlay palette. */
export type MapTheme = BasemapTheme;
/** `TellegenMap`'s `projection` prop. MapLibre's globe falls back to
 * Mercator at high zoom on its own. */
export type MapProjection = 'mercator' | 'globe';

export interface BasemapSpec {
	primary: BasemapStyle;
	fallback: BasemapStyle | null;
	/** Hide the style's `symbol` layers after every `style.load`. */
	hideLabels: boolean;
}

export const OPENFREEMAP_STYLES = {
	light: 'https://tiles.openfreemap.org/styles/positron',
	dark: 'https://tiles.openfreemap.org/styles/dark'
} as const;

export const CARTO_STYLES = {
	light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
	'light-nolabels': 'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json',
	dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
	'dark-nolabels': 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'
} as const;

/** A CARTO style URL with the optional API key appended as `key=`. */
export function cartoStyleUrl(style: string, apiKey?: string): string {
	if (!apiKey) return style;
	const separator = style.includes('?') ? '&' : '?';
	return `${style}${separator}key=${encodeURIComponent(apiKey)}`;
}

export interface DefaultBasemapOptions {
	/** Appended to the CARTO fallback URL. */
	cartoApiKey?: string;
	/** Default `true`: the CARTO fallback uses the `-nolabels` variant and the
	 * OpenFreeMap primary has its label layers hidden on load. */
	hideLabels?: boolean;
}

/** OpenFreeMap primary and CARTO fallback for a theme. */
export function defaultBasemap(theme: BasemapTheme, options: DefaultBasemapOptions = {}): BasemapSpec {
	const hideLabels = options.hideLabels ?? true;
	const variant = hideLabels ? (`${theme}-nolabels` as const) : theme;
	return {
		primary: OPENFREEMAP_STYLES[theme],
		fallback: cartoStyleUrl(CARTO_STYLES[variant], options.cartoApiKey),
		hideLabels
	};
}

export interface ResolveBasemapInput {
	/** Overrides the OpenFreeMap primary. */
	mapStyle?: BasemapStyle;
	/** Overrides the CARTO fallback; `null` disables the fallback. */
	fallbackMapStyle?: BasemapStyle | null;
	theme: BasemapTheme;
	hideBasemapLabels: boolean;
	cartoApiKey?: string;
}

/** The spec `TellegenMap` renders from its props: explicit styles win, the
 * theme fills in whatever is left, and `null` turns the fallback off. */
export function resolveBasemap(input: ResolveBasemapInput): BasemapSpec {
	const defaults = defaultBasemap(input.theme, {
		cartoApiKey: input.cartoApiKey,
		hideLabels: input.hideBasemapLabels
	});
	return {
		primary: input.mapStyle ?? defaults.primary,
		fallback: input.fallbackMapStyle === undefined ? defaults.fallback : input.fallbackMapStyle,
		hideLabels: input.hideBasemapLabels
	};
}

export type BasemapFallbackReason =
	| { kind: 'style-load'; message: string; status?: number }
	| { kind: 'source-forbidden'; message: string; status: number; sourceId: string }
	| { kind: 'tiles-unavailable'; message: string; sourceId: string }
	| { kind: 'webgl'; message: string };

/** The fields of a MapLibre `error` or `sourcedata` event the fallback reads. */
export interface BasemapMapEvent {
	error?: unknown;
	sourceId?: string;
	tile?: unknown;
	dataType?: string;
	isSourceLoaded?: boolean;
}

/** The slice of `maplibregl.Map` the fallback needs; a test drives a fake. */
export interface BasemapMapLike {
	on(type: string, listener: (event: BasemapMapEvent) => void): unknown;
	off(type: string, listener: (event: BasemapMapEvent) => void): unknown;
	setStyle(style: BasemapStyle, options?: { diff?: boolean }): unknown;
	/** MapLibre types this `boolean | void`; only `true` counts as loaded. */
	isStyleLoaded(): boolean | void;
}

export interface BasemapFallbackHandlers {
	/** The primary failed and the fallback style was requested. */
	onFallback?(reason: BasemapFallbackReason): void;
	/** No basemap can be shown: the fallback failed too, none was configured,
	 * or WebGL is unavailable. */
	onFailure?(reason: BasemapFallbackReason): void;
}

export interface BasemapFallbackOptions {
	/** Clock for the tile failure window; tests inject one. */
	now?: () => number;
}

/** Tile fetch failures from one source, with no tile of any source arriving,
 * that trip the fallback inside the window. */
const TILE_FAILURE_LIMIT = 6;
const TILE_FAILURE_WINDOW_MS = 10_000;
const FORBIDDEN_STATUSES = new Set([401, 403, 429]);
const FORBIDDEN_MESSAGE = /api key|forbidden|unauthorized/i;
const NETWORK_MESSAGE = /failed to fetch|load failed|network ?error|network request failed/i;
const WEBGL_MESSAGE = /webgl/i;

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	if (error && typeof error === 'object' && 'message' in error) return String(error.message);
	return error === undefined || error === null ? '' : String(error);
}

function errorStatus(error: unknown): number | undefined {
	if (error && typeof error === 'object' && 'status' in error) {
		const status = (error as { status?: unknown }).status;
		if (typeof status === 'number') return status;
	}
	return undefined;
}

/** Watch a map's `error` stream and switch to `spec.fallback` when the
 * primary basemap cannot be shown. Rules, in order:
 *
 * 1. an error with no `sourceId` before the first `style.load` is a style
 *    fetch failure: switch to the fallback once;
 * 2. a source or tile error with status 401, 403 or 429, or a message naming
 *    an API key, forbidden or unauthorized access: switch;
 * 3. more than six tile fetch failures within ten seconds while no tile of
 *    any source has arrived: switch;
 * 4. a WebGL error: report failure, no style can help;
 * 5. everything else is logged the way MapLibre logs an unhandled error,
 *    because registering this listener silences that default.
 *
 * After the switch the same rules report `onFailure` instead of switching
 * again, as they do when `spec.fallback` is `null`. Returns a detach
 * function. */
export function attachBasemapFallback(
	map: BasemapMapLike,
	spec: BasemapSpec,
	handlers: BasemapFallbackHandlers = {},
	options: BasemapFallbackOptions = {}
): () => void {
	const now = options.now ?? (() => Date.now());
	let styleLoaded = map.isStyleLoaded() === true;
	let fellBack = false;
	let failed = false;
	let tileFailures = 0;
	let tileWindowStart = 0;
	let tileArrived = false;

	const fail = (reason: BasemapFallbackReason) => {
		if (failed) return;
		failed = true;
		handlers.onFailure?.(reason);
	};
	const fallBack = (reason: BasemapFallbackReason) => {
		if (fellBack || spec.fallback === null) {
			fail(reason);
			return;
		}
		fellBack = true;
		styleLoaded = false;
		tileFailures = 0;
		tileArrived = false;
		handlers.onFallback?.(reason);
		map.setStyle(spec.fallback, { diff: false });
	};
	const passThrough = (event: BasemapMapEvent) => {
		console.error(event?.error ?? event ?? 'Empty error event');
	};

	const onStyleLoad = () => {
		styleLoaded = true;
	};
	const onSourceData = (event: BasemapMapEvent) => {
		if (event?.tile || event?.isSourceLoaded === true) tileArrived = true;
	};
	const onError = (event: BasemapMapEvent) => {
		const message = errorMessage(event?.error);
		const status = errorStatus(event?.error);
		if (WEBGL_MESSAGE.test(message)) {
			fail({ kind: 'webgl', message });
			return;
		}
		const sourceId = typeof event?.sourceId === 'string' ? event.sourceId : undefined;
		if (sourceId === undefined) {
			if (!styleLoaded) {
				fallBack({ kind: 'style-load', message, status });
				return;
			}
			passThrough(event);
			return;
		}
		if ((status !== undefined && FORBIDDEN_STATUSES.has(status)) || FORBIDDEN_MESSAGE.test(message)) {
			fallBack({ kind: 'source-forbidden', message, status: status ?? 0, sourceId });
			return;
		}
		if (event.tile && (status === undefined || status === 0) && NETWORK_MESSAGE.test(message)) {
			const t = now();
			if (tileFailures === 0 || t - tileWindowStart > TILE_FAILURE_WINDOW_MS) {
				tileWindowStart = t;
				tileFailures = 0;
				tileArrived = false;
			}
			tileFailures++;
			if (tileFailures > TILE_FAILURE_LIMIT && !tileArrived) {
				fallBack({ kind: 'tiles-unavailable', message, sourceId });
				return;
			}
		}
		passThrough(event);
	};

	map.on('style.load', onStyleLoad);
	map.on('sourcedata', onSourceData);
	map.on('error', onError);
	return () => {
		map.off('style.load', onStyleLoad);
		map.off('sourcedata', onSourceData);
		map.off('error', onError);
	};
}
