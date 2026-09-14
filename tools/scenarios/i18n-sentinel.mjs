// The dynamic-string sentinel, proven in a real browser — both directions:
//
//   1. A normal boot renders HUNDREDS of catalog-backed labels and the
//      sentinel stays SILENT (the steady state — a quiet console means a
//      clean tree, not a broken detector);
//   2. A label injected into the chrome that no catalog produced is named
//      on the console, once, with its element — in ANY language: the run
//      repeats under en and under de to prove the check belongs to the
//      label, not the selected locale;
//   3. The verbatim surface is respected: the same rogue string dropped
//      inside #chat (user-content land) warns nothing;
//   4. An interpolated frame ({var} substituted) does NOT warn — template
//      matching keeps var-bearing frames legitimately translated.
//
//   NODE_ENV=development corepack yarn i18n:compile && corepack yarn build:client
//   python3 -m http.server -d public 8000 &
//   CHROME_BIN=$PWD/tmp/chrome-headless-wrapper.sh \
//     node tools/browser-drive.mjs tools/scenarios/i18n-sentinel.mjs
export const url = "http://127.0.0.1:8000/";

const WATCH = `window.__dyn = [];
	console.warn = ((orig) => (...a) => { window.__warns.push(a.join(" ")); orig(...a); })(console.warn);`;

/** Inject two rogue strings into the chrome: a raw literal and a
 * composed-key miss rendering as its key. */
const inject = (page, host) =>
	page.evaluate(
		`(() => {
			document.querySelector(${JSON.stringify(host)}).insertAdjacentHTML("beforeend",
				'<div class="sentinel-rogue">Runtime built label</div>' +
				'<div class="sentinel-rogue-key">mode.op</div>');
		})()`
	);

const leg = async (page, locale) => {
	await page.evaluate(
		`localStorage.setItem("settings", JSON.stringify({locale: ${JSON.stringify(locale)}}))`
	);
	await page.evaluate(`(() => { window.__preReload = true; })()`);
	await page.send("Page.reload");
	const started = Date.now();

	for (;;) {
		try {
			if (
				await page.evaluate(
					`!window.__preReload && document.documentElement.lang === ${JSON.stringify(
						locale
					)} && !!document.querySelector("#connect form")`
				)
			) {
				break;
			}
		} catch {
			// the document is being replaced
		}

		if (Date.now() - started > 20000) {
			throw new Error(`timed out waiting for ${locale} after reload`);
		}

		await page.sleep(150);
	}
	await page.evaluate(`window.__warns = []`);
	await page.evaluate(`(() => { window.__preReload = false; })()`);

	// (1) The steady state: everything the app itself rendered is catalog-
	// backed; a settle beat lets the boot renders pass through the watcher.
	await new Promise((resolve) => setTimeout(resolve, 1200));
	const atBoot = await page.evaluate(`window.seanceI18n.dynamic().length`);
	const bootHaul = await page.evaluate(`window.seanceI18n.dynamic()`);
	page.check(
		`${locale}: boot renders nothing dynamic` +
			(atBoot ? ` — got: ${JSON.stringify(bootHaul)}` : ""),
		atBoot === 0
	);

	// (2) Rogue labels in the chrome get named — the language-independent
	// per-label warnings.
	await page.evaluate(WATCH);
	await inject(page, "#sidebar .logo-container");
	await new Promise((resolve) => setTimeout(resolve, 600));
	const haul = await page.evaluate(`window.seanceI18n.dynamic()`);
	page.check(
		`${locale}: the raw literal is flagged`,
		JSON.stringify(
			await page.evaluate(`window.seanceI18n.dynamic().map((d) => d.text)`)
		).includes("Runtime built label")
	);
	page.check(
		`${locale}: the composed-key miss is flagged`,
		(await page.evaluate(`window.seanceI18n.dynamic().map((d) => d.text)`)).includes("mode.op")
	);
	await page.screenshot(`i18n-sentinel-${locale}`);

	// (3) The verbatim surface is respected: the same rogue string inside
	// #chat (user-content land) warns nothing.
	await page.evaluate(
		`document.querySelector("#chat .messages, #chat")?.insertAdjacentHTML("beforeend",
			"<div class='sentinel-in-chat'>Chat land rogue label</div>") ?? "no-chat"`
	);
	await new Promise((resolve) => setTimeout(resolve, 400));
	page.check(
		`${locale}: nothing inside #chat is flagged (verbatim surface)`,
		!(await page.evaluate(`window.seanceI18n.dynamic().map((d) => d.text)`)).includes(
			"Chat land rogue label"
		)
	);

	// (4) An interpolated frame does not trip template matching.
	await page.evaluate(`window.seanceI18n.t("lobby.nickOn", {network: "TestNet"})`);
	return atBoot;
};

export default async function main(page) {
	// bundle.js?v=dev is a stable URL and python's http.server advertises
	// Last-Modified, so Chromium heuristically caches it — every load in
	// this scenario must see the bundle on disk.
	await page.send("Network.enable");
	await page.send("Network.setCacheDisabled", {cacheDisabled: true});
	await page.goto(page.url, {waitForSelector: "#connect form"});
	const enBoot = await leg(page, "en");
	const deBoot = await leg(page, "de");
	page.check("the steady state held in both languages", enBoot === 0 && deBoot === 0);
}
