/**
 * The browsable emoji catalog: `emoji-catalog.json` (generated from gemoji by
 * `tools/generate-emoji-catalog.mjs`) read back into objects, with the
 * lowercase haystack {@link searchEmoji} matches against precomputed once.
 *
 * This module is only ever reached through `loadEmojiCatalog()` in `emoji.ts`,
 * which `import()`s it — that is what keeps ~110 kB of emoji data out of the
 * main bundle until somebody opens the picker.
 */

import raw from "./emoji-catalog.json";

export type EmojiEntry = {
	/** The character itself, e.g. `🎉`. */
	emoji: string;
	/** Primary gemoji alias, the one `:name:` in chat expands to this emoji. */
	name: string;
	/** Unicode's description, e.g. "party popper". */
	description: string;
	/** Other aliases and gemoji's tags, space separated; matched, never shown. */
	keywords: string;
	/** `" name description keywords "`, lowercased: what search reads. */
	haystack: string;
};

export type EmojiGroup = {
	/** Stable key for the tab bar and the scroll spy. */
	key: string;
	/** Unicode's group name, shown as the section heading. */
	label: string;
	/** The emoji standing in for the group on its tab. */
	icon: string;
	emoji: EmojiEntry[];
};

type RawEntry = [emoji: string, name: string, description: string, keywords: string];
type RawGroup = {key: string; label: string; icon: string; emoji: RawEntry[]};

const catalog: EmojiGroup[] = (raw.groups as RawGroup[]).map((group) => ({
	key: group.key,
	label: group.label,
	icon: group.icon,
	emoji: group.emoji.map(([emoji, name, description, keywords]) => ({
		emoji,
		name,
		description,
		keywords,
		// Leading and trailing spaces so `includes(" " + token)` is a
		// word-start test without a regular expression per query.
		haystack: ` ${name} ${description} ${keywords} `.toLowerCase(),
	})),
}));

export default catalog;
