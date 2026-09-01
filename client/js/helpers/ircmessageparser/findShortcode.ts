import {Part} from "./merge";
import shortcodes from "./shortcodes.json";

// What the shortcode finder found: the character the alias stands for, and
// the `:name:` that was typed.
export type ShortcodePart = Part & {
	emoji: string;
	shortcode: string;
};

// `:name:` for a name the map knows. Gating the match on the map is what
// keeps `10:30:45` from turning into emoji: `30` is not an alias, so nothing
// fires at all. Gemoji's aliases are lower-case words, digits, `_`, `-`, `+`.
const shortcodeRx = /:([a-z0-9_+-]+):/g;
const map = shortcodes as Record<string, string>;

function findShortcode(text: string): ShortcodePart[] {
	const result: ShortcodePart[] = [];
	let match: RegExpExecArray | null;

	while ((match = shortcodeRx.exec(text))) {
		const emoji = map[match[1]];

		if (emoji) {
			result.push({
				start: match.index,
				end: match.index + match[0].length,
				emoji,
				shortcode: match[0],
			});
		}
	}

	return result;
}

export default findShortcode;
