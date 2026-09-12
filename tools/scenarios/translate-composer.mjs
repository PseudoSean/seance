// The composer in a real browser, on the in-page fake engine
// (?fakeTranslate on a non-production build), with a second user in
// #seance-translate (its own channel, not #seance, so these lines never
// land in a tester's own context) over a raw WebSocket who hears what the
// page actually sends.
// Steps, in order: the panel sets the write target and the placeholder
// says so; the first Enter puts a "to German" strip above the input with
// the fake's "[German] …" streaming in, Send disabled until it ends, the
// draft still in the input, the request logged with purpose "write";
// typing drops the strip; the check runs automatically once the
// translation ends, disabling Send again until the read-back line
// ("[English] [German] …", a read request) is done; the second Enter sends the
// translation (the other user hears "[German] …", the strip goes, the
// input clears) and ArrowUp recalls the original draft; Escape drops a
// strip and keeps the draft; a draft carrying the fake's "[fail]" marker
// gets the failure strip and Enter sends it as written, and one carrying
// "[echo]" -- which the fake hands back as typed -- gets the same strip
// with "came back unchanged" as its reason; "/me" never
// translates; a three-line draft translates as one numbered request and
// ships as three lines; a draft carrying markdown, a nick, a URL and a code
// span comes back with every one of them intact (the engine only ever saw
// placeholders), the strip's Copy button's tooltip reads "Copied" and its
// text is selectable, a fenced code block is never sent for translation and comes
// back byte for byte; inline TeX and a bold word together survive both the
// strip and the round trip's read-back row; the chip's title names the
// route its text came down; switching the target off
// restores plain sending.
// Under `--mobile` the panel is asserted to be the full-screen sheet, with
// formality as a segmented control and the close button putting it away.
// Detection is real (franc); only the engine is scripted.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   CHROME_BIN=/seance/tmp/chrome-pw.sh node tools/browser-drive.mjs tools/scenarios/translate-composer.mjs
//   … --mobile --width=390 --height=844
//
// Needs the dev ircd's plain-WS port on 127.0.0.1:8067. NODE_ENV must be
// unset for the build: a production build compiles the fake out. On touch
// the panel opens from the channel menu's "Translation…" entry; the
// synthetic contextmenu below is the harness's shortcut to the same panel.

const RUN = Date.now().toString(36);
const NICK = `tw${RUN}`;
const LISTENER = `hr${RUN}`;
const CHANNEL = "#seance-translate";
const IRCD = process.env.SEANCE_IRC_WS || "ws://127.0.0.1:8067/";
const BASE = "http://localhost:8021/";

export const url = `${BASE}?host=127.0.0.1&port=8067&tls=false&nick=${NICK}&join=%23seance-translate&fakeTranslate`;

const GLOBE = "#chat button.translate";
const MOBILE = process.argv.includes("--mobile");
const BAR = ".translate-bar";
const BAR_TEXT = ".translate-bar-row:first-child .translate-bar-text";
const INPUT = "#form #input";
// Both wrap their whole expression: `a || b` binds looser than `===`, `&&`
// and member access, so an unparenthesised `x || ""` in front of `=== "…"`
// would be read as `x || ("" === "…")` and pass the moment `x` is any
// non-empty string.
const REQUESTS = "((window.__seanceTranslateFake && window.__seanceTranslateFake.requests) || [])";
const barText = `((document.querySelector(${JSON.stringify(BAR_TEXT)}) || {}).textContent || "")`;
const inputValue = `document.querySelector(${JSON.stringify(INPUT)}).value`;
const ENTER = `document.querySelector(${JSON.stringify(
	INPUT
)}).dispatchEvent(new KeyboardEvent("keypress", {key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true}))`;
const key = (name, code) =>
	`document.querySelector(${JSON.stringify(
		INPUT
	)}).dispatchEvent(new KeyboardEvent("keydown", {key: ${JSON.stringify(
		name
	)}, code: ${JSON.stringify(
		name
	)}, keyCode: ${code}, which: ${code}, bubbles: true, cancelable: true}))`;

/** An own row that carries `text` and is no longer the pending copy. */
const settledSelf = (text) =>
	`[...document.querySelectorAll(".msg.self:not(.pending)")].some((m) => m.textContent.includes(${JSON.stringify(
		text
	)}))`;

