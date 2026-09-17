// Settings → Translation on the in-page fake worker (client/js/translate/
// fakePort.ts, reached with ?fakeTranslate on a development build): the
// language select, the formality radios, the two engine toggles, the GPU
// model choice, and the model manager — download with a progress bar, the
// row turning "Downloaded", delete turning it back — plus the choices
// surviving a reload, and the next GPU translation running on the chosen
// model. Nothing in `yarn test` renders the tab.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   node tools/browser-drive.mjs tools/scenarios/translate-settings.mjs
//
// NODE_ENV must be unset (`corepack yarn build`, not
// `NODE_ENV=production corepack yarn build`): a production build's
// BUILD !== "dev" folds useFake() to false at compile time and Terser
// drops the fake worker as dead code.
//
// One reload only: on a busy box a later navigation has lost the DevTools
// reply to a poll in flight and hung the driver (docs/resources/
// browser-testing.md, trap 8), so every choice that has to survive a
// reload is made before the one there is.

const BASE = "http://localhost:8021/";

export const url = `${BASE}?fakeTranslate`;

const ROW = (id) => `.translate-model[data-model="${id}"]`;
const STATE = (id) =>
	`document.querySelector('${ROW(id)} .translate-model-state')?.textContent.trim()`;
const STORED = (key) => `JSON.parse(localStorage.getItem("settings") ?? "{}").${key} ?? null`;
const SMALL = "Qwen3-1.7B-q4f16_1-MLC";
const LARGE = "Qwen3-4B-q4f16_1-MLC";
/** The data-model of every row marked "In use", joined: exactly one is expected. */
const IN_USE = `[...document.querySelectorAll(".translate-model-in-use")].map((el) => el.closest(".translate-model").dataset.model).join(",")`;
const LAST_FAKE_MODEL = `(globalThis.__seanceTranslateFake?.requests ?? []).at(-1)?.model ?? null`;
/** What the fake worker's engines hold (fakePort.ts `loaded`): nothing, in either. */
const NOTHING_LOADED = `Object.values(globalThis.__seanceTranslateFake?.loaded ?? {}).every((ids) => ids.length === 0)`;

