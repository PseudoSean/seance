// Regenerates `client/js/helpers/ircmessageparser/shortcodes.json` from the
// `gemoji` package (devDependency): every alias an `:name:` shortcode accepts,
// mapped to the unicode character it renders as. The JSON is committed, so a
// regeneration is only needed when the gemoji dep is bumped:
//
//   node tools/generate-shortcode-map.mjs
//
// Keys are sorted for stable diffs. The finder that consumes the map
// (`findShortcode.ts`) only fires on a known alias, which is what keeps
// `10:30:45` from turning into emoji.

import {writeFileSync} from "fs";
import {createRequire} from "module";

const require = createRequire(import.meta.url);
const {nameToEmoji} = require("gemoji");

const map = Object.fromEntries(Object.entries(nameToEmoji).sort(([a], [b]) => (a < b ? -1 : 1)));

const out = new URL("../client/js/helpers/ircmessageparser/shortcodes.json", import.meta.url);
writeFileSync(out, JSON.stringify(map, null, "\t") + "\n");

console.log(`wrote ${out.pathname}: ${Object.keys(map).length} shortcodes`);
