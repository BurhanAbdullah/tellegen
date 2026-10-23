import type { ComponentProps } from 'svelte';
import TellegenMap from './TellegenMap.svelte';

export { default as TellegenMap } from './TellegenMap.svelte';
export {
	CARTO_STYLES,
	OPENFREEMAP_STYLES,
	attachBasemapFallback,
	cartoStyleUrl,
	defaultBasemap,
	isOpenFreeMapStyle,
	openFreeMapEdits,
	resolveBasemap
} from './basemap.js';
export type {
	BasemapFallbackReason,
	BasemapMapLike,
	BasemapProvider,
	BasemapSpec,
	BasemapStyle,
	BasemapSwitch,
	BasemapTheme,
	DefaultBasemap,
	MapProjection,
	MapTheme,
	ResolvedBasemap,
	StyleEdit
} from './basemap.js';
export {
	MAP_PALETTE,
	branchColor,
	branchWidth,
	busNeutral,
	busRadius,
	priceColor,
	priceDomain,
	priceGradient,
	scalarDomain,
	sensColor,
	sensFlatColor,
	sensGradient,
	sensNeutral,
	sensitivityDomain
} from './colors.js';
export { caseDeltas, displayMetaFor, displaySeriesFor } from './display.js';
export type { MapPalette, RGBA, SensitivityDomain } from './colors.js';
export type { DisplayOption } from './display.js';

export type TellegenMapProps = ComponentProps<typeof TellegenMap>;
