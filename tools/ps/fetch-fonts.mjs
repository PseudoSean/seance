// Downloads Mulish and Fraunces — the ps theme's bundled type
// (docs/projects/ps-theme.md §8) — as Google Fonts' variable woff2 files
// (one file per style carrying a weight range, the same builds the mockup
// loaded from Google — a single-weight instance cut from them renders
// visibly differently in some browsers), Latin, Latin Extended and
// Vietnamese as separate files, SIL OFL, from Google Fonts' CSS endpoint into
// client/themes/ps/, then writes their @font-face rules into
// client/themes/ps.css between the `/* ps:fonts:start` and
// `/* ps:fonts:end */` markers. Run once; the files and the block are
// committed.
//
//   node tools/ps/fetch-fonts.mjs
//
// The endpoint hands Mac browsers a different build from Windows and Linux
// ones; the Windows/Linux build (also what Firefox gets) is the one
// bundled.
//
// Latin AND Latin Extended, not Latin alone: a face with ā or ő but not a-z
// (or the reverse) loads fine and then draws the *other* half of the text
// in the fallback font — the latin-ext trap docs/projects/ps-theme.md §8
// calls out, proven by rendering rather than by FontFace status in Step 5 of
// the task that wrote this tool. Vietnamese is the same trap one step on: its
// stacked letters (ệ, ễ, U+1EA0-1EF9) are in neither of those files, so
// "Nguyễn" drew partly in the fallback until the vietnamese subset shipped
// too. Google's endpoint answers one stylesheet per request with one
// @font-face block per script subset, the subset named in a comment
// immediately before its block; this tool keeps the latin, latin-ext and
// vietnamese blocks for each face and discards the rest (cyrillic, greek, …),
// so Cyrillic, Greek and every other script this theme does not bundle fall
// back to the system stack mid-line — Fraunces ships no Cyrillic or Greek at
// all, and Mulish's is left unbundled here.
//
// The rules are written vietnamese first, then latin, then latin-ext. Where
// unicode-ranges overlap (ă, đ, ơ, ư, ₫ and a few combining marks are in the
// vietnamese block and in latin-ext; U+0304, U+0308 and U+0329 in all three),
// the face defined last is tried first, so every codepoint the latin and
// latin-ext files drew before the vietnamese file arrived is still drawn by
// them, and the vietnamese file draws only what they lack.
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";

const THEMES = path.resolve("client/themes/ps");
const CSS_FILE = path.resolve("client/themes/ps.css");
// A modern UA makes the endpoint answer with woff2 URLs; Windows, Linux and
// Firefox UAs all get the same build.
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// One entry per style; each is fetched once from the endpoint and yields three
// files (latin, latin-ext, vietnamese) and three @font-face rules.
const FACES = [
	{
		family: "Mulish",
		style: "normal",
		weight: "400 800",
		query: "family=Mulish:ital,wght@0,400..800",
		base: "mulish",
	},
	{
		family: "Mulish",
		style: "italic",
		weight: "400 800",
		query: "family=Mulish:ital,wght@1,400..800",
		base: "mulish-italic",
	},
	{
		family: "Fraunces",
		style: "normal",
		weight: "600 700",
		query: "family=Fraunces:wght@600..700",
		base: "fraunces",
	},
];

const LICENCES = [
	["OFL-Mulish.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/mulish/OFL.txt"],
	[
		"OFL-Fraunces.txt",
		"https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/OFL.txt",
	],
];

/** The script subsets kept, in the order their rules are written (see above). */
const SUBSETS = ["vietnamese", "latin", "latin-ext"];

/**
 * `fetch`, refusing anything but a 2xx answer: a 404 or a rate-limit page
 * would otherwise be written into a .woff2 or an OFL text as if it were one.
 */
async function get(url, init) {
	const res = await fetch(url, init);
	if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
	return res;
}

/**
 * The latin, latin-ext and vietnamese @font-face blocks out of the endpoint's
 * stylesheet. Each subset's comment (cyrillic, latin-ext, latin, …) stands
 * BEFORE its @font-face block, so the pair has to be matched as a unit:
 * splitting on "@font-face" and looking for the comment inside a block finds
 * the block before the right one — the latin-ext file, which has ā and ő
 * but not a to z, loads fine and then draws every plain letter in the
 * fallback font.
 */
