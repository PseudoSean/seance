// Downloads the <3 theme's fonts (Nunito 600/600i/800, Baloo 2 700; SIL OFL)
// from Google Fonts' CSS endpoint into client/themes/heart/, plus the licence
// texts from the google/fonts repository. Run once; the files are committed.
//
//   node tools/heart/fetch-fonts.mjs
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("client/themes/heart");
// A modern UA makes the endpoint answer with woff2 URLs.
const UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const FACES = [
	{file: "nunito-600.woff2", css: "family=Nunito:wght@600", weight: "600", style: "normal"},
	{
		file: "nunito-600-italic.woff2",
		css: "family=Nunito:ital,wght@1,600",
		weight: "600",
		style: "italic",
	},
	{file: "nunito-800.woff2", css: "family=Nunito:wght@800", weight: "800", style: "normal"},
	{file: "baloo2-700.woff2", css: "family=Baloo+2:wght@700", weight: "700", style: "normal"},
];
const LICENCES = [
	["OFL-Nunito.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt"],
	["OFL-Baloo2.txt", "https://raw.githubusercontent.com/google/fonts/main/ofl/baloo2/OFL.txt"],
];

/** The latin subset's woff2 URL out of the endpoint's stylesheet. */
function latinUrl(css) {
	const blocks = css.split("@font-face").slice(1);
	const latin = blocks.find((b) => b.includes("/* latin */"));
	const m = latin && latin.match(/url\((https:[^)]+\.woff2)\)/);
	if (!m) throw new Error("no latin woff2 in the endpoint's answer");
	return m[1];
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
