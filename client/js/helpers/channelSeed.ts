/**
 * The seed a conversation's meadow grows from (the <3 theme,
 * docs/projects/heart-theme.md §5.2): FNV-1a over the lower-cased name, so
 * the same channel name grows the same meadow on every network and every
 * device. `scene` buckets it for attribute selectors, `seed` is the float for
 * calc(), rounded to 4 decimal places and clamped below 1 (the rounding
 * alone can hit exactly 1 for about 1 hash in 20000). Pure; no store, no DOM.
 */
export function conversationSeed(name: string): {scene: number; seed: number} {
	let h = 0x811c9dc5;
	const bytes = new TextEncoder().encode(name.toLowerCase());

	for (const byte of bytes) {
		h ^= byte;
		h = Math.imul(h, 0x01000193) >>> 0;
	}

	const seed = Math.min(0.9999, Math.round((h / 0x100000000) * 10000) / 10000);
	return {scene: h % 6, seed};
}
