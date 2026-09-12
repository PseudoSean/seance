// The reading pipeline in a real browser, on the in-page fake engine
// (?fakeTranslate on a non-production build) with a second user speaking
// German in #seance through a raw WebSocket to the dev ircd. Steps, in
// order: nothing is translated before the globe is switched on; a German
// line gets a "from German" line with the fake's "[English] …" echo; an
// English line gets none; a five-line burst is translated and proved
// batched (the in-page request log shows one multi-line LLM request, not
// five singles, and every burst line's echo is rendered); the chip's menu
// can hide a translation; the toolbar's Translate does one message on
// request; the page's own German line is never translated; the
// translation panel opens on the globe's context menu as one column of
// controls of equal width, full language names (never codes) and a link to
// Settings, and closes on Escape; a line carrying the fake's `[fail]`
// marker fails once and its retry button succeeds the second time; a line carrying `*Betonung*` and the page's own nick keeps both
// (the chip's menu offers Copy translation and the line is selectable); a
// `draft/multiline` message is translated line by line rather than losing
// all but its first; switching off stops new ones; and a REDACT of a
// translated line takes its translation away with the original text.
// Detection is real (franc); only the engine is scripted.
//
// The speaker negotiates message-tags + echo-message so it learns the
// msgid the server gave its own line, and batch + draft/multiline so it
// can send one multi-line message; the run flips
// CAP_draft_message_redaction on (the rig leaves it off, and without it
// REDACT answers FAIL DISABLED and the page never offers the cap) and
// back off at the end.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   CHROME_BIN=/seance/tmp/chrome-pw.sh node tools/browser-drive.mjs tools/scenarios/translate-reading.mjs
//   … --mobile --width=390 --height=844
//
// Needs the dev ircd's plain-WS port on 127.0.0.1:8067. NODE_ENV must be
// unset for the build: a production build compiles the fake out. Under
// `--mobile` the globe's tap opens the panel rather than switching reading
// (there is no right-click on a phone), so the switch is thrown through the
// panel's own control there.

import {rigFeature} from "./lib/rig-feature.mjs";

const RUN = Date.now().toString(36);
const NICK = `tr${RUN}`;
const SPEAKER = `de${RUN}`;
const CHANNEL = "#seance";
const IRCD = process.env.SEANCE_IRC_WS || "ws://127.0.0.1:8067/";
const BASE = "http://localhost:8021/";

export const url = `${BASE}?host=127.0.0.1&port=8067&tls=false&nick=${NICK}&join=%23seance&fakeTranslate`;

const LINES = `document.querySelectorAll('.msg-translation[data-status="done"]').length`;
const GLOBE = "#chat button.translate";
const MOBILE = process.argv.includes("--mobile");
const REQUESTS = `(window.__seanceTranslateFake && window.__seanceTranslateFake.requests) || []`;
const REDACTION_FEATURE = "CAP_draft_message_redaction";

/**
 * Reading on or off. The globe's click is the switch where there is a
 * pointer; on touch the tap opens the panel instead (there is no
 * right-click to reach it with), so the switch is the panel's first
 * control and Done puts it away.
 */
async function setReading(page, code) {
	await page.click(GLOBE);

	if (!MOBILE) {
		return;
	}

	await page.waitFor(`!!document.querySelector(".translation-panel")`, {
		label: "the tap opened the panel",
	});
	await page.evaluate(
		`(() => { const s = document.querySelector('.translation-panel select[name="translateRead"]'); s.value = ${JSON.stringify(
			code
		)}; s.dispatchEvent(new Event("change", {bubbles: true})); })()`
	);
	await page.evaluate(`document.querySelector(".translation-panel-done").click()`);
	await page.waitFor(`!document.querySelector(".translation-panel")`, {
		label: "Done put the panel away",
	});
}