function subsets(css) {
	const pair = /\/\* (\S+) \*\/\s*@font-face \{([^}]*)\}/g;
	const found = {};
	for (const m of css.matchAll(pair)) {
		if (!SUBSETS.includes(m[1])) continue;
		const url = m[2].match(/url\((https:[^)]+\.woff2)\)/)?.[1];
		const unicodeRange = m[2].match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
		if (!url || !unicodeRange) continue;
		found[m[1]] = {url, unicodeRange};
	}
	if (!found.latin) throw new Error("no latin block in the endpoint's answer");
	if (!found.latin.unicodeRange.startsWith("U+0000-00FF")) {
		throw new Error("the latin block does not start at U+0000: the picker is off");
	}
	if (!found["latin-ext"]) throw new Error("no latin-ext block in the endpoint's answer");
	if (!found.vietnamese) throw new Error("no vietnamese block in the endpoint's answer");
	// The stacked letters (ạ … ỹ) are what the vietnamese file is bundled for.
	if (!found.vietnamese.unicodeRange.split(/,\s*/).includes("U+1EA0-1EF9")) {
		throw new Error("the vietnamese block does not carry U+1EA0-1EF9: the picker is off");
	}
	return found;
}

/**
 * One @font-face rule, unquoted font-family (the tests match it that way).
 * unicode-range is left exactly as Google served it, on one line — stylelint's
 * max-line-length is disabled for it, same as the scene's other generated
 * gradient lists, since config-standard's multi-line list rules would force
 * one codepoint per line rather than a narrower wrap.
 */
function faceRule(family, style, weight, file, unicodeRange) {
	return `@font-face {
	font-family: ${family};
	font-style: ${style};
	font-weight: ${weight};
	font-display: swap;
	src: url("ps/${file}") format("woff2");
	/* stylelint-disable-next-line max-line-length -- Google's unicode-range list, unbroken as served */
	unicode-range: ${unicodeRange};
}`;
}

await mkdir(THEMES, {recursive: true});

const rules = [];
for (const face of FACES) {
	const stylesheet = await (
		await get(`https://fonts.googleapis.com/css2?${face.query}&display=swap`, {
			headers: {"User-Agent": UA},
		})
	).text();
	const found = subsets(stylesheet);

	// In SUBSETS' order, in both the files fetched and the rules written.
	for (const subset of SUBSETS) {
		const {url, unicodeRange} = found[subset];
		const file = `${face.base}-${subset}.woff2`;
		const bytes = new Uint8Array(await (await get(url)).arrayBuffer());
		await writeFile(path.join(THEMES, file), bytes);
		console.log(`${file} ${bytes.length} bytes ← ${url}`);
		rules.push(faceRule(face.family, face.style, face.weight, file, unicodeRange));
	}
}

for (const [file, url] of LICENCES) {
	await writeFile(path.join(THEMES, file), await (await get(url)).text());
	console.log(file);
}

const header = `/* ps:fonts:start — Mulish and Fraunces, fetched by \`node tools/ps/fetch-fonts.mjs\`:
 * Google Fonts' variable woff2 files, one file per style carrying a weight
 * range, Latin, Latin Extended and Vietnamese as separate files (a face needs
 * all of them, or plain, accented or Vietnamese text draws partly in the
 * fallback font — the latin-ext trap, docs/projects/ps-theme.md §8).
 * Vietnamese is written first, so where the ranges overlap the Latin files
 * still draw what they drew before it came. Cyrillic, Greek and every other
 * script this theme does not bundle fall back to the system stack mid-line. */`;
const block = `${header}\n\n${rules.join("\n\n")}\n\n/* ps:fonts:end */`;

const cssText = await readFile(CSS_FILE, "utf8");
const FONTS_HEADING = "/* ---- fonts ---- */";
const TOKENS_HEADING = "/* ---- tokens ---- */";

let updated;
if (cssText.includes("/* ps:fonts:start")) {
	const start = cssText.indexOf("/* ps:fonts:start");
	const endMarker = "/* ps:fonts:end */";
	const endAt = cssText.indexOf(endMarker);
	if (start === -1 || endAt === -1) {
		throw new Error("ps.css has a start marker but no matching end marker");
	}
	updated = cssText.slice(0, start) + block + cssText.slice(endAt + endMarker.length);
} else {
	const headingAt = cssText.indexOf(FONTS_HEADING);
	const tokensAt = cssText.indexOf(TOKENS_HEADING);
	if (headingAt === -1 || tokensAt === -1) {
		throw new Error(
			"ps.css has no /* ---- fonts ---- */ … /* ---- tokens ---- */ section to replace"
		);
	}
	const before = cssText.slice(0, headingAt + FONTS_HEADING.length);
	const after = cssText.slice(tokensAt);
	updated = `${before}\n\n${block}\n\n${after}`;
}

await writeFile(CSS_FILE, updated);
console.log("client/themes/ps.css updated");
