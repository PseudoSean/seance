// The language selector end to end in a real browser (LanguageSelect.vue):
// the connect form carries a language <select> that works with no connection
// and no navigation, picking a locale re-labels the UI and flips <html dir>
// at once, the pick is remembered in the settings blob and drives the
// pre-paint script in client/index.html so the direction is right from the
// FIRST PAINT of the next load — and a production build never offers a
// dev-only locale.
//
//   corepack yarn build && python3 -m http.server -d public 8000 &
//   node tools/browser-drive.mjs tools/scenarios/i18n-language-switch.mjs
//
// Two builds, one scenario — the qqx pick needs a development build, the
// dev-only filter needs a production one (the selector filters AVAILABLE by
// devOnly, matching activate()'s "auto" resolution; an explicitly stored
// pick still activates, which is exactly what the reload half proves):
//
//   NODE_ENV=production corepack yarn build   # DEV=false: qqx not offered
//   node tools/browser-drive.mjs tools/scenarios/i18n-language-switch.mjs
//                                             # → the (e) assertions
//   NODE_ENV=development corepack yarn build  # DEV=true: qqx in the dropdown
//   node tools/browser-drive.mjs tools/scenarios/i18n-language-switch.mjs --dev
//                                             # → the (a)–(d) assertions
//
// (`webpack --mode development` is NOT the development build here: that is
// the mocha test build, whose output lands in test/public. The servable dev
// build is the plain `webpack` of `yarn build` run with NODE_ENV=development
// — the config's own mode and the compile step's baked DEV both follow it.)
//
// No system chromium on the box this was verified on, and unprivileged user
// namespaces are disabled, so the driver runs playwright's headless-shell
// through a wrapper that adds --no-sandbox --disable-dev-shm-usage:
//
//   CHROME_BIN=$PWD/tmp/chrome-headless-wrapper.sh \
//     node tools/browser-drive.mjs tools/scenarios/i18n-language-switch.mjs
//
// The screenshot is copied to tmp/scenarios/i18n-language-switch.png (the
// driver's own --out= also works, its default lands in tmp/browser-drive/).
//
// The sign-in mode's row is checked in the --dev run by swapping the SERVED
// config.json (branding is fetched at boot, so no rebuild is needed), the
// same deploy shape tools/scenarios/sign-in.mjs builds for; the file is
// restored afterwards.

import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";

const BASE = process.env.SEANCE_HTTP ?? "http://localhost:8000/";

export const url = BASE;

const SELECT = `[id="connect:locale"]`;
const ROW_LABEL = `label[for="connect:locale"]`;
const AUTO_OPTION = `[id="connect:locale"] option[value="auto"]`;
const SIGN_IN_FORM = `#connect form.sign-in`;
// The English copy of settings.locale (en.json; the label asserted to change).
const EN_LABEL = "Language — display language of the whole interface.";
const RLE = "\u202B"; // U+202B RIGHT-TO-LEFT EMBEDDING: qqx wraps every string in it

const DIR = `document.documentElement.dir`;
const LANG = `document.documentElement.lang`;
const ROW_TEXT = `(document.querySelector(${JSON.stringify(
	ROW_LABEL
)}) ?? {textContent: ""}).textContent`;
const SELECT_VALUE = `document.querySelector(${JSON.stringify(SELECT)})?.value ?? null`;
const OPTION_VALUES = `Array.from(document.querySelectorAll(${JSON.stringify(
	`${SELECT} option`
)})).map((o) => o.value)`;
const AUTO_TEXT = `(document.querySelector(${JSON.stringify(
	AUTO_OPTION
)}) ?? {textContent: ""}).textContent`;
const STORED_LOCALE = `JSON.parse(localStorage.getItem("settings") ?? "{}").locale ?? null`;

/** Sign-in deploy config swapped into the served config.json for one check. */
const SIGN_IN_CONFIG = JSON.stringify(
	{
		appName: "TestNet",
		defaultNetwork: {
			name: "TestNet",
			host: "127.0.0.1",
			port: 8067,
			tls: false,
			channels: ["#seance"],
			nick: "guest????",
		},
		features: {signIn: true, allowCustomServer: false, multiNetwork: false},
	},
	null,
	"\t"
);

/** Pick a language the way the dropdown does: set + `change`, which is what
 * a native <select> fires (a real mouse cannot open the OS popup headlessly;
 * the same dispatch the font-size scenario uses for its range input). */
