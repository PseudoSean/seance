/**
 * The seed a conversation's meadow grows from (the <3 theme,
 * docs/projects/heart-theme.md §5.2): FNV-1a over the lower-cased name, so
 * the same channel name grows the same meadow on every network and every
 * device. `scene` buckets it for attribute selectors, `seed` is the float for
 * calc(). Pure; no store, no DOM.
 */
export function conversationSeed(name: string): {scene: number; seed: number} {
	let h = 0x811c9dc5;
	const bytes = new TextEncoder().encode(name.toLowerCase());

	for (const byte of bytes) {
		h ^= byte;
		h = Math.imul(h, 0x01000193) >>> 0;
	}

	const seed = Math.round((h / 0x100000000) * 10000) / 10000;
	return {scene: h % 6, seed};
}