/** A second user who records every PRIVMSG body it hears in the channel. */
function listener(nick) {
	const ws = new WebSocket(IRCD, ["text.ircv3.net"]);
	const heard = [];
	let joinedResolve;
	let joinedReject;
	const joined = new Promise((resolve, reject) => {
		joinedResolve = resolve;
		joinedReject = reject;
		setTimeout(() => reject(new Error("listener never joined")), 20000);
	});
	const from = (command) => new RegExp(`^(?:@\\S+ )?:${nick}\\S* ${command}`);

	ws.onopen = () => {
		ws.send(`NICK ${nick}`);
		ws.send(`USER ${nick} 0 * :seance composer listener`);
	};
	ws.onmessage = (ev) => {
		const line = String(ev.data);

		if (line.startsWith("PING")) {
			ws.send(line.replace("PING", "PONG"));
		} else if (/ 001 /.test(line)) {
			ws.send(`JOIN ${CHANNEL}`);
		} else if (/ 433 /.test(line)) {
			ws.send(`NICK ${nick}_`);
		} else if (from("JOIN").test(line)) {
			joinedResolve();
		} else if (/ PRIVMSG /.test(line)) {
			const body = line.indexOf(" :", line.indexOf("PRIVMSG"));

			if (body > 0) {
				heard.push(line.slice(body + 2));
			}
		}
	};
	ws.onerror = () => joinedReject(new Error("listener socket error"));

	return {
		joined,
		heard: () => heard.slice(),
		quit: () => ws.send("QUIT :done"),
	};
}