const pick = (page, tag) =>
	page.evaluate(
		`(() => {
			const el = document.querySelector(${JSON.stringify(SELECT)});
			el.value = ${JSON.stringify(tag)};
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);

/** A cold reload: `Page.reload` on the same URL, polling on through the
 * document swap (evaluate fails while the old document is torn down;
 * reload-on-settings.mjs explains the dance). */
const reload = async (page, waitForSelector) => {
	await page.evaluate(`(() => { window.__preReload = true; })()`);
	await page.send("Page.reload");
	const started = Date.now();

	for (;;) {
		try {
			if (
				await page.evaluate(
					`!window.__preReload && !!document.querySelector(${JSON.stringify(
						waitForSelector
					)})`
				)
			) {
				return;
			}
		} catch {
			// the document is being replaced
		}

		if (Date.now() - started > 20000) {
			throw new Error(`timed out waiting for ${waitForSelector} after reload`);
		}

		await page.sleep(150);
	}
};

/** Installed before any page script, on every new document: wraps the
 * <html> `dir` setter so the scenario can prove the direction was set by the
 * pre-paint script — the first write in the document, before bundle.js. */
const DIR_HISTORY_HOOK = `(() => {
	window.__dirHistory = [];
	const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "dir");

	if (!desc || !desc.set) {
		return;
	}

	Object.defineProperty(HTMLElement.prototype, "dir", {
		get: desc.get,
		set(value) {
			window.__dirHistory.push(String(value));
			desc.set.call(this, value);
		},
		configurable: true,
		enumerable: desc.enumerable,
	});
})()`;

export default async function run(page) {
	const devBuild = page.flags.has("--dev");

	// Before the first navigation, so it covers the reloads too.
	await page.addInitScript(DIR_HISTORY_HOOK);

	// (a) On "/" with no connection and no navigation: the language select is
	// there, visible, and nothing dialed out.
	await page.goto(page.url, {waitForSelector: "#connect form"});
	const row = await page.rect(`#connect .connect-locale`);
	page.check("connect form shows the language row", !!row && row.width > 0 && row.height > 0);
	const select = await page.rect(SELECT);
	page.check("language select is present and visible", !!select && select.width > 0);
	page.check(
		"no connection was dialed",
		page.wsFrames.length === 0 && page.consoleErrors.length === 0
	);

	if (devBuild) {
		// The (a)–(d) flow: pick qqx, watch the flip, reload, watch it stick.
		const values = await page.evaluate(OPTION_VALUES);
		page.check("development build offers qqx", values.includes("qqx"));
		page.check("direction starts ltr", (await page.evaluate(DIR)) === "ltr");
		const before = await page.evaluate(ROW_TEXT);
		page.check("row label starts as the English copy", before === EN_LABEL);
		page.check(
			"auto option names the resolved tag",
			(await page.evaluate(AUTO_TEXT)) === "System default (English)"
		);

		// (b) Picking qqx: rtl, and a known label goes pseudo-localized.
		await pick(page, "qqx");
		await page.waitFor(`${DIR} === "rtl"`, {label: "html dir flips to rtl"});
		page.check("documentElement.lang is qqx", (await page.evaluate(LANG)) === "qqx");
		const after = await page.evaluate(ROW_TEXT);
		page.check(
			"row label is no longer the English copy",
			after !== EN_LABEL && before !== after
		);
		page.check("row label is pseudo-localized (RLE-wrapped)", after.includes(RLE));
		page.check(
			"auto option re-rendered for qqx",
			(await page.evaluate(AUTO_TEXT)).endsWith("(qqx)")
		);
		page.check(
			"pick stored in the settings blob",
			(await page.evaluate(STORED_LOCALE)) === "qqx"
		);

		// (c) Reload: the pick survived and the direction was right from the
		// first paint — __dirHistory[0] is the pre-paint script's write, which
		// runs before bundle.js.
		await reload(page, SELECT);
		page.check("pick survived the reload", (await page.evaluate(STORED_LOCALE)) === "qqx");
		page.check("select still shows qqx", (await page.evaluate(SELECT_VALUE)) === "qqx");
		page.check("direction still rtl after reload", (await page.evaluate(DIR)) === "rtl");
		page.check("html lang still qqx", (await page.evaluate(LANG)) === "qqx");
		page.check(
			"dir was rtl from first paint (pre-paint, before bundle.js)",
			(await page.evaluate(`(window.__dirHistory ?? [])[0]`)) === "rtl"
		);
		const history = await page.evaluate(`window.__dirHistory ?? []`);
		page.check(
			"every dir write in the reloaded document stayed rtl",
			history.length > 0 && history.every((v) => v === "rtl")
		);

		// (d) The screenshot deliverable: the remembered RTL connect form.
		const shot = await page.screenshot("i18n-language-switch");
		mkdirSync("tmp/scenarios", {recursive: true});
		copyFileSync(shot, "tmp/scenarios/i18n-language-switch.png");

		// The same row shared by the sign-in mode: swap the served branding
		// (fetched at boot, no rebuild), reload, restore.
		const originalConfig = readFileSync("public/config.json", "utf8");

		try {
			writeFileSync("public/config.json", SIGN_IN_CONFIG + "\n");
			await reload(page, `#connect form.sign-in`);
			const signInRow = await page.rect(`#connect form.sign-in .connect-locale`);
			page.check(
				"sign-in mode shows the language row too",
				!!signInRow && signInRow.width > 0 && signInRow.height > 0
			);
			page.check("sign-in mode kept the pick", (await page.evaluate(SELECT_VALUE)) === "qqx");
		} finally {
			writeFileSync("public/config.json", originalConfig);
		}
	} else {
		// The (e) assertions: a production build never offers a dev-only locale.
		const values = await page.evaluate(OPTION_VALUES);
		page.check("dropdown lists exactly System default + en", values.join(",") === "auto,en");
		page.check("qqx is absent from the dropdown", !values.includes("qqx"));
		page.check("direction starts ltr", (await page.evaluate(DIR)) === "ltr");
		page.check(
			"auto option names the resolved tag",
			(await page.evaluate(AUTO_TEXT)) === "System default (English)"
		);
		await page.screenshot("i18n-language-switch-prod");
	}

	page.check("no console errors", page.consoleErrors.length === 0);
}
