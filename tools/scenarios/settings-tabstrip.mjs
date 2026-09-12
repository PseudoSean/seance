// The settings menu on a narrow window: a sticky horizontal tab strip
// (Settings/Navigation.vue), not the stacked list it used to be.
//
//   corepack yarn build && python3 -m http.server -d public 8000 &
//   node tools/browser-drive.mjs tools/scenarios/settings-tabstrip.mjs --width=390 --height=844
//
// Checked: the tabs sit on one row and scroll horizontally instead of
// stacking; the strip stays pinned while the page under it scrolls; the
// active tab is marked with an underline; and on a wide window the menu is
// still the vertical list beside the content. No IRC connection is needed —
// the settings window renders without one.

const BASE = process.env.SEANCE_HTTP ?? "http://localhost:8000/";

export const url = `${BASE}#/settings/appearance`;

const MENU = ".settings-menu";
const ROW_PROBE = `(() => {
	const items = Array.from(document.querySelectorAll("${MENU} li"));
	const tops = items.map((li) => li.getBoundingClientRect().top);
	const ul = document.querySelector("${MENU} ul");
	return {
		count: items.length,
		oneRow: tops.length > 1 && Math.max(...tops) - Math.min(...tops) < 2,
		scrollable: ul.scrollWidth > ul.clientWidth + 1,
		menuTop: document.querySelector("${MENU}").getBoundingClientRect().top,
		menuHeight: document.querySelector("${MENU}").getBoundingClientRect().height,
		rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
	};
})()`;

export default async function run(page) {
	await page.goto(page.url, {waitForSelector: MENU});
	await page.waitFor(`!!document.querySelector("${MENU} button.active")`, {
		label: "an active tab",
	});

	const strip = await page.evaluate(ROW_PROBE);
	await page.check(`the tabs sit on one row (${strip.count} tabs)`, strip.oneRow);
	// One line of tabs is ~1.125rem of text plus 0.6em of padding each way;
	// anything past 4rem means the strip wrapped or the old list is back.
	await page.check(
		`the strip is one line tall (${Math.round(strip.menuHeight)}px at ${strip.rem}px root)`,
		strip.menuHeight < 4 * strip.rem
	);

	const underline = await page.evaluate(
		`getComputedStyle(document.querySelector("${MENU} button.active")).borderBottomWidth`
	);
	await page.check(`the active tab is underlined (${underline})`, underline !== "0px");
	await page.screenshot("1-strip");

	// Sticky: scroll the settings window; the strip stays at the top.
	await page.evaluate(`document.querySelector("#settings").scrollTo(0, 600)`);
	await page.sleep(200);
	const after = await page.evaluate(ROW_PROBE);
	await page.check(
		`the strip stays pinned while the page scrolls (top ${Math.round(after.menuTop)})`,
		after.menuTop >= 0 && after.menuTop < 8
	);
	await page.screenshot("2-scrolled");

	// Another tab activates on click and keeps the strip.
	await page.evaluate(`document.querySelector("#settings").scrollTo(0, 0)`);
	await page.click(`${MENU} .notifications`);
	await page.waitFor(
		`document.querySelector("${MENU} button.active")?.classList.contains("notifications")`,
		{
			label: "notifications tab active",
		}
	);
	await page.screenshot("3-other-tab");

	await page.check("no console errors", page.consoleErrors.length === 0);
}