function speaker(nick) {
	const ws = new WebSocket(IRCD, ["text.ircv3.net"]);
	/** The msgid the server gave each line this speaker sent, by text. */
	const msgids = new Map();
	let joinedResolve;
	let joinedReject;
	const joined = new Promise((resolve, reject) => {
		joinedResolve = resolve;
		joinedReject = reject;
		setTimeout(() => reject(new Error("speaker never joined")), 20000);
	});
	// Tagged lines arrive with an `@tags` prefix in front of the source.
	const from = (command) => new RegExp(`^(?:@\\S+ )?:${nick}\\S* ${command}`);

	ws.onopen = () => {
		// echo-message + message-tags: the echo of our own PRIVMSG carries
		// the msgid REDACT needs (the live REDACT line itself has no tags).
		// batch + draft/multiline: this speaker also sends one multi-line
		// message, which the page joins into a single message.
		ws.send("CAP LS 302");
		ws.send(`NICK ${nick}`);
		ws.send(`USER ${nick} 0 * :seance translation reader`);
	};
	ws.onmessage = (ev) => {
		const line = String(ev.data);

		if (line.startsWith("PING")) {
			ws.send(line.replace("PING", "PONG"));
		} else if (/ CAP \S+ LS :/.test(line)) {
			// The last LS line only: a continuation reads `LS * :…`.
			ws.send("CAP REQ :message-tags echo-message batch draft/multiline");
		} else if (/ CAP \S+ (ACK|NAK)/.test(line)) {
			ws.send("CAP END");
		} else if (/ 001 /.test(line)) {
			ws.send(`JOIN ${CHANNEL}`);
		} else if (/ 433 /.test(line)) {
			ws.send(`NICK ${nick}_`);
		} else if (from("JOIN").test(line)) {
			joinedResolve();
		} else if (from("PRIVMSG").test(line)) {
			const tags = /^@(\S+) /.exec(line);
			const msgid = tags && /(?:^|;)msgid=([^;]+)/.exec(tags[1]);
			const body = line.indexOf(" :", line.indexOf("PRIVMSG"));

			if (msgid && body > 0) {
				msgids.set(line.slice(body + 2), msgid[1]);
			}
		}
	};
	ws.onerror = () => joinedReject(new Error("speaker socket error"));

	return {
		joined,
		say: (text) => ws.send(`PRIVMSG ${CHANNEL} :${text}`),
		/** One `draft/multiline` message: the page joins the batch's lines with newlines. */
		sayMultiline(lines) {
			const tag = `ml${Date.now().toString(36)}`;

			ws.send(`BATCH +${tag} draft/multiline ${CHANNEL}`);

			for (const line of lines) {
				ws.send(`@batch=${tag} PRIVMSG ${CHANNEL} :${line}`);
			}

			ws.send(`BATCH -${tag}`);
		},
		msgidOf: (text) => msgids.get(text),
		redact: (msgid) => ws.send(`REDACT ${CHANNEL} ${msgid} :tidying up`),
		quit: () => ws.send("QUIT :done"),
	};
}

export default async function run(page) {
	// The rig leaves message redaction off: without the feature REDACT
	// answers FAIL DISABLED and the page is never offered the cap that
	// makes it show one.
	const feature = await rigFeature(REDACTION_FEATURE, "TRUE");

	await page.check("the rig offers draft/message-redaction for this run", feature.after);

	try {
		await scenario(page);
	} finally {
		if (!feature.before) {
			await rigFeature(REDACTION_FEATURE, "FALSE");
		}
	}
}

