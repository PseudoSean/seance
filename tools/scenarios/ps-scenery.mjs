// The ps scene in the avatar's likeness and its shooting stars, in a real
// browser (docs/superpowers/specs/2026-11-26-ps-scene-mountains-design.md):
//
// - the clock pinned (a Date shim, in UTC) to days whose weather is known
//   (engine.ts weatherFor), the scene remounted at each by a theme round trip;
// - the peaks carry snow on a clear winter noon and none on a clear July or
//   October noon; on a snowy noon the ranges are pale and a channel keeps its
//   dark words;
// - the smoke stands on the stove pipe on the roof's right slope;
// - on a clear night at the Perseids' peak the shower's streaks are live and
//   running, none on a stormy night in the shower, none in Still or with
//   Reduce Motion on;
// - on a phone (--mobile --width=390 --height=844) the middle of the window
//   still shows a peak;
// - screenshots of day, dusk and night in winter and summer, and a peak night.
//
//   node tools/browser-drive.mjs tools/scenarios/ps-scenery.mjs
//   node tools/browser-drive.mjs tools/scenarios/ps-scenery.mjs --mobile --width=390 --height=844
//
// Serve a production build first (CLAUDE.md); SEANCE_PORT picks the port.
import {startTinyIrcd} from "./lib/tiny-ircd.mjs";

const PORT = process.env.SEANCE_PORT ?? "8000";
const IRCD_PORT = Number(process.env.IRCD_PORT ?? 9942);
const NICK = "seer";
const CHANNEL = "#plains";
export const url = `http://localhost:${PORT}/?host=127.0.0.1&port=${IRCD_PORT}&tls=false&nick=${NICK}&join=${encodeURIComponent(
	CHANNEL
)}`;

const STORE = `document.querySelector("[data-v-app]").__vue_app__.config.globalProperties.$store`;
const update = (name, value) =>
	`${STORE}.dispatch("settings/update", {name: ${JSON.stringify(name)}, value: ${JSON.stringify(
		value
	)}})`;

/** theme-ps.mjs's movable clock: `window.__setClock(ms)` puts the page at `ms`, running on. */
const CLOCK_SHIM = `(() => {
	const RealDate = Date;
	const realNow = RealDate.now.bind(RealDate);
	let offset = 0;
	function ShimDate(...a) {
		if (!new.target) return RealDate();
		return a.length ? new RealDate(...a) : new RealDate(realNow() + offset);
	}
	ShimDate.prototype = RealDate.prototype;
	ShimDate.now = () => realNow() + offset;
	ShimDate.UTC = RealDate.UTC;
	ShimDate.parse = RealDate.parse;
	window.Date = ShimDate;
	window.__setClock = (ms) => { offset = ms === null ? 0 : ms - realNow(); };
})()`;

/** Days whose weather the engine draws (UTC): checked against engine.ts when this was written. */
const AT = {
	winterNoon: "2027-01-10T12:30", // clear
	winterDusk: "2027-01-10T16:35",
	winterNight: "2027-01-10T22:00",
	snowNoon: "2027-01-05T12:30", // snow
	summerNoon: "2026-07-10T12:30", // clear
	summerDusk: "2026-07-10T20:50",
	summerNight: "2026-07-10T23:30",
	autumnNoon: "2026-10-10T12:30", // clear
	perseidPeak: "2026-08-12T02:00", // clear, new moon
	perseidStorm: "2027-08-05T02:00", // storm, in the shower
};