/** Bounded wait for the listener's copy of a line: the relay is not the echo. */
async function heard(other, text, timeout = 10000) {
	const deadline = Date.now() + timeout;

	for (;;) {
		if (other.heard().includes(text)) {
			return true;
		}

		if (Date.now() > deadline) {
			return false;
		}

		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function openPanel(page) {
	await page.evaluate(
		`document.querySelector(${JSON.stringify(
			GLOBE
		)}).dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}))`
	);
	await page.waitFor(`!!document.querySelector(".translation-panel")`, {label: "panel open"});
}

async function setWriteTarget(page, code) {
	await openPanel(page);
	await page.evaluate(
		`(() => { const s = document.querySelector('.translation-panel select[name="translateWrite"]'); s.value = ${JSON.stringify(
			code
		)}; s.dispatchEvent(new Event("change", {bubbles: true})); })()`
	);
	await page.evaluate(
		`document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true}))`
	);
	await page.waitFor(`!document.querySelector(".translation-panel")`, {label: "panel closed"});
}

/**
 * The phone layout, under `--mobile`: the same choices as a full-screen
 * sheet, with room to press them. Whether the harness's emulation also
 * reports a touch-primary device decides how the sheet is opened here — a
 * tap on the globe where it does (there is no right-click on a phone), the
 * synthetic contextmenu where only the width query makes the layout.
 */
async function panelIsASheet(page) {
	const touch = await page.evaluate(`matchMedia("(hover: none) and (pointer: coarse)").matches`);

	page.check(`--mobile emulates a touch-primary device: ${touch}`, true);

	if (touch) {
		await page.click(GLOBE);
	} else {
		await openPanel(page);
	}

	await page.waitFor(`!!document.querySelector(".translation-panel--sheet")`, {
		label: "the panel came up as a sheet",
	});

	const rect = await page.rect(".translation-panel--sheet");
	const viewport = await page.evaluate(`({w: innerWidth, h: innerHeight})`);
	const size = rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "none";

	await page.check(
		`the sheet fills the viewport (${size} of ${viewport.w}x${viewport.h})`,
		!!rect &&
			Math.round(rect.x) === 0 &&
			Math.round(rect.y) === 0 &&
			Math.round(rect.width) === viewport.w &&
			Math.round(rect.height) === viewport.h
	);
	await page.check(
		"formality is a segmented control, not a native picker",
		await page.evaluate(
			`!!document.querySelector('.translation-panel-segmented[role="radiogroup"]') && !document.querySelector('select[name="translateFormality"]')`
		)
	);

	const segments = await page.evaluate(
		`[...document.querySelectorAll('.translation-panel-segment[role="radio"]')].map((b) => b.textContent.trim())`
	);

	await page.check(
		`the three choices are spelled out (${segments.join(", ")})`,
		segments.join("|") === "As written|Formally|Casually"
	);
	await page.check(
		"the write target is a native select in this layout too",
		await page.evaluate(
			`!!document.querySelector('.translation-panel select[name="translateWrite"]')`
		)
	);
	await page.check(
		"the hints the desktop panel omits are shown",
		(await page.evaluate(
			`getComputedStyle(document.querySelector(".translation-panel-hint")).display`
		)) !== "none"
	);
	await page.check(
		"the close button is on screen",
		await page.evaluate(
			`(() => {
				const r = document.querySelector(".translation-panel-close").getBoundingClientRect();
				return r.height > 0 && r.bottom <= innerHeight + 1;
			})()`
		)
	);
	await page.screenshot("translation-sheet");
	await page.click(".translation-panel-close");
	await page.waitFor(`!document.querySelector(".translation-panel")`, {
		label: "the close button closed the sheet",
	});
}

async function typeAndEnter(page, text) {
	await page.fill(INPUT, text);
	await page.evaluate(ENTER);
}

export default async function run(page) {
	const other = listener(LISTENER);

	// The strip's Copy button goes through navigator.clipboard, which a
	// headless page is not granted by default.
	await page.grantPermissions(["clipboardReadWrite", "clipboardSanitizedWrite"], BASE);
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await page.click('#connect button[type="submit"]');
	await page.waitFor(`!!document.querySelector(${JSON.stringify(INPUT)})`, {
		timeout: 20000,
		label: "the channel view",
	});
	await page.waitFor(`!!document.querySelector(${JSON.stringify(GLOBE)})`, {
		timeout: 20000,
		label: "the globe (the fake reports a GPU)",
	});
	await other.joined;

	// 1. The write target.
	await openPanel(page);
	await page.check(
		"the write target options are named in themselves (Deutsch, Français)",
		await page.evaluate(
			`(() => {
				const s = document.querySelector('.translation-panel select[name="translateWrite"]');
				const text = (v) => s.querySelector('option[value="' + v + '"]').textContent.trim();
				return text("de") === "Deutsch" && text("fr") === "Français";
			})()`
		)
	);
	await page.evaluate(
		`document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true}))`
	);
	await page.waitFor(`!document.querySelector(".translation-panel")`, {label: "panel closed"});

	await setWriteTarget(page, "de");
	await page.check(
		"the placeholder says the channel sends in German",
		(
			await page.evaluate(`document.querySelector(${JSON.stringify(INPUT)}).placeholder`)
		).includes("sent in German")
	);

	if (MOBILE) {
		await panelIsASheet(page);
	}

	// 2. The first Enter translates into the strip.
	const draft = `please keep the timestamps in the log ${RUN}`;

	await typeAndEnter(page, draft);
	await page.waitFor(`!!document.querySelector(${JSON.stringify(BAR)})`, {label: "the strip"});
	await page.check(
		"the chip names the language in full",
		(await page.evaluate(`document.querySelector(".translate-bar-chip").textContent`)) ===
			"to German"
	);
	await page.check(
		"Send is disabled while it streams",
		await page.evaluate(`document.querySelector("#submit").disabled`)
	);
	await page.waitFor(
		`${barText}.startsWith("[German] please keep") && !document.querySelector(".translate-bar-caret")`,
		{timeout: 20000, label: "the translation streamed to the end"}
	);
	await page.check(
		"the draft is still in the input",
		(await page.evaluate(inputValue)) === draft
	);
	await page.check(
		"the request went out as a write",
		(await page.evaluate(
			`${REQUESTS}.some((r) => r.purpose === "write" && r.text === ${JSON.stringify(draft)})`
		)) === true
	);

	// The route behind the strip, in the chip's title: the pair, the model's
	// own id, and GPU or CPU. The fake runs as the `llm` candidate, so this
	// one is a GPU route.
	const chipTitle = String(
		await page.evaluate(`document.querySelector(".translate-bar-chip").title`)
	);

	await page.check(
		`the chip's title names the route it took (${chipTitle})`,
		chipTitle.includes("→ German") && chipTitle.endsWith("(GPU)")
	);
	await page.screenshot("composer-strip");

	// 3. Typing drops the strip; the next Enter translates afresh.
	await page.fill(INPUT, `${draft} edited`);
	await page.waitFor(`!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "typing dropped the strip",
	});
	await page.evaluate(ENTER);
	await page.waitFor(`${barText} === ${JSON.stringify(`[German] ${draft} edited`)}`, {
		timeout: 20000,
		label: "translated again",
	});

	// 4. The check runs automatically and Send waits for it.
	await page.waitFor(`!!document.querySelector(".translate-bar-check")`, {
		timeout: 20000,
		label: "the check started",
	});
	await page.check(
		"Send is disabled while the check runs",
		await page.evaluate(`document.querySelector("#submit").disabled`)
	);
	await page.waitFor(
		`(document.querySelector(".translate-bar-check .translate-bar-text") || {}).textContent === ${JSON.stringify(
			`[English] [German] ${draft} edited`
		)}`,
		{timeout: 20000, label: "the read-back line"}
	);
	await page.check(
		"the read-back row is marked as the reading language",
		(await page.evaluate(
			`(document.querySelector(".translate-bar-check .translate-bar-text") || {}).lang`
		)) === "en"
	);
	await page.check(
		"Send is enabled once the check ends",
		!(await page.evaluate(`document.querySelector("#submit").disabled`)) &&
			!(await page.evaluate(`document.querySelector(".translate-bar-send").disabled`))
	);
	await page.check(
		"the check went out as a read",
		(await page.evaluate(`${REQUESTS}.slice(-1)[0].purpose`)) === "read"
	);
	await page.screenshot("composer-check");

	// 5. The second Enter sends the translation.
	await page.evaluate(ENTER);
	await page.waitFor(`!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "the strip went with the send",
	});
	await page.waitFor(settledSelf(`[German] ${draft} edited`), {
		timeout: 20000,
		label: "the translation in the timeline, echoed back",
	});
	await page.check("the input cleared", (await page.evaluate(inputValue)) === "");
	await page.check(
		"the other user heard the German line",
		await heard(other, `[German] ${draft} edited`)
	);
	await page.check(
		"the other user never heard the draft",
		!other.heard().includes(`${draft} edited`)
	);
	// ArrowUp in an empty input edits the newest own line (the translation);
	// Escape dismisses that, and the next ArrowUp walks the input history,
	// where the original draft is what was kept.
	await page.evaluate(key("ArrowUp", 38));
	await page.waitFor(`!!document.querySelector(".compose-bar")`, {
		label: "ArrowUp edits the sent line",
	});
	await page.check(
		"the edit holds the translation that was sent",
		(await page.evaluate(inputValue)) === `[German] ${draft} edited`
	);
	await page.evaluate(key("Escape", 27));
	await page.waitFor(`!document.querySelector(".compose-bar")`, {label: "the edit dismissed"});
	await page.evaluate(key("ArrowUp", 38));
	await page.check(
		"ArrowUp then recalls the original draft from the history",
		(await page.evaluate(inputValue)) === `${draft} edited`
	);
	await page.fill(INPUT, "");

	// 6. Escape drops a strip and keeps the draft.
	const kept = `this one I will keep typing ${RUN}`;

	await typeAndEnter(page, kept);
	await page.waitFor(`!!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "a strip to escape",
	});
	await page.evaluate(key("Escape", 27));
	await page.waitFor(`!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "Escape dropped the strip",
	});
	await page.check("Escape kept the draft", (await page.evaluate(inputValue)) === kept);

	// 7. A failure offers the draft as written.
	const failing = `[fail] this one breaks on purpose ${RUN}`;

	await typeAndEnter(page, failing);
	await page.waitFor(`!!document.querySelector(".translate-bar.failed")`, {
		timeout: 20000,
		label: "the failure strip",
	});
	await page.check(
		"the send button offers the draft as written",
		(await page.evaluate(
			`document.querySelector(".translate-bar-send").getAttribute("aria-label")`
		)) === "Send as written" &&
			(await page.evaluate(
				`document.querySelector(".translate-bar-send").getAttribute("title")`
			)) === "Send as written"
	);
	await page.screenshot("composer-failed");
	await page.evaluate(ENTER);
	await page.waitFor(settledSelf(`this one breaks on purpose ${RUN}`), {
		timeout: 20000,
		label: "sent as written",
	});
	await page.check(
		"the line that went carries the draft, untranslated",
		await page.evaluate(
			`[...document.querySelectorAll(".msg.self")].some((m) => m.textContent.includes(${JSON.stringify(
				failing
			)}))`
		)
	);

	// 7b. An answer equal to the draft is no translation either: the fake's
	// "[echo]" token hands the text straight back, and the strip says so
	// rather than offering the draft as its own translation.
	const echoed = `[echo] this one comes back as typed ${RUN}`;

	await typeAndEnter(page, echoed);
	await page.waitFor(`!!document.querySelector(".translate-bar.failed")`, {
		timeout: 20000,
		label: "the echo strip",
	});
	await page.check(
		"the reason says the line came back unchanged",
		(await page.evaluate(
			`(document.querySelector(".translate-bar-reason") || {}).textContent`
		)) === "came back unchanged"
	);
	await page.check(
		"the send button offers the draft as written",
		(await page.evaluate(
			`document.querySelector(".translate-bar-send").getAttribute("aria-label")`
		)) === "Send as written"
	);
	await page.screenshot("composer-echoed");
	await page.evaluate(ENTER);
	await page.waitFor(settledSelf(echoed), {
		timeout: 20000,
		label: "the echoed draft sent as written",
	});
	await page.check("the other user heard the draft as typed", await heard(other, echoed));
	await page.check(
		"the input cleared after the echo send",
		(await page.evaluate(inputValue)) === ""
	);

	// 8. A command never translates.
	await typeAndEnter(page, `/me waves ${RUN}`);
	await page.waitFor(`document.body.innerText.includes(${JSON.stringify(`waves ${RUN}`)})`, {
		timeout: 20000,
		label: "the /me line",
	});
	await page.check(
		"no strip for a command",
		!(await page.evaluate(`!!document.querySelector(${JSON.stringify(BAR)})`))
	);

	// 9. A multi-line draft keeps its lines. The form submit is the Send button's path.
	const lines = [`line one ${RUN}`, `line two ${RUN}`, `line three ${RUN}`];

	await page.fill(INPUT, lines.join("\n"));
	await page.evaluate(`document.querySelector("#form").requestSubmit()`);
	await page.waitFor(
		`${barText} === ${JSON.stringify(lines.map((l) => `[German] ${l}`).join("\n"))}`,
		{
			timeout: 25000,
			label: "three lines translated as one",
		}
	);
	await page.check(
		"one numbered request carried the three lines",
		(await page.evaluate(`${REQUESTS}.slice(-1)[0].lines`)) === 3
	);
	// The automatic check runs on this draft too; Send waits for it.
	await page.waitFor(`!document.querySelector("#submit").disabled`, {
		timeout: 20000,
		label: "Send re-enabled once the multi-line draft's check ends",
	});
	await page.evaluate(`document.querySelector("#form").requestSubmit()`);
	await page.waitFor(
		`document.body.innerText.includes(${JSON.stringify(`[German] line three ${RUN}`)})`,
		{
			timeout: 20000,
			label: "the three lines in the timeline",
		}
	);
	await page.check(
		"the other user heard all three German lines",
		(await heard(other, `[German] line one ${RUN}`)) &&
			(await heard(other, `[German] line two ${RUN}`)) &&
			(await heard(other, `[German] line three ${RUN}`))
	);

	// 9b. Markdown markers, a nick, a URL and a code span survive: the fake
	// echoes its input, so what the strip shows is exactly what was
	// protected and put back. The nick, the URL and the code span are
	// placeholders on every route — the engine never sees them — while the
	// marks themselves are what the LLM route is given (spans.ts
	// `LLM_MARKERS`, measured: bare `⟦n⟧` pairs around words it must
	// translate stop the model translating), and the fake runs as the `llm`
	// candidate here.
	const fidelity = `Hello everyone, this is supposed to be in *German*. Ask ${LISTENER}. See https://example.org/x and \`code\``;

	await page.fill(INPUT, "");
	await typeAndEnter(page, fidelity);
	await page.waitFor(`${barText} === ${JSON.stringify(`[German] ${fidelity}`)}`, {
		timeout: 25000,
		label: "the strip kept the markers, the nick, the URL and the code span",
	});

	const fidelityRequest = await page.evaluate(`${REQUESTS}.slice(-1)[0]`);

	await page.check(
		"the engine never saw the nick, the URL or the code span",
		!fidelityRequest.text.includes(LISTENER) &&
			!fidelityRequest.text.includes("https://example.org/x") &&
			!fidelityRequest.text.includes("`code`")
	);
	await page.check(
		`the LLM route was given the marks themselves (markers: ${fidelityRequest.markers})`,
		fidelityRequest.markers === "literal" && fidelityRequest.text.includes("*German*")
	);
	await page.screenshot("composer-markdown");

	// The strip can be copied and selected.
	await page.check(
		"the strip offers a Copy button once the translation is done",
		await page.evaluate(`!!document.querySelector(".translate-bar-copy")`)
	);
	await page.evaluate(`document.querySelector(".translate-bar-copy").click()`);
	await page.waitFor(
		`document.querySelector(".translate-bar-copy").getAttribute("aria-label") === "Copied" && document.querySelector(".translate-bar-copy").getAttribute("title") === "Copied"`,
		{timeout: 5000, label: "the Copy button's tooltip reads Copied"}
	);
	await page.check(
		"the strip's text is selectable",
		(await page.evaluate(
			`getComputedStyle(document.querySelector(".translate-bar-text")).userSelect`
		)) === "text"
	);
	await page.evaluate(key("Escape", 27));
	await page.waitFor(`!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "the fidelity strip dismissed",
	});

	// 9c. A fenced code block is one span: it is never sent for translation
	// and it comes back byte for byte, with the prose around it translated.
	const fenced = [`first line ${RUN}`, "```", "x = 1", "```", `last line ${RUN}`].join("\n");
	const fencedOut = [
		`[German] first line ${RUN}`,
		"```",
		"x = 1",
		"```",
		`[German] last line ${RUN}`,
	].join("\n");

	await page.fill(INPUT, fenced);
	await page.evaluate(`document.querySelector("#form").requestSubmit()`);
	await page.waitFor(`${barText} === ${JSON.stringify(fencedOut)}`, {
		timeout: 25000,
		label: "the code block shipped verbatim, the prose around it translated",
	});
	await page.check(
		"only the two prose lines went to the engine",
		(await page.evaluate(`${REQUESTS}.slice(-1)[0].lines`)) === 2
	);
	await page.screenshot("composer-code-block");
	await page.evaluate(key("Escape", 27));
	await page.waitFor(`!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "the code-block strip dismissed",
	});
	await page.fill(INPUT, "");

	// 9d. Inline TeX and an emphasis pair together: the engine only ever
	// sees a placeholder for the math — its content must not change — while
	// the bold marks reach it as `**`, and both the primary strip and the
	// round-trip's read-back row keep them intact.
	const math = "the result is $`x^2`$ and it is **final**";

	await typeAndEnter(page, math);
	await page.waitFor(`${barText} === ${JSON.stringify(`[German] ${math}`)}`, {
		timeout: 25000,
		label: "the strip kept the TeX and the bold word",
	});
	await page.check(
		"the engine never saw the TeX literally",
		!(await page.evaluate(`${REQUESTS}.slice(-1)[0].text`)).includes("x^2")
	);
	await page.waitFor(
		`(document.querySelector(".translate-bar-check .translate-bar-text") || {}).textContent === ${JSON.stringify(
			`[English] [German] ${math}`
		)}`,
		{timeout: 25000, label: "the read-back row kept the TeX and the bold word too"}
	);
	await page.screenshot("composer-math");
	await page.evaluate(key("Escape", 27));
	await page.waitFor(`!document.querySelector(${JSON.stringify(BAR)})`, {
		label: "the math strip dismissed",
	});
	await page.fill(INPUT, "");

	// 10. Off again: plain sending.
	await setWriteTarget(page, "");
	await page.check(
		"the placeholder is plain again",
		!(
			await page.evaluate(`document.querySelector(${JSON.stringify(INPUT)}).placeholder`)
		).includes("sent in")
	);
	await typeAndEnter(page, `plain again ${RUN}`);
	await page.waitFor(
		`document.body.innerText.includes(${JSON.stringify(`plain again ${RUN}`)})`,
		{
			timeout: 20000,
			label: "a plain line",
		}
	);
	await page.check(
		"no strip once off",
		!(await page.evaluate(`!!document.querySelector(${JSON.stringify(BAR)})`))
	);
	await page.check("the other user heard it as typed", await heard(other, `plain again ${RUN}`));

	await page.check("no console errors", page.consoleErrors.length === 0);
	other.quit();
	await page.screenshot("final");
}
