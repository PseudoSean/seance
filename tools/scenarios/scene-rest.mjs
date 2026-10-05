// The ps scene rests on a page nobody attends to (themeScene.ts
// createAttention): a desktop window that lost the focus, or that nobody has
// touched for two minutes, stays visible to the browser and would otherwise
// animate — and repaint the glass over the scene — all day.
//
//   NODE_ENV=production corepack yarn build && python3 -m http.server -d public 8001 &
//   node tools/browser-drive.mjs tools/scenarios/scene-rest.mjs
//
// No ircd: the connect form has the scene behind it. The run exports
// `sceneRest` so browser-drive leaves the page's attention alone, then:
// a blur rests the scene after 15 s (every SVG clock paused, no CSS
// animation running, the main thread's task time near nothing), the focus
// runs it at once; two minutes without input rest it, a pointer move runs
// it. Focus and blur are the window's events dispatched from the page —
// headless Chromium's focus is emulated, so a real one cannot be lost.

const BASE = "http://localhost:8001/";

export const url = BASE;
export const sceneRest = true;

const UNFOCUSED_REST_MS = 15_000;
const IDLE_REST_MS = 120_000;

const STATE = `(() => {
	const s = document.querySelector("#theme-scene");
	const svgs = [...s.querySelectorAll("svg")].filter((v) => !v.closest(".ps-off"));
	return {
		mounted: s.children.length > 0,
		paused: s.classList.contains("ps-paused"),
		svgs: svgs.length,
		svgsGoing: svgs.filter((v) => !v.animationsPaused()).length,
		running: s.getAnimations({subtree: true}).filter((a) => a.playState === "running").length,
	};
})()`;

/** Main-thread task time per second of wall clock, over `ms` (CDP Performance metrics). */
async function taskLoad(page, ms) {
	const read = async () => {
		const {metrics} = await page.send("Performance.getMetrics");
		const get = (name) => metrics.find((m) => m.name === name).value;
		return {task: get("TaskDuration"), at: get("Timestamp")};
	};
	const a = await read();
	await page.sleep(ms);
	const b = await read();
	return (b.task - a.task) / (b.at - a.at);
}

const pct = (x) => `${(x * 100).toFixed(1)} %`;

export default async function run(page) {
	await page.send("Performance.enable");
	await page.addInitScript(
		`try { localStorage.setItem("settings", JSON.stringify({theme: "ps"})); } catch (e) {}`
	);
	await page.goto(url, {waitForSelector: "#connect"});
	await page.waitFor(`document.querySelector("#theme-scene").children.length > 0`);
	await page.sleep(3000);

	const running = (s) => !s.paused && s.svgsGoing > 0 && s.running > 0;
	const resting = (s) => s.paused && s.svgsGoing === 0 && s.running === 0;
	const describe = (s) =>
		`ps-paused ${s.paused}; ${s.svgsGoing} of ${s.svgs} SVG clocks going; ${s.running} CSS animations running`;

	let s = await page.evaluate(STATE);
	page.check(`attended at load: the scene runs (${describe(s)})`, s.mounted && running(s));
	const busy = await taskLoad(page, 5000);

	// The window loses the focus: still running inside the grace, resting after it.
	await page.evaluate(`window.dispatchEvent(new Event("blur"))`);
	await page.sleep(UNFOCUSED_REST_MS - 5000);
	s = await page.evaluate(STATE);
	page.check(`10 s after a blur: still running (${describe(s)})`, running(s));
	await page.sleep(6000);
	s = await page.evaluate(STATE);
	page.check(`16 s after a blur: the scene rests (${describe(s)})`, resting(s));
	const still = await taskLoad(page, 5000);
	page.check(
		`resting, the main thread's task time falls: ${pct(busy)} running → ${pct(still)} resting`,
		still < busy / 4
	);
	await page.screenshot("scene-rest-resting");

	await page.evaluate(`window.dispatchEvent(new Event("focus"))`);
	s = await page.evaluate(STATE);
	page.check(`the focus back: the scene runs at once (${describe(s)})`, running(s));

	// Focused, untouched: rests after two minutes; a pointer move runs it.
	await page.sleep(IDLE_REST_MS - 10000);
	s = await page.evaluate(STATE);
	page.check(
		`focused, ${(IDLE_REST_MS - 10000) / 1000} s untouched: still running (${describe(s)})`,
		running(s)
	);
	await page.sleep(11000);
	s = await page.evaluate(STATE);
	page.check(
		`focused, ${(IDLE_REST_MS + 1000) / 1000} s untouched: the scene rests (${describe(s)})`,
		resting(s)
	);

	await page.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 400, y: 300});
	s = await page.evaluate(STATE);
	page.check(`a pointer move: the scene runs again (${describe(s)})`, running(s));
}