/** What the scene shows now: the caps, the near range, the words, the smoke on the pipe, the streaks. */
const READ = `JSON.stringify((() => {
	const s = document.getElementById("theme-scene");
	const cs = getComputedStyle(s);
	const shown = (el) => el && getComputedStyle(el).display !== "none" && !el.closest(".ps-off");
	const lum = (rgb) => {
		const [r, g, b] = (rgb.match(/[\\d.]+/g) || []).slice(0, 3).map((v) => {
			const c = Number(v) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const pipes = [...s.querySelectorAll(".ps-y-pipe")].map((p) => p.getBoundingClientRect());
	const pipe = pipes.reduce((a, b) => (b.height > a.height ? b : a), pipes[0]);
	const cap = pipes.reduce((a, b) => (b.top < a.top ? b : a), pipes[0]);
	const smoke = s.querySelector(".ps-smoke")?.getBoundingClientRect();
	const streaks = [...s.querySelectorAll(".ps-perseid, .ps-meteor")];
	const running = s.querySelector(".ps-meteors")
		? s.querySelector(".ps-meteors").getAnimations({subtree: true}).filter((a) => a.playState === "running").length
		: -1;
	return {
		snowOp: Number(cs.getPropertyValue("--ps-peak-snow-op")),
		capOp: Number(getComputedStyle(s.querySelector(".ps-m-snow")).opacity),
		nearLum: lum(getComputedStyle(s.querySelector(".ps-m-near")).fill),
		pineLum: lum(getComputedStyle(s.querySelector(".ps-l-pine-lit")).fill),
		text: document.documentElement.dataset.psText,
		weather: document.querySelector("[data-weather]")?.dataset.weather,
		pipeX: pipe.left + pipe.width / 2,
		capTop: cap.top,
		smokeX: smoke?.left,
		smokeY: smoke?.bottom,
		smokeShown: shown(s.querySelector(".ps-smoke")),
		perseids: streaks.filter((e) => e.classList.contains("ps-perseid") && shown(e)).length,
		sporadic: streaks.filter((e) => e.classList.contains("ps-meteor") && shown(e)).length,
		layerShown: getComputedStyle(s.querySelector(".ps-meteors")).display !== "none",
		group: s.classList.contains("psng-m-meteors"),
		running,
	};
})())`;

/**
 * Whether the window's middle third shows a peak: the far range's outline,
 * sampled along its length and mapped to the screen, rises above the scene's
 * middle somewhere between a third and two thirds of the way across.
 */
const PEAK_IN_MIDDLE = `(() => {
	const s = document.getElementById("theme-scene").getBoundingClientRect();
	const path = document.querySelector("#theme-scene .ps-m-far");
	const ctm = path.getScreenCTM();
	const len = path.getTotalLength();
	let top = Infinity;
	for (let i = 0; i <= 400; i++) {
		const p = path.getPointAtLength((len * i) / 400);
		const x = ctm.a * p.x + ctm.c * p.y + ctm.e;
		const y = ctm.b * p.x + ctm.d * p.y + ctm.f;
		if (x > s.left + s.width / 3 && x < s.left + (2 * s.width) / 3) top = Math.min(top, y);
	}
	return JSON.stringify({top: Math.round(top - s.top), height: Math.round(s.height)});
})()`;

