// Links out of an installed app open in the browser, in a window of their
// own; in a browser tab they open a new tab as before
// (client/js/helpers/externalLinks.ts). No ircd needed.
//
//   corepack yarn build && python3 -m http.server -d public 8000 &
//   node tools/browser-drive.mjs tools/scenarios/external-links.mjs
//
// The installed app is emulated by answering `(display-mode: standalone)`; the
// Android and iOS ways out are checked by the URL the page navigates to,
// which is refused here (no app answers `intent:` or `x-safari-https:` on a
// Linux box), and window.open is recorded, not run.

const PORT = process.env.SEANCE_PORT ?? "8000";
const TARGET = "https://example.org/page?x=1#frag";

export const url = `http://localhost:${PORT}/`;

const ANDROID_UA =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

/** Put a `target=_blank` link on the page and record window.open calls. */
const SETUP = `(() => {
	window.__opened = [];
	window.open = (...args) => { window.__opened.push(args); return null; };
	let a = document.getElementById("ext-link");
	if (!a) {
		a = document.createElement("a");
		a.id = "ext-link";
		a.target = "_blank";
		a.rel = "noopener";
		a.textContent = "an external link";
		a.style.cssText = "position:fixed;top:40%;left:40%;z-index:99999;padding:1rem;background:#fff;color:#000";
		document.body.appendChild(a);
	}
	a.href = ${JSON.stringify(TARGET)};
	// Record whether the click was taken, after every listener has run.
	window.__taken = null;
	window.addEventListener("click", (e) => { window.__taken = e.defaultPrevented; }, {once: true});
	return true;
})()`;

export default async function run(page) {
	const navigations = [];
	page.on("Page.frameRequestedNavigation", (p) => navigations.push(p.url));
	await page.send("Page.enable");

	await page.goto(page.url, {waitForSelector: "#connect form"});

	const clickLink = async () => {
		await page.evaluate(SETUP);
		await page.click("#ext-link");
		await page.sleep(300);
		return JSON.parse(
			await page.evaluate(`JSON.stringify({opened: window.__opened, taken: window.__taken})`)
		);
	};

	// 1. A browser tab: nothing taken, the browser opens its new tab.
	const tab = await clickLink();
	await page.check(
		`in a browser tab the click is left alone (${JSON.stringify(tab)})`,
		tab.taken === false && tab.opened.length === 0
	);

	// 2. Installed on a desktop: a browser window of its own.
	// Headless Chromium does not emulate `display-mode`; the page asks
	// matchMedia at click time, so answer for it.
	await page.evaluate(`(() => {
		const real = window.matchMedia.bind(window);
		window.matchMedia = (query) =>
			query === "(display-mode: standalone)"
				? {matches: true, media: query, addEventListener() {}, removeEventListener() {}}
				: real(query);
	})()`);
	await page.check(
		"display-mode emulated",
		await page.evaluate(`matchMedia("(display-mode: standalone)").matches`)
	);
	const desktop = await clickLink();
	const [openedUrl, openedTarget, features] = desktop.opened[0] ?? [];
	await page.check(
		`installed on a desktop: window.open with window features (${JSON.stringify(desktop)})`,
		desktop.taken === true &&
			openedUrl === TARGET &&
			openedTarget === "_blank" &&
			/^popup,noopener,noreferrer,width=\d+,height=\d+$/.test(features ?? "")
	);

	// 3. A middle click or a modified click stays the user's.
	await page.evaluate(SETUP);
	await page.evaluate(
		`document.getElementById("ext-link").dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, ctrlKey: true}))`
	);
	const modified = JSON.parse(await page.evaluate(`JSON.stringify(window.__opened)`));
	await page.check("a ctrl-click is left to the browser", modified.length === 0);

	// 4. Installed on Android: the intent for the default browser.
	await page.send("Emulation.setUserAgentOverride", {
		userAgent: ANDROID_UA,
		platform: "Linux armv8l",
	});
	navigations.length = 0;
	const android = await clickLink();
	await page.sleep(300);
	const intent = navigations.find((u) => u.startsWith("intent:"));
	await page.check(
		`installed on Android: navigates to an intent, no window.open (${
			intent ?? JSON.stringify(navigations)
		})`,
		android.taken === true &&
			android.opened.length === 0 &&
			intent ===
				"intent://example.org/page?x=1#frag#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end"
	);
	await page.check("the app is still there", (await page.count("#connect form")) === 1);

	await page.check(
		`no console errors (${page.consoleErrors.join(" | ")})`,
		page.consoleErrors.length === 0
	);
}
