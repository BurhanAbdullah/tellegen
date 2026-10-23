import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CARTO_STYLES,
	OPENFREEMAP_STYLES,
	attachBasemapFallback,
	cartoStyleUrl,
	defaultBasemap,
	resolveBasemap,
	type BasemapFallbackReason,
	type BasemapMapEvent,
	type BasemapMapLike,
	type BasemapSpec,
	type BasemapStyle
} from '../src/lib/basemap.js';

type Listener = (event: BasemapMapEvent) => void;

/** The slice of a MapLibre map the fallback touches, driven by hand. */
class FakeMap implements BasemapMapLike {
	listeners = new Map<string, Set<Listener>>();
	styles: { style: BasemapStyle; options?: { diff?: boolean } }[] = [];
	loaded = false;
	on(type: string, listener: Listener) {
		let set = this.listeners.get(type);
		if (!set) this.listeners.set(type, (set = new Set()));
		set.add(listener);
		return this;
	}
	off(type: string, listener: Listener) {
		this.listeners.get(type)?.delete(listener);
		return this;
	}
	setStyle(style: BasemapStyle, options?: { diff?: boolean }) {
		this.styles.push({ style, options });
		this.loaded = false;
		return this;
	}
	isStyleLoaded() {
		return this.loaded;
	}
	emit(type: string, event: BasemapMapEvent = {}) {
		if (type === 'style.load') this.loaded = true;
		for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
	}
	listenerCount() {
		let n = 0;
		for (const set of this.listeners.values()) n += set.size;
		return n;
	}
}

/** MapLibre's AJAXError shape: `status` 0 for a network failure, else HTTP. */
function ajaxError(status: number, message: string) {
	return Object.assign(new Error(message), { status, url: 'https://tiles.example/0/0/0.pbf' });
}

const spec: BasemapSpec = {
	primary: 'https://primary.example/style.json',
	fallback: 'https://fallback.example/style.json',
	hideLabels: true
};

function attach(map: FakeMap, overrides: Partial<BasemapSpec> = {}, now?: () => number) {
	const onFallback = vi.fn<(r: BasemapFallbackReason) => void>();
	const onFailure = vi.fn<(r: BasemapFallbackReason) => void>();
	const detach = attachBasemapFallback(
		map,
		{ ...spec, ...overrides },
		{ onFallback, onFailure },
		now ? { now } : {}
	);
	return { onFallback, onFailure, detach };
}

describe('style URLs', () => {
	it('appends the CARTO key with the right separator', () => {
		expect(cartoStyleUrl(CARTO_STYLES.dark)).toBe(CARTO_STYLES.dark);
		expect(cartoStyleUrl(CARTO_STYLES.dark, 'abc 1')).toBe(`${CARTO_STYLES.dark}?key=abc%201`);
		expect(cartoStyleUrl('https://x.example/s.json?v=2', 'k')).toBe(
			'https://x.example/s.json?v=2&key=k'
		);
	});

	it('defaults to OpenFreeMap with the matching no-label CARTO fallback', () => {
		expect(defaultBasemap('light')).toEqual({
			primary: OPENFREEMAP_STYLES.light,
			fallback: CARTO_STYLES['light-nolabels'],
			hideLabels: true
		});
		expect(defaultBasemap('dark', { hideLabels: false, cartoApiKey: 'k' })).toEqual({
			primary: OPENFREEMAP_STYLES.dark,
			fallback: `${CARTO_STYLES.dark}?key=k`,
			hideLabels: false
		});
	});

	it('lets explicit styles win and null switch the fallback off', () => {
		const inline = { version: 8 as const, sources: {}, layers: [] };
		expect(resolveBasemap({ theme: 'dark', hideBasemapLabels: true })).toEqual(
			defaultBasemap('dark')
		);
		expect(resolveBasemap({ mapStyle: inline, theme: 'light', hideBasemapLabels: false })).toEqual({
			primary: inline,
			fallback: CARTO_STYLES.light,
			hideLabels: false
		});
		expect(
			resolveBasemap({
				mapStyle: 'https://a.example/s.json',
				fallbackMapStyle: null,
				theme: 'light',
				hideBasemapLabels: true
			})
		).toEqual({ primary: 'https://a.example/s.json', fallback: null, hideLabels: true });
		expect(
			resolveBasemap({
				fallbackMapStyle: 'https://b.example/s.json',
				theme: 'light',
				hideBasemapLabels: true,
				cartoApiKey: 'ignored-when-fallback-is-explicit'
			}).fallback
		).toBe('https://b.example/s.json');
	});
});

