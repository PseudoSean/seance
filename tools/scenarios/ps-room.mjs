// The yurt's room behind a private conversation, in a real browser
// (docs/projects/ps-yurt.md §5, the changes of 2026-11-27):
//
// - the clock pinned (a Date shim, in UTC) to days whose weather is known, the
//   room remounted at each by a theme round trip;
// - the stove stands whole in view (on a phone at its right edge), and at
//   night the fire overlay stands in its door;
// - the back window's peaks carry their caps exactly as the plains do (on in
//   January, off in July), pale on a snowy day;
// - screenshots of a winter and a summer noon, a snowy noon and a winter night.
//
//   node tools/browser-drive.mjs tools/scenarios/ps-room.mjs
//   node tools/browser-drive.mjs tools/scenarios/ps-room.mjs --mobile --width=390 --height=844
//
// Serve a production build first (CLAUDE.md); SEANCE_PORT picks the port.
import {startTinyIrcd} from "./lib/tiny-ircd.mjs";

const PORT = process.env.SEANCE_PORT ?? "8000";
const IRCD_PORT = Number(process.env.IRCD_PORT ?? 9943);
const NICK = "seer";
const CHANNEL = "#plains";
const PEER = "bob";
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

/** Days whose weather the engine draws (UTC), as in ps-scenery.mjs. */
const AT = {
	winterNoon: "2027-01-10T12:30", // clear
	summerNoon: "2026-07-10T12:30", // clear
	snowNoon: "2027-01-05T12:30", // snow
	winterNight: "2027-01-10T22:00", // clear
};

/** What the room shows now: the stove's box, the fire's, the window caps against the plains' level. */
const READ = `JSON.stringify((() => {
	const s = document.getElementById("theme-scene");
	const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return {l: b.left, r: b.right, t: b.top, b: b.bottom}; };
	const lum = (rgb) => {
		const [r, g, b] = (rgb.match(/[\\d.]+/g) || []).slice(0, 3).map((v) => {
			const c = Number(v) / 255;
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const caps = [...s.querySelectorAll(".ps-indoor .ps-m-snow")].map((g) => Number(getComputedStyle(g).opacity));
	const near = s.querySelector(".ps-indoor .ps-m-near");
	return {
		private: s.classList.contains("ps-private"),
		stove: box(s.querySelector(".ps-indoor svg.ps-yt .ps-yt-p-stove")),
		fire: box(s.querySelector(".ps-indoor .ps-ym-fire")),
		width: innerWidth,
		capsLevel: Number(getComputedStyle(s).getPropertyValue("--ps-peak-snow-op")),
		caps,
		nearLum: near ? lum(getComputedStyle(near).fill) : null,
		weather: document.querySelector("[data-weather]")?.dataset.weather,
	};
})())`;

export default async function run(page) {
	const ircd = startTinyIrcd({
		port: IRCD_PORT,
		caps: "server-time message-tags echo-message batch",
		onLine(line, ctx) {
			if (line.startsWith("JOIN ")) {
				ctx.send(`:${NICK}!${NICK}@t JOIN ${CHANNEL}`);
				ctx.send(`@msgid=q1 :${PEER}!b@t PRIVMSG ${NICK} :come inside, the stove is lit`);
				return true;
			}
			return line.startsWith("PRIVMSG ") || line.startsWith("TAGMSG ");
		},
	});
	let phone = false;
	const at = async (iso) => {
		await page.evaluate(`window.__setClock(Date.parse(${JSON.stringify(iso + ":00Z")}))`);
		await page.evaluate(update("theme", "coffee"));
		await page.sleep(300);
		await page.evaluate(update("theme", "ps"));
		await page.sleep(2500);
		return JSON.parse(await page.evaluate(READ));
	};
	const tag = (name) => `${name}${phone ? "-phone" : ""}`;

	try {
		await page.send("Emulation.setTimezoneOverride", {timezoneId: "Etc/UTC"});
		await page.addInitScript(CLOCK_SHIM);
		await page.goto(page.url, {waitForSelector: "#connect form"});
		phone = (await page.evaluate("innerWidth")) < 600;
		await page.evaluate(`document.querySelector("#connect form").requestSubmit()`);
		const item = `.channel-list-item[data-name="${PEER}"]`;
		await page.waitFor(`!!document.querySelector(${JSON.stringify(item)})`, {
			label: "the query",
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
			`a private conversation shows the room, the stove whole in view (${JSON.stringify(
				winter.stove
			)} in ${winter.width})`,
			winter.private && winter.stove && winter.stove.l >= 0 && winter.stove.r <= winter.width
		);
		page.check(
			`a clear January noon: the back window's peaks carry the plains' caps (${
				winter.capsLevel
			}; ${JSON.stringify(winter.caps)})`,
			winter.capsLevel > 0.9 &&
				winter.caps.length === 3 &&
				winter.caps.every((o) => Math.abs(o - winter.capsLevel) < 0.01)
		);
		await page.screenshot(tag("room-winter-noon"));

		const summer = await at(AT.summerNoon);
		page.check(
			`a clear July noon: no caps on the window's peaks (${
				summer.capsLevel
			}; ${JSON.stringify(summer.caps)})`,
			summer.capsLevel === 0 && summer.caps.every((o) => o === 0)
		);
		await page.screenshot(tag("room-summer-noon"));

		const snow = await at(AT.snowNoon);
		page.check(
			`a snowy noon: the window's near range pale under the snow, as outside (${snow.nearLum})`,
			snow.weather === "snow" && snow.nearLum > 0.45
		);
		await page.screenshot(tag("room-snow-noon"));

		const night = await at(AT.winterNight);
		const fx = night.fire && (night.fire.l + night.fire.r) / 2;
		page.check(
			`a winter night: the fire stands in the stove's door (fire centre ${fx?.toFixed(
				1
			)}, stove ${JSON.stringify(night.stove)})`,
			night.fire && night.stove && fx > night.stove.l && fx < night.stove.r
		);
		await page.screenshot(tag("room-winter-night"));

		page.check(
			`no console errors (${JSON.stringify(page.consoleErrors)})`,
			page.consoleErrors.length === 0
		);
	} finally {
		await ircd.close();
	}
}
