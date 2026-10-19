/** The basemap under geographic positions: the main map's own vector style, drawn by a MapLibre map
 * kept in step with the schematic camera. Geographic positions are Web Mercator metres (y down)
 * relative to an origin, so the camera converts exactly. */

const R = 6_378_137;
const WORLD = 2 * Math.PI * R;

/** Shared with the main map, so both backgrounds look the same. */
export const BASEMAP_STYLE =
	'https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json';
export const BASEMAP_ATTRIBUTION = '© CARTO © OpenStreetMap contributors';

/** Longitude and latitude in degrees of a Web Mercator point in metres, y down. */
export function mercatorToLngLat(x: number, y: number): [number, number] {
	const lng = ((x / R) * 180) / Math.PI;
	const lat = ((2 * Math.atan(Math.exp(-y / R)) - Math.PI / 2) * 180) / Math.PI;
	return [lng, lat];
}

/** The MapLibre camera showing what a schematic camera shows: same centre, and a zoom at which
 * one metre spans the same pixels (MapLibre's world is 512 px wide at zoom 0). */
export function basemapCamera(
	camera: { target: [number, number, number] | [number, number]; zoom: number },
	origin: [number, number]
): { center: [number, number]; zoom: number } {
	return {
		center: mercatorToLngLat(camera.target[0] + origin[0], camera.target[1] + origin[1]),
		zoom: Math.log2((WORLD * 2 ** camera.zoom) / 512)
	};
}