describe('attachBasemapFallback', () => {
	let consoleError: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		consoleError.mockRestore();
	});

	it('rule 1: a style fetch failure before style.load switches to the fallback once', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map);
		map.emit('error', { error: ajaxError(0, 'Failed to fetch') });
		expect(map.styles).toEqual([{ style: spec.fallback, options: { diff: false } }]);
		expect(onFallback).toHaveBeenCalledTimes(1);
		expect(onFallback.mock.calls[0][0]).toEqual({
			kind: 'style-load',
			message: 'Failed to fetch',
			status: 0
		});
		expect(onFailure).not.toHaveBeenCalled();
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('rule 1 reports the HTTP status of the style response', () => {
		const map = new FakeMap();
		const { onFallback } = attach(map);
		map.emit('error', { error: ajaxError(503, 'Service Unavailable') });
		expect(onFallback.mock.calls[0][0]).toMatchObject({ kind: 'style-load', status: 503 });
	});

	it('once only: a failing fallback style reports failure instead of switching again', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map);
		map.emit('error', { error: ajaxError(0, 'Failed to fetch') });
		map.emit('error', { error: ajaxError(0, 'Failed to fetch') });
		map.emit('error', { error: ajaxError(500, 'Internal Server Error') });
		expect(map.styles).toHaveLength(1);
		expect(onFallback).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure.mock.calls[0][0]).toMatchObject({ kind: 'style-load', status: 0 });
	});

	it('a style error after style.load is passed through, not treated as a fetch failure', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map);
		map.emit('style.load');
		const error = new Error('An image named "x" already exists.');
		map.emit('error', { error });
		expect(map.styles).toHaveLength(0);
		expect(onFallback).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledWith(error);
	});

	it('seeds the loaded state from the map when attached late', () => {
		const map = new FakeMap();
		map.loaded = true;
		const { onFallback } = attach(map);
		map.emit('error', { error: new Error('late style error') });
		expect(onFallback).not.toHaveBeenCalled();
		expect(map.styles).toHaveLength(0);
	});

	it('rule 2: a forbidden, unauthorized or rate-limited source switches', () => {
		for (const [status, text] of [
			[401, 'Unauthorized'],
			[403, 'Forbidden'],
			[429, 'Too Many Requests']
		] as const) {
			const map = new FakeMap();
			const { onFallback } = attach(map);
			map.emit('style.load');
			map.emit('error', { sourceId: 'carto', tile: {}, error: ajaxError(status, text) });
			expect(map.styles).toEqual([{ style: spec.fallback, options: { diff: false } }]);
			expect(onFallback.mock.calls[0][0]).toEqual({
				kind: 'source-forbidden',
				message: text,
				status,
				sourceId: 'carto'
			});
		}
	});

	it('rule 2 also matches an API key message without a status', () => {
		const map = new FakeMap();
		const { onFallback } = attach(map);
		map.emit('style.load');
		map.emit('error', { sourceId: 'carto', error: new Error('Missing API key') });
		expect(onFallback.mock.calls[0][0]).toEqual({
			kind: 'source-forbidden',
			message: 'Missing API key',
			status: 0,
			sourceId: 'carto'
		});
	});

	it('rule 3: more than six tile fetch failures with no tile arriving switch', () => {
		const map = new FakeMap();
		const { onFallback } = attach(map);
		map.emit('style.load');
		for (let i = 0; i < 6; i++) {
			map.emit('error', {
				sourceId: 'openmaptiles',
				tile: {},
				error: ajaxError(0, 'Failed to fetch')
			});
		}
		expect(map.styles).toHaveLength(0);
		expect(consoleError).toHaveBeenCalledTimes(6);
		map.emit('error', {
			sourceId: 'openmaptiles',
			tile: {},
			error: ajaxError(0, 'Failed to fetch')
		});
		expect(map.styles).toHaveLength(1);
		expect(onFallback.mock.calls[0][0]).toEqual({
			kind: 'tiles-unavailable',
			message: 'Failed to fetch',
			sourceId: 'openmaptiles'
		});
	});

	it('rule 3 stands down when a tile arrives inside the window', () => {
		const map = new FakeMap();
		const { onFallback } = attach(map);
		map.emit('style.load');
		for (let i = 0; i < 4; i++) {
			map.emit('error', {
				sourceId: 'openmaptiles',
				tile: {},
				error: ajaxError(0, 'Failed to fetch')
			});
		}
		map.emit('sourcedata', { sourceId: 'openmaptiles', dataType: 'source', tile: {} });
		for (let i = 0; i < 6; i++) {
			map.emit('error', {
				sourceId: 'openmaptiles',
				tile: {},
				error: ajaxError(0, 'Failed to fetch')
			});
		}
		expect(map.styles).toHaveLength(0);
		expect(onFallback).not.toHaveBeenCalled();
	});

	it('rule 3 forgets failures older than the ten second window', () => {
		let t = 0;
		const map = new FakeMap();
		const { onFallback } = attach(map, {}, () => t);
		map.emit('style.load');
		for (let i = 0; i < 6; i++) {
			map.emit('error', {
				sourceId: 'openmaptiles',
				tile: {},
				error: ajaxError(0, 'Failed to fetch')
			});
		}
		t = 10_001;
		map.emit('error', {
			sourceId: 'openmaptiles',
			tile: {},
			error: ajaxError(0, 'Failed to fetch')
		});
		expect(onFallback).not.toHaveBeenCalled();
		for (let i = 0; i < 6; i++) {
			map.emit('error', {
				sourceId: 'openmaptiles',
				tile: {},
				error: ajaxError(0, 'Failed to fetch')
			});
		}
		expect(onFallback).toHaveBeenCalledTimes(1);
	});

	it('rule 3 ignores a tile 404 or 500, which MapLibre reports with a status', () => {
		const map = new FakeMap();
		const { onFallback } = attach(map);
		map.emit('style.load');
		for (let i = 0; i < 10; i++) {
			map.emit('error', {
				sourceId: 'openmaptiles',
				tile: {},
				error: ajaxError(500, 'Failed to fetch')
			});
		}
		expect(onFallback).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalledTimes(10);
	});

	it('rule 4: a WebGL error reports failure without touching the style', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map);
		map.emit('error', { error: new Error('Failed to initialize WebGL') });
		expect(map.styles).toHaveLength(0);
		expect(onFallback).not.toHaveBeenCalled();
		expect(onFailure.mock.calls[0][0]).toEqual({
			kind: 'webgl',
			message: 'Failed to initialize WebGL'
		});
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('rule 5: anything else is logged the way MapLibre would have logged it', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map);
		map.emit('style.load');
		const error = new Error('Unexpected glyph error');
		map.emit('error', { sourceId: 'openmaptiles', error });
		map.emit('error', {});
		expect(onFallback).not.toHaveBeenCalled();
		expect(onFailure).not.toHaveBeenCalled();
		expect(consoleError).toHaveBeenNthCalledWith(1, error);
		expect(consoleError).toHaveBeenNthCalledWith(2, {});
	});

	it('reports failure directly when no fallback is configured', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map, { fallback: null });
		map.emit('error', { error: ajaxError(0, 'Failed to fetch') });
		expect(map.styles).toHaveLength(0);
		expect(onFallback).not.toHaveBeenCalled();
		expect(onFailure.mock.calls[0][0]).toMatchObject({ kind: 'style-load' });
	});

	it('after the switch, forbidden tiles from the fallback report failure once', () => {
		const map = new FakeMap();
		const { onFallback, onFailure } = attach(map);
		map.emit('error', { error: ajaxError(0, 'Failed to fetch') });
		map.emit('style.load');
		map.emit('error', { sourceId: 'carto', tile: {}, error: ajaxError(403, 'Forbidden') });
		map.emit('error', { sourceId: 'carto', tile: {}, error: ajaxError(403, 'Forbidden') });
		expect(onFallback).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure.mock.calls[0][0]).toMatchObject({ kind: 'source-forbidden', status: 403 });
		expect(map.styles).toHaveLength(1);
	});

	it('detach removes every listener', () => {
		const map = new FakeMap();
		const { onFallback, detach } = attach(map);
		expect(map.listenerCount()).toBe(3);
		detach();
		expect(map.listenerCount()).toBe(0);
		map.emit('error', { error: ajaxError(0, 'Failed to fetch') });
		expect(onFallback).not.toHaveBeenCalled();
		expect(map.styles).toHaveLength(0);
	});
});
