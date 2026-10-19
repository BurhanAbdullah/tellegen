/** Short display names for long ids such as `lv_extension_02ad4cfa5ebe_0062383670bceb3c28d5`: ids
 * up to `max` characters are kept; longer ones keep their head and tail around an ellipsis, with
 * the tail lengthened past `max` only where needed to keep every short name unique. The full id stays in tooltips and panels. */
export function shortNames(ids: string[], max = 20): string[] {
	const out = ids.map((id) => id);
	const long = ids.flatMap((id, i) => (id.length > max ? [i] : []));
	const head = max - 6;
	let tail = 5;
	let pending = long;
	while (pending.length) {
		for (const i of pending) {
			const id = ids[i];
			out[i] = id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
		}
		const seen = new Map<string, number>();
		for (const name of out) seen.set(name, (seen.get(name) ?? 0) + 1);
		pending = pending.filter((i) => seen.get(out[i])! > 1 && out[i] !== ids[i]);
		tail += 3;
	}
	return out;
}
