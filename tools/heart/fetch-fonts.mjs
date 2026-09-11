// Downloads the <3 theme's fonts — Nunito and Baloo 2 as the variable woff2
// files Google Fonts serves (one file per style carrying a weight range),
// SIL OFL — from Google Fonts' CSS endpoint into client/themes/heart/, plus
// the licence texts from the google/fonts repository. Run once; the files
// are committed.
//
//   node tools/heart/fetch-fonts.mjs
//
// The variable files, not single-weight instances: the mockups the theme was
// approved against loaded the family from Google Fonts with several weights,
// which is served as the variable font, and a static instance cut from it
// renders visibly differently in some browsers. The endpoint hands Mac
// browsers a different build from Windows and Linux ones; the Windows/Linux
// build (also what Firefox gets) is the one bundled.
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("client/themes/heart");
// A modern UA makes the endpoint answer with woff2 URLs; Windows, Linux and
// Firefox UAs all get the same build.
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const FACES = [
	{
		file: "nunito-variable.woff2",
		css: "family=Nunito:ital,wght@0,400..800",
		weight: "400 800",
		style: "normal",
	},
	{
		file: "nunito-variable-italic.woff2",
		css: "family=Nunito:ital,wght@1,400..700",
		weight: "400 700",
		style: "italic",
	},
	{
		file: "baloo2-variable.woff2",
		css: "family=Baloo+2:wght@400..800",
		weight: "400 800",
		style: "normal",
	},
];
const LICENCES = [
	["OFL-Nunito.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt"],
	["OFL-Baloo2.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/OFL.txt"],
];

/**
 * The latin subset's woff2 URL out of the endpoint's stylesheet. Each
 * subset's comment (cyrillic, latin-ext, latin, …) stands BEFORE its
 * @font-face block, so the pair has to be matched as a unit: splitting on
 * "@font-face" and looking for the comment inside a block finds the block
 * before the right one — the latin-ext file, which has ā and ő but not a to
 * z, loads fine and then draws every plain letter in the fallback font.
 */
function latinUrl(css) {
	const pair = /\/\* (\S+) \*\/\s*@font-face \{([^}]*)\}/g;
	for (const m of css.matchAll(pair)) {
		if (m[1] !== "latin") continue;
		const u = m[2].match(/url\((https:[^)]+\.woff2)\)/);
		if (!u) break;
		if (!/unicode-range:\s*U\+0000-00FF/.test(m[2])) {
			throw new Error("the latin block does not start at U+0000: the picker is off");
		}
		return u[1];
	}
	throw new Error("no latin woff2 in the endpoint's answer");
}

await mkdir(OUT, {recursive: true});
for (const face of FACES) {
	const css = await (
		await fetch(`https://fonts.googleapis.com/css2?${face.css}&display=swap`, {
			headers: {"User-Agent": UA},
		})
	).text();
	const url = latinUrl(css);
	const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
	await writeFile(path.join(OUT, face.file), bytes);
	console.log(`${face.file} ${bytes.length} bytes ← ${url}`);
}
for (const [file, url] of LICENCES) {
	await writeFile(path.join(OUT, file), await (await fetch(url)).text());
	console.log(file);
}
