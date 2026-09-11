// Settings → Translation on the in-page fake worker (client/js/translate/
// fakePort.ts, reached with ?fakeTranslate on a development build): the
// language select, the formality and round-trip radios, the two engine
// toggles, and the model manager — download with a progress bar, the row
// turning "Downloaded", delete turning it back — plus the choice surviving
// a reload. Nothing in `yarn test` renders the tab.
//
//   corepack yarn build --mode=development && python3 -m http.server -d public 8021 &
//   node tools/browser-drive.mjs tools/scenarios/translate-settings.mjs
//
// A development build is required: the fake is compiled out of production.

const BASE = "http://localhost:8021/";

export const url = `${BASE}?fakeTranslate`;

const ROW = (id) => `.translate-model[data-model="${id}"]`;
const STATE = (id) =>
	`document.querySelector('${ROW(id)} .translate-model-state')?.textContent.trim()`;
const STORED = (key) => `JSON.parse(localStorage.getItem("settings") ?? "{}").${key} ?? null`;

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
	await page.waitFor(`document.querySelectorAll(".translate-model").length >= 3`, {
		label: "model rows rendered",
	});

	const llmId = await page.evaluate(`document.querySelector(".translate-model").dataset.model`);

	page.check(
		"device note says gpu",
		(await page.evaluate(`document.querySelector(".translate-device")?.textContent`)).includes(
			"can run the GPU model"
		)
	);
	page.check("LLM row not downloaded", (await page.evaluate(STATE(llmId))) === "Not downloaded");
	page.check(
		"target defaults to a full name",
		/^[A-Z][a-z]+/.test(
			await page.evaluate(
				`document.querySelector('select[name="translateTo"] option:checked').textContent`
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

	// The settings write through the window's onChange handler.
	await page.evaluate(
		`(() => {
			const el = document.querySelector('select[name="translateTo"]');
			el.value = "de";
			el.dispatchEvent(new Event("change", {bubbles: true}));
		})()`
	);
	await page.click(`input[name="translateFormality"][value="formal"]`);
	await page.click(`input[name="translateLlm"]`);
	page.check("translateTo stored", (await page.evaluate(STORED("translateTo"))) === "de");
	page.check(
		"formality stored",
		(await page.evaluate(STORED("translateFormality"))) === "formal"
	);
	page.check("llm toggle stored", (await page.evaluate(STORED("translateLlm"))) === false);

	// No page.reload in the harness: navigate back to the boot URL (the app
	// reboots and, with no saved network, lands on the connect page again)
	// and re-open Settings → Translation the way the scenario did the first time.
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await openSettings(page);
	await page.waitFor(`!!document.querySelector(".settings-menu button.translation")`, {
		label: "settings reopened",
	});
	await page.click(`.settings-menu button.translation`);
	await page.waitFor(`!!document.querySelector('select[name="translateTo"]')`, {
		label: "tab back",
	});
	page.check(
		"target survives a reload",
		(await page.evaluate(`document.querySelector('select[name="translateTo"]').value`)) === "de"
	);
	page.check(
		"formality survives a reload",
		(await page.evaluate(
			`document.querySelector('input[name="translateFormality"][value="formal"]').checked`
		)) === true
	);
	await page.screenshot("translation-settings-after");
}
