// The chat gutter — the time and nick columns left of every message — at
// every font-size step and clock setting: the columns are sized in rem to
// the text they hold (style.css `#chat .time`, `#chat .from`), so at no
// step may a time clip and at no step should the gutter carry much more
// slack than at the default. Measures the text against its column and
// screenshots the chat at each step for the eye.
//
//   corepack yarn build && python3 -m http.server -d public 8000 &
//   node tools/browser-drive.mjs tools/scenarios/message-gutter.mjs
//
// SEANCE_THEME=<name> picks the Appearance theme the run boots into (a
// bundled font's own metrics can widen or narrow the gutter past
// style.css's numbers, as the ps theme's fonts do — docs/projects/ps-theme.md
// §8); left unset, the run boots into the default theme.

const RUN = Date.now().toString(36);
const NICK = `gut${RUN}`;
const BASE = process.env.SEANCE_BASE ?? "http://localhost:8000/";

export const url = `${BASE}?host=127.0.0.1&port=8067&tls=false&nick=${NICK}&join=%23seance`;

const STEPS = ["tiny", "small", "medium", "large", "xlarge", "huge"];
// SEANCE_CLOCK=24h|12h|24h+s|12h+s picks the clock setting for the run; the
// format the DOM shows follows the setting, so it is set before boot.
const CLOCK = process.env.SEANCE_CLOCK ?? "12h";
const SETTINGS = {
	use12hClock: CLOCK.startsWith("12"),
	showSeconds: CLOCK.endsWith("+s"),
	...(process.env.SEANCE_THEME ? {theme: process.env.SEANCE_THEME} : {}),
};
// The widest times of each format (every figure is as wide as a 0 with
// tabular-nums; the hour's first figure and am or pm are what vary), so the
// fit is checked whatever the clock says during the run.
const WIDEST = {
	"12h": ["12:00am", "12:00pm"],
	"12h+s": ["12:00:00am", "12:00:00pm"],
	"24h": ["00:00"],
	"24h+s": ["00:00:00"],
}[CLOCK];
const WIDEST_JSON = JSON.stringify(WIDEST);
const fitLabel = (m) =>
	`the widest time fits its column (${m.widest.toFixed(1)} in ${m.timeBox.toFixed(1)}px)`;

// Text width against column width for the last own message, in px.
const MEASURE = `(() => {
	const msg = [...document.querySelectorAll('#chat .msg.self[data-type="message"]')].pop();
	if (!msg) return null;
	const t = msg.querySelector(".time"), f = msg.querySelector(".from");
	const textW = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
	const c = msg.querySelector(".content");
	const ch = (() => { const e = document.createElement("span"); e.textContent = "0"; e.style.cssText = "position:absolute;visibility:hidden;white-space:pre"; c.appendChild(e); const w = e.getBoundingClientRect().width; e.remove(); return w; })();
	const ul = document.querySelector("#chat .userlist");
	const messages = document.querySelector("#chat .messages");
	const px = (el, p) => parseFloat(getComputedStyle(el)[p]);
	const tBox = t.getBoundingClientRect(), fBox = f.getBoundingClientRect();
	const widest = Math.max(...${WIDEST_JSON}.map((s) => { const e = document.createElement("span"); e.textContent = s; e.style.cssText = "position:absolute;visibility:hidden;white-space:pre"; t.appendChild(e); const w = e.getBoundingClientRect().width; e.remove(); return w; }));
	// The gutter's two gaps: after the widest time to the nick column's text
	// box, and from that box to the message text.
	const fLeft = fBox.left + px(f, "paddingLeft"), fRight = fBox.right - px(f, "paddingRight");
	const text = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
	let n; while ((n = text.nextNode()) && !n.data.trim());
	const textLeft = (() => { const r = document.createRange(); r.selectNodeContents(n); return r.getClientRects()[0].left; })();
	return {
		ch,
		contentCh: (c.clientWidth - parseFloat(getComputedStyle(c).paddingLeft) - parseFloat(getComputedStyle(c).paddingRight)) / ch,
		fromCh: (f.clientWidth - parseFloat(getComputedStyle(f).paddingLeft) - parseFloat(getComputedStyle(f).paddingRight)) / ch,
		userlist: ul ? (getComputedStyle(ul).display === "none" ? "closed" : getComputedStyle(ul).position === "absolute" ? "overlay" : "panel") : "none",
		layout: getComputedStyle(msg).display === "flex" ? "columns" : "inline",
		rowOverflow: messages.scrollWidth > messages.clientWidth,
		time: t.textContent.trim(), timeCol: t.getBoundingClientRect().width, timeText: textW(t),
		timeBox: tBox.width - px(t, "paddingLeft") - px(t, "paddingRight"), widest,
		gapAfterWidest: fLeft - (tBox.left + px(t, "paddingLeft") + widest), nameToText: textLeft - fRight,
		timeLines: (() => { const r = document.createRange(); r.selectNodeContents(t); return r.getClientRects().length; })(),
		fromCol: f.getBoundingClientRect().width, fromText: textW(f),
		gutter: c.getBoundingClientRect().left - msg.getBoundingClientRect().left,
		root: parseFloat(getComputedStyle(document.documentElement).fontSize),
	};
})()`;