async function scenario(page) {
	await page.goto(page.url, {waitForSelector: "#connect form"});
	await page.click('#connect button[type="submit"]');
	await page.waitFor(`!!document.querySelector("#form #input")`, {
		timeout: 20000,
		label: "chat input up",
	});
	await page.waitFor(`!!document.querySelector(${JSON.stringify(GLOBE)})`, {
		timeout: 10000,
		label: "globe shown once the probe answered",
	});
	await page.check(
		"globe starts off",
		!(await page.evaluate(
			`document.querySelector(${JSON.stringify(GLOBE)}).classList.contains("on")`
		))
	);

	const other = speaker(SPEAKER);

	await other.joined;
	other.say("Guten Tag zusammen, wie geht es euch heute?");
	await page.waitFor(`document.body.innerText.includes("wie geht es euch heute")`, {
		label: "first German line arrived",
	});
	await page.sleep(1500);
	await page.check("nothing translated before the switch", (await page.evaluate(LINES)) === 0);

	await setReading(page, "en");
	await page.waitFor(
		`document.querySelector(${JSON.stringify(GLOBE)}).classList.contains("on")`,
		{label: "globe on"}
	);

	const globeLabel = String(
		await page.evaluate(
			`document.querySelector(${JSON.stringify(GLOBE)}).getAttribute("aria-label")`
		)
	);

	// On touch the button is the way into the panel, and says so.
	await page.check(
		MOBILE
			? `the globe offers the settings (${globeLabel})`
			: `the tooltip names the language (${globeLabel})`,
		globeLabel.startsWith(MOBILE ? "Translation settings" : "Translating into")
	);

	other.say("Ich schicke dir gleich das Log, einen Moment bitte.");
	await page.waitFor(`${LINES} === 1`, {timeout: 15000, label: "one translated line"});
	await page.check(
		"chip says from German",
		(await page.evaluate(
			`document.querySelector(".msg-translation-chip").textContent.trim()`
		)) === "from German"
	);
	await page.check(
		"the fake's English echo is shown",
		String(
			await page.evaluate(`document.querySelector(".msg-translation-text").textContent`)
		).includes("[English] Ich schicke dir")
	);
	await page.screenshot("translated-line");

	other.say("this one is already in english so it needs no line at all");
	await page.waitFor(`document.body.innerText.includes("needs no line at all")`, {
		label: "English line arrived",
	});
	await page.sleep(1500);
	await page.check("an English line gets no translation", (await page.evaluate(LINES)) === 1);

	const requestsBeforeBurst = await page.evaluate(`(${REQUESTS}).length`);

	for (let i = 1; i <= 5; i++) {
		other.say(`Zeile ${i} von fünf, alle sollten übersetzt werden.`);
	}

	await page.waitFor(`${LINES} === 6`, {timeout: 20000, label: "burst translated"});

	// The burst was batched into one multi-line LLM request, not five
	// independent translations: the request log (client/js/translate/fakePort.ts)
	// shows a request with `lines >= 2`, and fewer requests than burst lines
	// overall — the tell for the per-line fallback never firing.
	const burstRequests = await page.evaluate(`(${REQUESTS}).slice(${requestsBeforeBurst})`);
	await page.check(
		`the burst was batched, not five singles (${
			burstRequests.length
		} requests, lines per request: ${burstRequests.map((r) => r.lines).join(",")})`,
		burstRequests.some((r) => r.lines >= 2) && burstRequests.length < 5
	);

	for (let i = 1; i <= 5; i++) {
		await page.check(
			`burst line ${i} shows its own translation`,
			await page.evaluate(
				`document.body.innerText.includes(${JSON.stringify(
					`[English] Zeile ${i} von fünf`
				)})`
			)
		);
	}

	// The chip's menu: copy one translation, hide one translation.
	await page.click(".msg-translation-chip");
	await page.waitFor(`!!document.querySelector(".context-menu-translate-hide")`, {
		label: "chip menu open",
	});
	await page.check(
		"the chip's menu offers Copy translation first",
		await page.evaluate(
			`!!document.querySelector("#context-menu-item-0.context-menu-translate-copy")`
		)
	);
	await page.check(
		"the translated line is selectable",
		(await page.evaluate(
			`getComputedStyle(document.querySelector(".msg-translation-text")).userSelect`
		)) === "text"
	);
	await page.click(".context-menu-translate-hide");
	await page.waitFor(`${LINES} === 5`, {label: "one translation hidden"});

	// The toolbar on the first, pre-switch message.
	const firstMsg = `[...document.querySelectorAll(".msg")].find((m) => m.textContent.includes("wie geht es euch heute"))`;

	if (process.argv.includes("--mobile")) {
		await page.evaluate(`${firstMsg}.click()`);
	} else {
		await page.hover(`.msg[data-from="${SPEAKER}"]`);
	}

	await page.evaluate(`${firstMsg}.querySelector(".msg-action-translate").click()`);
	await page.waitFor(`${LINES} === 6`, {timeout: 15000, label: "translate on request"});
	await page.screenshot("translated-burst");

	// The page's own line is never translated, however long or German.
	const ownMarker = `Ausschlussregel${RUN}`;
	const ownLine = `Ich sende hier einen langen deutschen Satz zum Testen der ${ownMarker} für eigene Nachrichten.`;

	await page.fill("#input", ownLine);
	await page.evaluate(`document.querySelector("#form").requestSubmit()`);
	await page.waitFor(`document.body.innerText.includes(${JSON.stringify(ownMarker)})`, {
		timeout: 10000,
		label: "own line sent",
	});
	await page.sleep(1500); // the fake would need well under this to translate it
	await page.check("own line raised no new translation", (await page.evaluate(LINES)) === 6);

	const ownRow = `[...document.querySelectorAll(".msg.self")].find((m) => m.textContent.includes(${JSON.stringify(
		ownMarker
	)}))`;

	await page.check(
		"the own row carries no translation line",
		await page.evaluate(`!!(${ownRow}) && !(${ownRow}).querySelector(".msg-translation")`)
	);

	// The panel: opened from the globe's context menu, full language names,
	// closes on Escape.
	await page.evaluate(
		`document.querySelector(${JSON.stringify(
			GLOBE
		)}).dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}))`
	);
	await page.waitFor(`!!document.querySelector(".translation-panel")`, {
		timeout: 10000,
		label: "panel opens",
	});

	const panelRect = await page.rect(".translation-panel");
	const viewport = await page.evaluate(`({w: innerWidth, h: innerHeight})`);

	await page.check(
		`panel is tall enough (${panelRect ? panelRect.height : "none"}px)`,
		!!panelRect && panelRect.height > 40
	);
	await page.check(
		"panel lies inside the viewport",
		!!panelRect &&
			panelRect.x >= 0 &&
			panelRect.y >= 0 &&
			panelRect.x + panelRect.width <= viewport.w &&
			panelRect.y + panelRect.height <= viewport.h
	);

	await page.check(
		"the footer links to Settings -> Translation",
		String(
			await page.evaluate(
				`(document.querySelector(".translation-panel-more") || {}).getAttribute("href")`
			)
		).endsWith("/settings/translation")
	);

	if (MOBILE) {
		// The phone's layout is the sheet, asserted in full by
		// tools/scenarios/translate-composer.mjs --mobile.
		await page.check(
			"the panel came up as the phone's sheet",
			await page.evaluate(`!!document.querySelector(".translation-panel--sheet")`)
		);
	} else {
		// One column: every setting is a label with its control under it, so
		// the four controls come out the same width.
		const controlWidths = await page.evaluate(
			`[...document.querySelectorAll(".translation-panel .translation-panel-control")].map((c) => Math.round(c.getBoundingClientRect().width))`
		);

		await page.check(
			`the four controls share one width (${controlWidths.join(", ")})`,
			controlWidths.length === 4 && new Set(controlWidths).size === 1
		);
		await page.check(
			"the hints stay out of the desktop panel",
			(await page.evaluate(
				`getComputedStyle(document.querySelector(".translation-panel-hint")).display`
			)) === "none"
		);
	}

	await page.screenshot("translation-panel");

	const readLabels = await page.evaluate(
		`[...document.querySelectorAll('select[name="translateRead"] option')].map((o) => o.textContent.trim())`
	);

	await page.check(
		`the "read" select names languages in full (${readLabels.join(", ")})`,
		readLabels.includes("German") && readLabels.every((label) => !/^[a-z]{2}$/i.test(label))
	);

	await page.evaluate(
		`document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))`
	);
	await page.waitFor(`!document.querySelector(".translation-panel")`, {
		timeout: 5000,
		label: "panel closes on Escape",
	});

	// A line carrying the fake's failure token fails once; the retry
	// button succeeds the second time.
	const failMarker = `Wiederholungsprobe${RUN}`;
	const failLine = `Dies ist ein langer deutscher Testsatz mit einem [fail] Marker für die ${failMarker}.`;

	other.say(failLine);

	const failRow = `[...document.querySelectorAll(".msg")].find((m) => m.textContent.includes(${JSON.stringify(
		failMarker
	)}))`;

	await page.waitFor(
		`!!(${failRow}) && !!(${failRow}).querySelector('.msg-translation[data-status="failed"]')`,
		{timeout: 15000, label: "the marked line fails once"}
	);
	await page.check(
		"the failed line offers a retry button",
		await page.evaluate(`!!(${failRow}).querySelector(".msg-translation-retry")`)
	);
	await page.click(".msg-translation-retry");
	await page.waitFor(
		`!!(${failRow}) && !!(${failRow}).querySelector('.msg-translation[data-status="done"]')`,
		{timeout: 15000, label: "the retry succeeds"}
	);
	await page.check(
		"the retried translation carries the English echo",
		await page.evaluate(
			`(${failRow}).querySelector(".msg-translation-text").textContent.includes("[English]")`
		)
	);
	await page.check("the retry added exactly one done line", (await page.evaluate(LINES)) === 7);

	// Markdown markers and the names in the channel are protected, never
	// translated: the fake echoes what it was given, so the translated line
	// still carries the emphasis (rendered, as in the original) and the
	// page's own nick.
	const emphasisMarker = `Betonungsprobe${RUN}`;

	other.say(
		`Hallo ${NICK}, das ist *Betonung* in der ${emphasisMarker} und danach folgt noch mehr Text.`
	);

	const emphasisRow = `[...document.querySelectorAll(".msg")].filter((m) => m.textContent.includes(${JSON.stringify(
		emphasisMarker
	)})).pop()`;

	await page.waitFor(
		`!!(${emphasisRow}) && !!(${emphasisRow}).querySelector('.msg-translation[data-status="done"]')`,
		{timeout: 15000, label: "the emphasised line is translated"}
	);
	await page.check(
		"the emphasis survived and renders as emphasis in the translation",
		(await page.evaluate(
			`((${emphasisRow}).querySelector(".msg-translation-text .irc-italic") || {}).textContent`
		)) === "Betonung"
	);
	await page.check(
		"the page's own nick came back untouched",
		await page.evaluate(
			`(${emphasisRow}).querySelector(".msg-translation-text").textContent.includes(${JSON.stringify(
				NICK
			)})`
		)
	);

	// A draft/multiline message is one message with newlines in it: every
	// line of it is translated, not just the first.
	const multiMarker = `Mehrzeiler${RUN}`;
	const multiLines = [
		`Erste Zeile vom ${multiMarker} mit genügend Worten darin.`,
		`Zweite Zeile vom ${multiMarker} und noch ein paar Worte mehr.`,
		`Dritte Zeile vom ${multiMarker}, damit ist dann Schluss.`,
	];

	other.sayMultiline(multiLines);

	const multiRow = `[...document.querySelectorAll(".msg")].filter((m) => m.textContent.includes(${JSON.stringify(
		multiMarker
	)})).pop()`;

	await page.waitFor(`!!(${multiRow})`, {
		timeout: 15000,
		label: "the multi-line message arrived",
	});
	await page.check(
		"the three lines arrived as one message",
		await page.evaluate(
			multiLines
				.map((l) => `(${multiRow}).textContent.includes(${JSON.stringify(l)})`)
				.join(" && ")
		)
	);
	await page.waitFor(
		`!!(${multiRow}) && !!(${multiRow}).querySelector('.msg-translation[data-status="done"]')`,
		{timeout: 25000, label: "the multi-line message is translated"}
	);

	for (const line of multiLines) {
		await page.check(
			`the multi-line translation carries "${line.slice(0, 24)}…"`,
			await page.evaluate(
				`(${multiRow}).querySelector(".msg-translation-text").textContent.includes(${JSON.stringify(
					`[English] ${line}`
				)})`
			)
		);
	}

	await page.screenshot("translated-multiline");

	// Off again: a new German line gets nothing.
	await setReading(page, "");
	await page.waitFor(
		`!document.querySelector(${JSON.stringify(GLOBE)}).classList.contains("on")`,
		{label: "globe off"}
	);
	other.say("Nach dem Ausschalten passiert hier nichts mehr.");
	await page.waitFor(`document.body.innerText.includes("passiert hier nichts mehr")`, {
		label: "post-switch line arrived",
	});
	await page.sleep(1500);
	await page.check("no translation after switching off", (await page.evaluate(LINES)) === 9);

	// A deleted message keeps neither its text nor its translation: the
	// speaker redacts one of its own translated lines (an unauthenticated
	// author may redact its own message with no window) and the row loses
	// the translated copy with the original.
	const burstText = "Zeile 5 von fünf, alle sollten übersetzt werden.";
	const burstMsgid = other.msgidOf(burstText);

	await page.check(
		`the speaker learned its line's msgid (${burstMsgid ?? "none"})`,
		!!burstMsgid
	);

	// The row is found before the REDACT: afterwards its text is behind the
	// "deleted" button and no longer in textContent. The last match, not the
	// first: #seance keeps its history, so earlier runs of this scenario are
	// replayed above this one's line (their rows carry negative ids).
	const burstRowId = await page.evaluate(
		`(([...document.querySelectorAll(".msg")].filter((m) => m.textContent.includes("Zeile 5 von fünf")).pop()) || {}).id || ""`
	);
	const burstRow = `document.getElementById(${JSON.stringify(burstRowId)})`;

	await page.check(
		`the burst line's row was found (${burstRowId || "none"}) with its translation`,
		await page.evaluate(`!!(${burstRow}) && !!(${burstRow}).querySelector(".msg-translation")`)
	);

	other.redact(burstMsgid);
	await page.waitFor(`!!(${burstRow}) && !!(${burstRow}).querySelector(".msg-redacted")`, {
		timeout: 15000,
		label: "the redacted row shows the deleted button",
	});
	await page.check(
		"the deleted row keeps no translation",
		await page.evaluate(`!(${burstRow}).querySelector(".msg-translation")`)
	);
	await page.check(
		"the redaction took exactly one translated line away",
		(await page.evaluate(LINES)) === 8
	);
	await page.screenshot("redacted-translation");

	other.quit();
	await page.check("no console errors", page.consoleErrors.length === 0);
}
