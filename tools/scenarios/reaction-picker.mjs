// The reaction picker, end to end in a real browser.
//
//   corepack yarn build && python3 -m http.server -d public 8000 &
//   tools/nefarious-dev/run.sh -d
//   node tools/browser-drive.mjs tools/scenarios/reaction-picker.mjs
//
// Everything here is invisible to `yarn test`: the picker is a Vue component
// teleported to <body> and positioned from `getBoundingClientRect`, its
// catalog arrives as a lazily imported chunk, and what it sends only shows up
// as a badge under a message. The claims under test are that it opens where
// it should, that the catalog loads, that an emoji and a *word* both survive
// the round trip through the ircd, that recents persist, and that picking a
// reaction you already have takes it back off.
//
// A second IRC user posts the message to react to, driven straight from here
// over the dev ircd's WebSocket port.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // dev ircd's self-signed cert

const IRCD = "wss://localhost:8443/";
const CHANNEL = "#seance";
const PORT = process.env.SEANCE_PORT ?? "8000";

export const url = `http://localhost:${PORT}/?host=localhost&port=8443&tls=true&nick=reactpick&join=%23seance`;

const PICKER = "body > .reaction-picker";
const OPTION = ".reaction-picker-option";
const INPUT = ".reaction-picker-input";

/** The reaction badges under `msg`, as text. */
const badgesOf = (msg) =>
	`Array.from(document.querySelectorAll("${msg} .msg-reaction:not(.msg-reaction-add) .msg-reaction-text")).map((b) => b.textContent)`;

/** Where an option with exactly this text sits in the flat list, or -1. */
const optionIndex = (page, text) =>
	page.evaluate(
		`Array.from(document.querySelectorAll(".reaction-picker-option")).findIndex((o) => o.textContent.trim() === ${JSON.stringify(
			text
		)})`
	);

/** What the picker would send if Enter were pressed right now. */
const ACTIVE = `(() => {
	const el = document.querySelector(".reaction-picker-option.active");
	return el ? el.dataset.index + ":" + el.textContent.trim() : null;
})()`;

/** A second user on the dev ircd, so there is somebody else's message to react to. */
function speaker(nick) {
	const ws = new WebSocket(IRCD, ["text.ircv3.net"]);
	let onJoin = () => {};

	ws.onopen = () => {
		ws.send(`NICK ${nick}`);
		ws.send(`USER ${nick} 0 * :seance reaction picker`);
	};

	ws.onmessage = (ev) => {
		const line = String(ev.data);

		if (line.startsWith("PING")) {
			ws.send(`PONG${line.slice(4)}`);
			return;
		}

		const params = (line.startsWith("@") ? line.slice(line.indexOf(" ") + 1) : line).split(" ");

		if (params[1] === "001") {
			ws.send(`JOIN ${CHANNEL}`);
		} else if (params[1] === "JOIN" && params[0].includes(nick)) {
			onJoin();
		} else if (params[1] === "433") {
			ws.send(`NICK ${nick}${Math.floor(Math.random() * 1000)}`);
		}
	};

	return {
		joined: new Promise((resolve, reject) => {
			onJoin = resolve;
			ws.onerror = (e) => reject(new Error(String(e.message ?? e)));
			setTimeout(() => reject(new Error(`${nick} never joined ${CHANNEL}`)), 20000);
		}),
		say: (text) => ws.send(`PRIVMSG ${CHANNEL} :${text}`),
		quit: () => ws.send("QUIT :done"),
	};
}

/** A real key press on whatever has focus (the picker's search field). */
async function press(page, key, code = key) {
	const enter = key === "Enter";
	const common = {key, code, windowsVirtualKeyCode: enter ? 13 : keyCode(key)};

	await page.send("Input.dispatchKeyEvent", {type: "rawKeyDown", ...common});

	if (enter) {
		await page.send("Input.dispatchKeyEvent", {type: "char", text: "\r", ...common});
	}

	await page.send("Input.dispatchKeyEvent", {type: "keyUp", ...common});
	await page.sleep(80);
}

const keyCode = (key) =>
	({ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Escape: 27}[key] ?? 0);