export default async function run(page) {
	await page.addInitScript(
		`localStorage.setItem("settings", JSON.stringify(${JSON.stringify(SETTINGS)}))`
	);
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await page.click('#connect button[type="submit"]');
	await page.waitFor(`!!document.querySelector("#form #input")`, {
		timeout: 20000,
		label: "chat input up",
	});
	await page.sleep(1500);

	for (const text of ["first line of the gutter check", "a second, so the column has two rows"]) {
		await page.fill("#input", text);
		await page.evaluate(`document.querySelector("#form").requestSubmit()`);
		await page.sleep(600);
	}
	await page.waitFor(`document.querySelectorAll('#chat .msg[data-type="message"]').length >= 2`, {
		label: "own messages shown",
	});

	const rows = [];
	for (const step of STEPS) {
		await page.evaluate(`document.documentElement.dataset.fontSize = ${JSON.stringify(step)}`);
		await page.sleep(80);
		const m = await page.evaluate(MEASURE);
		rows.push({step, clock: CLOCK, ...m});
		page.check(`${step} ${CLOCK}: time fits its column`, m.timeText <= m.timeCol + 0.5);
		if (m.layout === "columns")
			page.check(`${step} ${CLOCK}: ${fitLabel(m)}`, m.widest <= m.timeBox + 0.5);
		page.check(`${step} ${CLOCK}: time on one line`, m.timeLines === 1);
		// The own messages, wherever the bots have scrolled them to: the
		// measured row, scrolled into view, and its neighbours.
		await page.evaluate(
			`[...document.querySelectorAll('#chat .msg.self[data-type="message"]')].pop().scrollIntoView({block: "center"})`
		);
		await page.sleep(100);
		const box = await page.evaluate(
			`(() => { const r = [...document.querySelectorAll('#chat .msg.self[data-type="message"]')].pop().getBoundingClientRect(); return {x: r.left - 4, y: r.top - 3 * r.height, width: Math.min(r.width, 700), height: r.height * 6}; })()`
		);
		await page.screenshot(`gutter-${CLOCK}-${step}`, {clip: box});
	}
	// Now the squeeze: the user list open, the window narrowed step by step.
	// The text column keeps 30 characters while the list is a side panel,
	// the nick column never drops under 9ch, and once the pane is too
	// narrow for both the list lies over the chat instead.
	const WIDTHS = [1400, 1100, 960, 860, 780, 600, 390];
	const squeeze = [];
	for (const step of ["medium", "large", "huge"]) {
		await page.evaluate(`document.documentElement.dataset.fontSize = ${JSON.stringify(step)}`);
		for (const width of WIDTHS) {
			await page.send("Emulation.setDeviceMetricsOverride", {
				width,
				height: 900,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await page.sleep(150);
			const m = await page.evaluate(MEASURE);
			squeeze.push({step, width, ...m});
			const tag = `${step} @${width}`;
			if (m.layout === "columns") page.check(`${tag}: nick column >= 9ch`, m.fromCh >= 8.9);
			// The step loop runs at 1280px, where the largest step is inline
			// flow; a wide window keeps it in columns, and the widest time must
			// fit there too.
			if (m.layout === "columns")
				page.check(`${tag}: ${fitLabel(m)}`, m.widest <= m.timeBox + 0.5);
			// Inline flow can still overflow on an unbreakable word (a long URL
			// at a big step in a phone-width pane); that is the word, not the
			// columns.
			if (m.layout === "columns")
				page.check(`${tag}: no horizontal overflow`, !m.rowOverflow);
			if (m.layout === "columns" && m.userlist !== "panel")
				page.check(`${tag}: columns only with room for them`, m.contentCh >= 29.5);
			if (m.userlist === "panel")
				page.check(`${tag}: 30ch of text beside the panel`, m.contentCh >= 29.5);
			if (step === "large") await page.screenshot(`squeeze-${step}-${width}`);
		}
	}
	console.table(
		squeeze.map((r) => ({
			step: r.step,
			width: r.width,
			layout: r.layout,
			userlist: r.userlist,
			contentCh: r.contentCh.toFixed(1),
			fromCh: r.fromCh.toFixed(1),
			ch: r.ch.toFixed(1),
			overflow: r.rowOverflow,
		}))
	);
	await page.send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.evaluate(`document.documentElement.dataset.fontSize = "large"`);

	console.table(
		rows.map((r) => ({
			...r,
			timeCol: Math.round(r.timeCol),
			timeText: Math.round(r.timeText),
			fromCol: Math.round(r.fromCol),
			fromText: Math.round(r.fromText),
			gutter: Math.round(r.gutter),
			timeBox: Math.round(r.timeBox),
			widest: Math.round(r.widest),
			gapAfterWidest: `${(r.gapAfterWidest / r.root).toFixed(2)}rem`,
			nameToText: `${(r.nameToText / r.root).toFixed(2)}rem`,
		}))
	);
	page.check("no console errors", page.consoleErrors.length === 0);
}