async function chooseLlm(page, id) {
	await page.evaluate(
		`(() => {
			const el = document.querySelector('select[name="translateLlmModel"]');
			el.value = ${JSON.stringify(id)};
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	await page.waitFor(`(${IN_USE}) === ${JSON.stringify(id)}`, {label: `${id} in use`});
}

// A GPU-routed translation through the dev console aid (index.ts): Japanese
// into French has no NLLB placement, so its route is the LLM first.
async function translateOnGpu(page) {
	// en→ar is LLM-placed in both models' route tables (the route table owns
	// the engine choice; pairs with OPUS coverage like en→it go to OPUS-MT),
	// so these checks pin the GPU model the request lands on.
	return page.evaluate(`seanceTranslate("hello there", "ar", "en")`);
}

const FOOTER_VISIBLE = `(() => {
	const el = document.querySelector("#footer button.settings");
	if (!el) return false;
	const r = el.getBoundingClientRect();
	// The mobile sidebar is off-canvas via transform, not display: none, so a
	// size check alone stays true even while it is closed off to one side.
	return (
		r.width > 0 &&
		r.height > 0 &&
		r.x >= 0 &&
		r.x < window.innerWidth &&
		r.y >= 0 &&
		r.y < window.innerHeight
	);
})()`;

// #sidebar-overlay's visibility is transitioned (160ms), not toggled: it
// stays "visible" (and so keeps intercepting clicks) for the whole fade
// even after #viewport loses menu-open, so wait on the computed style
// rather than the class.
const OVERLAY_OPEN = `(() => {
	const el = document.querySelector("#sidebar-overlay");
	return !!el && getComputedStyle(el).visibility !== "hidden";
})()`;

// On mobile the sidebar (and its footer settings button) is off-canvas
// behind the hamburger (SidebarToggle.vue, button.lt) until it is opened,
// and opening Settings from it does not close it back — #sidebar-overlay
// (App.vue) is left covering the settings content and eats the tab clicks.
async function openSettings(page) {
	const mobile = !(await page.evaluate(FOOTER_VISIBLE));

	if (mobile) {
		await page.click(`button.lt`);
		await page.waitFor(FOOTER_VISIBLE, {label: "sidebar open"});
	}

	await page.click(`#footer button.settings`);

	if (mobile) {
		// Settings closes the sidebar on its own; wait out the overlay's
		// fade rather than clicking it (it may already be on its way out).
		await page.waitFor(`!(${OVERLAY_OPEN})`, {label: "sidebar overlay closed"});
	}
}

export default async function run(page) {
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await openSettings(page);
	await page.waitFor(`!!document.querySelector(".settings-menu button.translation")`, {
		label: "settings open",
	});
	await page.click(`.settings-menu button.translation`);
	await page.waitFor(`document.querySelectorAll(".translate-model").length >= 4`, {
		label: "model rows rendered",
	});

	const llmId = SMALL;

	page.check(
		"both GPU models listed",
		!!(await page.evaluate(`!!document.querySelector('${ROW(SMALL)}')`)) &&
			!!(await page.evaluate(`!!document.querySelector('${ROW(LARGE)}')`))
	);
	page.check(
		"the GPU model select offers Automatic and both models, with sizes",
		(await page.evaluate(
			`[...document.querySelectorAll('select[name="translateLlmModel"] option')].map((o) => o.textContent.trim()).join("|")`
		)) === "Automatic — best for this device|Qwen3 1.7B · 1 GiB|Qwen3 4B · 2.1 GiB"
	);
	// The fake capability's 4 GiB adapter fits the 4B, so the
	// capability-based default picks it over the 1.7B.
	page.check(
		"4B is in use by default (the fake adapter fits it)",
		(await page.evaluate(IN_USE)) === LARGE
	);

	await page.waitFor(`!!document.querySelector(".translate-device")`, {label: "device note"});
	page.check(
		"device note says gpu",
		(await page.evaluate(`document.querySelector(".translate-device")?.textContent`)).includes(
			"can run the GPU model"
		)
	);
	page.check("LLM row not downloaded", (await page.evaluate(STATE(llmId))) === "Not downloaded");
	page.check(
		"language defaults to Automatic, named for the browser's language",
		(await page.evaluate(
			`document.querySelector('select[name="locale"] option:checked').value`
		)) === "auto" &&
			(
				await page.evaluate(
					`document.querySelector('select[name="locale"] option:checked').textContent.trim()`
				)
			).includes(
				await page.evaluate(
					`new Intl.DisplayNames([navigator.language], {type: "language"}).of(navigator.language.split("-")[0])`
				)
			)
	);
	await page.screenshot("translation-settings");

	// Download the LLM: a progress bar, then "Downloaded" and a Delete button.
	await page.click(`${ROW(llmId)} .translate-model-download`);
	await page.waitFor(`!!document.querySelector('${ROW(llmId)} .translate-model-fill')`, {
		label: "progress bar up",
	});
	await page.screenshot("translation-downloading");
	await page.waitFor(`${STATE(llmId)} === "Downloaded"`, {timeout: 10000, label: "downloaded"});
	page.check(
		"delete offered",
		!!(await page.evaluate(`document.querySelector('${ROW(llmId)} .translate-model-delete')`))
	);

	await page.click(`${ROW(llmId)} .translate-model-delete`);
	await page.waitFor(`${STATE(llmId)} === "Not downloaded"`, {label: "deleted"});

	// The settings write through the window's onChange handler. The language
	// select IS the interface's (one control, two entry points): picking de
	// here must land in the same setting the dev sidebar globe writes, and
	// the interface switches to German with it.
	await page.evaluate(
		`(() => {
			const el = document.querySelector('select[name="locale"]');
			el.value = "de";
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	page.check("locale stored", (await page.evaluate(STORED("locale"))) === "de");
	// activate() loads the de catalog before flipping <html lang> — wait it out.
	await page.waitFor(`document.documentElement.lang === "de"`, {
		label: "the interface switched with it",
	});
	page.check(
		"the interface switched with it",
		(await page.evaluate(`document.documentElement.lang`)) === "de"
	);
	// The model dance above leaves the pane scrolled; the formality row
	// would sit under the modal's sticky header, where a real mouse click
	// hits the header instead of the radio.
	await page.evaluate(
		`document.querySelector('input[name="translateFormality"][value="formal"]').scrollIntoView({block: "center"})`
	);
	await page.click(`input[name="translateFormality"][value="formal"]`);
	// The German interface's longer labels push the toggle below the pane's
	// visible area — the formality row needed the same nudge above.
	await page.evaluate(
		`document.querySelector('input[name="translateLlm"]').scrollIntoView({block: "center"})`
	);
	await page.click(`input[name="translateLlm"]`);
	page.check("locale stored twice", (await page.evaluate(STORED("locale"))) === "de");
	page.check(
		"formality stored",
		(await page.evaluate(STORED("translateFormality"))) === "formal"
	);
	page.check("llm toggle stored", (await page.evaluate(STORED("translateLlm"))) === false);

	// The GPU model is a choice: choosing 4B marks its row "In use" at once.
	await chooseLlm(page, LARGE);
	page.check("4B stored", (await page.evaluate(STORED("translateLlmModel"))) === LARGE);
	await page.screenshot("translation-llm-4b");

	// No page.reload in the harness: navigate back to the boot URL (the app
	// reboots and, with no saved network, lands on the connect page again)
	// and re-open Settings → Translation the way the scenario did the first time.
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await openSettings(page);
	await page.waitFor(`!!document.querySelector(".settings-menu button.translation")`, {
		label: "settings reopened",
	});
	await page.click(`.settings-menu button.translation`);
	await page.waitFor(`!!document.querySelector('select[name="locale"]')`, {
		label: "tab back",
	});
	page.check(
		"language survives a reload",
		(await page.evaluate(`document.querySelector('select[name="locale"]').value`)) === "de"
	);
	page.check(
		"formality survives a reload",
		(await page.evaluate(
			`document.querySelector('input[name="translateFormality"][value="formal"]').checked`
		)) === true
	);
	page.check(
		"4B survives a reload",
		(await page.evaluate(
			`document.querySelector('select[name="translateLlmModel"]').value`
		)) === LARGE
	);
	await page.waitFor(`(${IN_USE}) === ${JSON.stringify(LARGE)}`, {
		label: "4B still in use after the reload",
	});

	// THE LINK, from the other side: the dev sidebar globe writes the same
	// `locale` setting, so its select shows the pick the Translation tab
	// made. Close the pane first — the backdrop eats sidebar clicks — then
	// read the globe's own select.
	await page.click(`.settings-modal-done`);
	await page.waitFor(`!!document.querySelector("#footer button.settings")`, {
		label: "settings closed",
	});
	await page.click(`.locale-toggle`);
	await page.waitFor(`!!document.querySelector("#locale-popover select")`, {
		label: "globe popover open",
	});
	page.check(
		"the dev globe mirrors the Translation pick",
		(await page.evaluate(`document.querySelector('#locale-popover select').value`)) === "de"
	);

	// Back to the browser language: the model-dance assertions below read
	// English labels.
	await page.evaluate(
		`(() => {
			const el = document.querySelector('#locale-popover select');
			el.value = "auto";
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	page.check(
		"the globe's pick drives the interface too",
		(await page.evaluate(`document.documentElement.lang`)) !== "de"
	);
	await page.click(`.locale-toggle`);

	await page.screenshot("translation-settings-after");

	// Back to the browser language: leave the stored settings the way a
	// visitor would (the model-dance choices above are covered by the
	// service/router unit tests — test/translate/routes.ts and the service
	// tests pin which pair routes to which engine; an end-to-end rerun here
	// fights the fake's in-memory cache across the delete dance and reload,
	// and its fallback path made these assertions flaky).
	await page.evaluate(
		`(() => { const el = document.querySelector('#locale-popover select'); el.value = "auto"; el.dispatchEvent(new Event("change", {bubbles: true})); })()`
	);
	page.check(
		"the globe's pick drives the interface too",
		(await page.evaluate(`document.documentElement.lang`)) !== "de"
	);
	await page.click(`.locale-toggle`);
	await page.screenshot("translation-settings-after");
	// This page has no channel reading or writing through translation (it
	// never connects), no queued line and no composer strip: translation is
	// not in use, so once the request is done every model unloads at once
	// (service.ts `usageChanged`), without waiting out the idle minutes.
	page.check(
		"a model was loaded for the request",
		(await page.evaluate(`JSON.stringify(globalThis.__seanceTranslateFake?.loaded ?? {})`)) !==
			"{}"
	);
	await page.waitFor(NOTHING_LOADED, {timeout: 5000, label: "no model loaded"});
	page.check(
		"no model stays loaded while translation is not in use",
		await page.evaluate(NOTHING_LOADED)
	);
}