export default async function run(page) {
	const ircd = startTinyIrcd({
		port: IRCD_PORT,
		caps: "server-time message-tags echo-message batch",
		onLine(line, ctx) {
			if (line.startsWith("JOIN ")) {
				ctx.send(`:${NICK}!${NICK}@t JOIN ${CHANNEL}`);
				ctx.send(`@msgid=a1 :alice!a@t PRIVMSG ${CHANNEL} :look at the mountains`);
				return true;
			}
			return line.startsWith("PRIVMSG ") || line.startsWith("TAGMSG ");
		},
	});
	let phone = false;
	const at = async (iso) => {
		await page.evaluate(`window.__setClock(Date.parse(${JSON.stringify(iso + ":00Z")}))`);
		// The scene reads the clock when it mounts: a theme round trip remounts it at once.
		await page.evaluate(update("theme", "coffee"));
		await page.sleep(300);
		await page.evaluate(update("theme", "ps"));
		await page.sleep(2500);
		return JSON.parse(await page.evaluate(READ));
	};

	try {
		await page.send("Emulation.setTimezoneOverride", {timezoneId: "Etc/UTC"});
		await page.addInitScript(CLOCK_SHIM);
		await page.goto(page.url, {waitForSelector: "#connect form"});
		phone = (await page.evaluate("innerWidth")) < 600;
		await page.evaluate(`document.querySelector("#connect form").requestSubmit()`);
		const item = `.channel-list-item[data-name="${CHANNEL}"]`;
		await page.waitFor(`!!document.querySelector(${JSON.stringify(item)})`, {
			label: "the channel",
		});
		await page.evaluate(`document.querySelector(${JSON.stringify(item)}).click()`);
		if (phone)
			await page.evaluate(
				`document.querySelector("#viewport")?.classList.remove("menu-open")`
			);
		await page.evaluate(update("theme", "ps"));
		await page.evaluate(update("psAnimation", "auto"));

		const winter = await at(AT.winterNoon);
		page.check(
			`a clear winter noon: snow on the peaks (${JSON.stringify(winter)})`,
			winter.snowOp > 0.9 && winter.capOp > 0.9
		);
		await page.screenshot(`winter-noon${phone ? "-phone" : ""}`);

		for (const [label, iso] of [
			["July", AT.summerNoon],
			["October", AT.autumnNoon],
		]) {
			const r = await at(iso);
			page.check(
				`a clear ${label} noon: no snow on the peaks (${r.snowOp}, ${r.capOp})`,
				r.snowOp === 0 && r.capOp === 0
			);
			if (label === "July") await page.screenshot(`summer-noon${phone ? "-phone" : ""}`);
		}

		const snow = await at(AT.snowNoon);
		page.check(
			`a snowy noon: the ranges and pines pale, and the channel's words dark (${JSON.stringify(
				snow
			)})`,
			snow.weather === "snow" &&
				snow.nearLum > 0.45 &&
				snow.pineLum > 0.35 &&
				snow.text === "ink"
		);
		await page.screenshot(`snow-noon${phone ? "-phone" : ""}`);

		const night = await at(AT.winterNight);
		// A phone's Auto is calm, which has no smoke (psng/tiers.ts): only the window's full tier shows it.
		page.check(
			phone
				? `a phone's calm night: no smoke to stand on the pipe (shown: ${night.smokeShown})`
				: `the smoke stands on the stove pipe on the roof's right slope (pipe ${night.pipeX?.toFixed(
						1
				  )}, smoke ${night.smokeX?.toFixed(1)}; cap top ${night.capTop?.toFixed(
						1
				  )}, smoke foot ${night.smokeY?.toFixed(1)})`,
			phone
				? !night.smokeShown
				: night.smokeShown &&
						Math.abs(night.pipeX - night.smokeX) <= 2 &&
						Math.abs(night.capTop - night.smokeY) <= 3
		);
		await page.screenshot(`winter-night${phone ? "-phone" : ""}`);

		if (!phone) {
			await at(AT.winterDusk);
			await page.screenshot("winter-dusk");
			await at(AT.summerDusk);
			await page.screenshot("summer-dusk");
			await at(AT.summerNight);
			await page.screenshot("summer-night");
		}

		const peak = await at(AT.perseidPeak);
		// A phone's Auto is calm, which has no shooting stars until the iPhone measures them (the design's Task 8).
		page.check(
			phone
				? `a phone's calm Auto at the Perseids' peak: no streak runs yet (${JSON.stringify(
						peak
				  )})`
				: `a clear night at the Perseids' peak: the shower's streaks live and running (${JSON.stringify(
						peak
				  )})`,
			phone
				? !peak.group && peak.running <= 0
				: peak.group && peak.perseids === 8 && peak.running >= 8 && peak.layerShown
		);
		await page.screenshot(`perseid-peak${phone ? "-phone" : ""}`);

		const storm = await at(AT.perseidStorm);
		page.check(
			`a stormy night in the shower: no streak (${JSON.stringify(storm)})`,
			storm.perseids === 0 && storm.sporadic === 0 && storm.running <= 0
		);

		await page.evaluate(update("psAnimation", "still"));
		const still = await at(AT.perseidPeak);
		page.check(
			`Still at the peak: the layer is out of the render tree, nothing runs (${JSON.stringify(
				still
			)})`,
			!still.layerShown && !still.group && still.running <= 0
		);
		await page.evaluate(update("psAnimation", "auto"));

		await page.send("Emulation.setEmulatedMedia", {
			features: [{name: "prefers-reduced-motion", value: "reduce"}],
		});
		const reduced = await at(AT.perseidPeak);
		page.check(
			`Reduce Motion at the peak: the layer is out of the render tree, nothing runs (${JSON.stringify(
				reduced
			)})`,
			!reduced.layerShown && reduced.running <= 0
		);
		await page.send("Emulation.setEmulatedMedia", {features: []});

		await at(AT.summerNoon);
		const middle = JSON.parse(await page.evaluate(PEAK_IN_MIDDLE));
		page.check(
			`the window's middle third shows a peak (its top ${middle.top} px down a ${middle.height} px scene)`,
			middle.top < middle.height * 0.5
		);

		page.check(
			`no console errors (${JSON.stringify(page.consoleErrors)})`,
			page.consoleErrors.length === 0
		);
	} finally {
		await ircd.close();
	}
}
