// Regenerates `client/js/helpers/emoji-catalog.json` from the `gemoji`
// package (devDependency): every emoji the picker can browse, grouped the way
// Unicode groups them, each with the shortcode it is typed as, its
// description and the words it is searched by. The JSON is committed, so a
// regeneration is only needed when the gemoji dep is bumped:
//
//   node tools/generate-emoji-catalog.mjs && npx prettier --write client/js/helpers/emoji-catalog.json
//
// Entries are tuples — [emoji, name, description, keywords] — because there
// are ~1900 of them and the file is downloaded by browsers; `emoji.ts` reads
// them back into objects. The group order is the one the tab bar shows, and
// within a group gemoji's own order is Unicode's, which is what every other
// picker lists.

import {writeFileSync} from "fs";
import {createRequire} from "module";

const require = createRequire(import.meta.url);
const {gemoji} = require("gemoji");
const shortcodes = require("../client/js/helpers/ircmessageparser/shortcodes.json");
const {version} = require("gemoji/package.json");

// gemoji's category → the key, label and tab icon the picker uses. Anything
// gemoji adds outside this table is a hard error rather than a silent drop.
const GROUPS = [
	["smileys", "Smileys & Emotion", "😀"],
	["people", "People & Body", "🧑"],
	["nature", "Animals & Nature", "🐻"],
	["food", "Food & Drink", "🍔"],
	["activities", "Activities", "⚽"],
	["places", "Travel & Places", "✈️"],
	["objects", "Objects", "💡"],
	["symbols", "Symbols", "🔣"],
	["flags", "Flags", "🏳️"],
];

const byCategory = new Map(
	GROUPS.map(([key, label, icon]) => [label, {key, label, icon, emoji: []}])
);

for (const entry of gemoji) {
	const group = byCategory.get(entry.category);

	if (!group) {
		throw new Error(`gemoji category with no group: ${entry.category}`);
	}

	const [name, ...aliases] = entry.names;

	// The preview shows `:name:` and the chat input expands it, so a name the
	// shortcode finder cannot see would be a lie in the UI.
	if (shortcodes[name] === undefined) {
		throw new Error(`gemoji name is not a known shortcode: ${name}`);
	}

	// Aliases and tags are only ever matched against, never shown.
	const keywords = [...aliases, ...entry.tags].join(" ");

	group.emoji.push([entry.emoji, name, entry.description, keywords]);
}

const catalog = {
	gemoji: version,
	groups: [...byCategory.values()],
};

const out = new URL("../client/js/helpers/emoji-catalog.json", import.meta.url);
writeFileSync(out, JSON.stringify(catalog, null, "\t") + "\n");

const total = catalog.groups.reduce((sum, group) => sum + group.emoji.length, 0);
console.log(`wrote ${out.pathname}: ${total} emoji in ${catalog.groups.length} groups`);