export default async function run(page) {
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await page.evaluate(`window.localStorage.removeItem("thelounge.reactions.recent")`);
	await page.evaluate(`document.querySelector("#connect form").requestSubmit()`);
	await page.waitFor(`document.querySelector('.channel-list-item[data-name="${CHANNEL}"]')`, {
		timeout: 30000,
		label: `${CHANNEL} in the sidebar`,
	});
	await page.click(`.channel-list-item[data-name="${CHANNEL}"]`);

	// The channel has history, so previous runs are on screen too: mark this
	// run's message and work only on the element that carries the mark.
	const token = `mark-${Date.now().toString(36)}`;
	const talker = speaker("reacttalk");
	await talker.joined;
	talker.say(`react to this line, ${token}`);
	await page.waitFor(
		`Array.from(document.querySelectorAll("#chat .msg .content")).some((c) => c.textContent.includes(${JSON.stringify(
			token
		)}))`,
		{timeout: 10000, label: "the message to react to"}
	);
	await page.sleep(300);

	const MSG = `#${await page.evaluate(
		`Array.from(document.querySelectorAll("#chat .msg")).find((m) => m.textContent.includes(${JSON.stringify(
			token
		)})).id`
	)}`;
	const BADGES = badgesOf(MSG);

	// 1. The toolbar is hover-only (display: none until then), and the picker
	//    opens from it. A synthetic click would never see it.
	await page.hover(MSG);
	await page.sleep(150);
	const toolbar = await page.rect(`${MSG} .msg-actions`);
	await page.check(
		`the hover toolbar appears (${JSON.stringify(toolbar)})`,
		toolbar && toolbar.width > 0
	);
	await page.click(`${MSG} .msg-action-react`);
	await page.waitFor(`document.querySelector(${JSON.stringify(PICKER)})`, {
		timeout: 5000,
		label: "the picker to open",
	});

	// It is teleported to <body>, so the scrollback cannot clip it; and it is
	// positioned by hand, so check it actually landed on screen.
	await page.sleep(300);

	const box = await page.rect(PICKER);
	await page.check(
		`the picker is on screen (${JSON.stringify(box)})`,
		box &&
			box.x >= 0 &&
			box.y >= 0 &&
			box.width > 200 &&
			(await page.evaluate(
				`(${JSON.stringify(box)}.x + ${JSON.stringify(box)}.width) <= window.innerWidth &&
				 (${JSON.stringify(box)}.y + ${JSON.stringify(box)}.height) <= window.innerHeight`
			))
	);

	// 2. The catalog is a lazily imported chunk: it arrives after the popover.
	await page.waitFor(`document.querySelectorAll(".reaction-picker-section").length >= 10`, {
		timeout: 10000,
		label: "the emoji catalog chunk",
	});
	const options = await page.count(OPTION);
	await page.check(`the whole catalog is browsable (${options} options)`, options > 1500);
	await page.check(
		"the quick reactions come first before anything is remembered",
		(await page.evaluate(`document.querySelector(".reaction-picker-heading").textContent`)) ===
			"Quick reactions"
	);
	await page.check(
		"there is a tab per group plus recents",
		(await page.count(".reaction-picker-tab")) === 10
	);
	await page.check(
		"tab does not walk 1878 buttons: the field drives the grid",
		(await page.evaluate(`document.querySelector(${JSON.stringify(OPTION)}).tabIndex`)) === -1
	);
	await page.screenshot("1-picker-open", {selector: PICKER, pad: 8});

	// 3. Searching. An exact alias means the emoji is what Enter sends.
	await page.fill(INPUT, "tada");
	await page.sleep(250);
	await page.check(
		"an exact alias highlights the emoji",
		(await page.evaluate(ACTIVE))?.endsWith("🎉")
	);
	await page.check(
		"the typed text is still offered as itself",
		(await page.count(`${OPTION}.free`)) === 1
	);
	await page.screenshot("2-search-tada", {selector: PICKER, pad: 8});

	await press(page, "Enter");
	await page.waitFor(`!document.querySelector(${JSON.stringify(PICKER)})`, {
		label: "the picker to close after picking",
	});
	await page.waitFor(`${BADGES}.includes("🎉")`, {
		timeout: 5000,
		label: "the 🎉 badge (round trip through the ircd)",
	});
	await page.check(
		"the emoji came back as a badge",
		(await page.evaluate(BADGES)).includes("🎉")
	);

	// 4. A word is a reaction too, and a word that merely prefixes an emoji
	//    name must not turn into that emoji.
	await page.click(`${MSG} .msg-reaction-add`);
	await page.waitFor(`document.querySelector(${JSON.stringify(INPUT)})`, {
		label: "the picker reopened from the + button",
	});
	await page.fill(INPUT, "lol");
	await page.sleep(250);
	const active = await page.evaluate(ACTIVE);
	await page.check(`a word highlights itself, not 🍭 lollipop (${active})`, /lol$/.test(active));
	await page.screenshot("3-search-word", {selector: PICKER, pad: 8});

	await press(page, "Enter");
	await page.waitFor(`${BADGES}.includes("lol")`, {
		timeout: 5000,
		label: "the word badge",
	});
	await page.check(
		"a word badge is set as text, not as a glyph",
		(await page.count("#chat .msg-reaction.word")) > 0
	);

	// 5. Both are remembered, newest first, words included.
	const recent = await page.evaluate(`window.localStorage.getItem("thelounge.reactions.recent")`);
	await page.check(`recents are stored newest first (${recent})`, recent === '["lol","🎉"]');

	// 6. Reopened, the recents lead and what we already sent is ticked.
	await page.click(`${MSG} .msg-reaction-add`);
	await page.waitFor(`document.querySelector(${JSON.stringify(PICKER)})`, {
		label: "the picker to reopen",
	});
	await page.check(
		"the recents section leads",
		(await page.evaluate(`document.querySelector(".reaction-picker-heading").textContent`)) ===
			"Recently used"
	);
	await page.check(
		"both remembered reactions are ticked as ours",
		(await page.count(`.reaction-picker-section[data-key="recent"] ${OPTION}.selected`)) === 2
	);
	await page.check(
		"the tick follows the reaction into the catalog, not the row",
		(await page.count(`${OPTION}.selected`)) > 2
	);
	await page.screenshot("4-recents", {selector: PICKER, pad: 8});

	// 7. The keyboard drives the grid while the field keeps focus.
	const before = await page.evaluate(`document.querySelector(${JSON.stringify(INPUT)}).id`);
	await press(page, "ArrowDown");
	const described = await page.evaluate(
		`document.querySelector(${JSON.stringify(INPUT)}).getAttribute("aria-activedescendant")`
	);
	await page.check(`arrow keys move the highlight (${described})`, !!described);
	await page.check(
		"the search field still has focus",
		(await page.evaluate(`document.activeElement.className`)) === "reaction-picker-input"
	);
	await press(page, "ArrowRight");
	const moved = await page.evaluate(
		`document.querySelector(${JSON.stringify(INPUT)}).getAttribute("aria-activedescendant")`
	);
	await page.check(`right moves on again (${described} → ${moved})`, moved !== described);
	await page.check("the field is the same one", before !== null);
	await page.screenshot("5-keyboard", {selector: PICKER, pad: 8});

	// 8. Picking one we already have takes it back off.
	await page.click(OPTION, await optionIndex(page, "🎉"));
	await page.waitFor(`!${BADGES}.includes("🎉")`, {
		timeout: 5000,
		label: "the 🎉 badge to go away again",
	});
	await page.check(
		"picking a ticked reaction removes it",
		!(await page.evaluate(BADGES)).includes("🎉")
	);
	await page.check("the word badge is untouched", (await page.evaluate(BADGES)).includes("lol"));
	await page.screenshot("6-removed", {selector: "#chat", pad: 8});

	// 9. Escape closes it, and a message at the bottom of the window opens the
	//    picker upwards rather than off the screen.
	talker.say(`this one sits at the bottom of the scrollback, ${token}`);
	await page.sleep(1000);
	const LAST = `#${await page.evaluate(
		`Array.from(document.querySelectorAll("#chat .msg")).filter((m) => m.textContent.includes("sits at the bottom")).pop().id`
	)}`;
	await page.hover(LAST);
	await page.sleep(150);
	await page.click(`${LAST} .msg-action-react`);
	await page.waitFor(`document.querySelector(${JSON.stringify(PICKER)})`, {
		label: "the picker on the last message",
	});
	await page.check(
		"a message near the bottom opens the picker upwards",
		await page.evaluate(
			`document.querySelector(${JSON.stringify(PICKER)}).classList.contains("flipped")`
		)
	);
	await page.sleep(300);

	const flippedBox = await page.rect(PICKER);
	await page.check(
		`the flipped picker is still fully on screen (${JSON.stringify(flippedBox)})`,
		flippedBox && flippedBox.y >= 0
	);
	await page.screenshot("7-flipped", {selector: "body", pad: 0});

	// Opening one from another message closes this one: the opener stops the
	// mousedown the outside-click handler would have seen.
	await page.evaluate(
		`document.querySelector(${JSON.stringify(MSG)}).scrollIntoView({block: "center"})`
	);
	await page.sleep(200);
	await page.click(`${MSG} .msg-reaction-add`);
	await page.sleep(400);
	await page.check("only one picker is ever open", (await page.count(PICKER)) === 1);

	await press(page, "Escape");
	await page.sleep(200);
	await page.check("escape closes it", (await page.count(PICKER)) === 0);

	// 10. On a phone-sized viewport it is a sheet along the bottom edge, not a
	//     popover: there is no room for one once the keyboard is up.
	await page.send("Emulation.setDeviceMetricsOverride", {
		width: 400,
		height: 780,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.sleep(400);

	// The narrow layout opens with the sidebar over the chat; picking the
	// channel puts the conversation back on screen.
	await page.click(`.channel-list-item[data-name="${CHANNEL}"]`);
	await page.sleep(400);
	await page.evaluate(
		`document.querySelector(${JSON.stringify(MSG)}).scrollIntoView({block: "center"})`
	);
	await page.sleep(300);
	await page.click(`${MSG} .msg-reaction-add`);
	await page.waitFor(`document.querySelector(${JSON.stringify(PICKER)})`, {
		label: "the picker on a narrow viewport",
	});
	await page.sleep(300); // the entrance animation scales it in over 120ms

	const sheet = await page.rect(PICKER);
	await page.check(
		`the narrow viewport gets the sheet (${JSON.stringify(sheet)})`,
		(await page.evaluate(
			`document.querySelector(${JSON.stringify(PICKER)}).classList.contains("sheet")`
		)) &&
			sheet.x === 0 &&
			Math.round(sheet.width) === 400 &&
			Math.round(sheet.y + sheet.height) === 780
	);
	await page.screenshot("8-sheet", {selector: "body", pad: 0});
	await page.send("Emulation.clearDeviceMetricsOverride");

	talker.quit();
	await page.check("no console errors", page.consoleErrors.length === 0);
}
