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
// translation panel opens on the globe's context menu with full language
// names (never codes) and closes on Escape; a line carrying the fake's
// `[fail]` marker fails once and its retry button succeeds the second
// time; switching off stops new ones. Detection is real (franc); only the
// engine is scripted.
//
//   corepack yarn build && python3 -m http.server -d public 8021 &
//   CHROME_BIN=/seance/tmp/chrome-pw.sh node tools/browser-drive.mjs tools/scenarios/translate-reading.mjs
//   … --mobile --width=390 --height=844
//
// Needs the dev ircd's plain-WS port on 127.0.0.1:8067. NODE_ENV must be
// unset for the build: a production build compiles the fake out.

const RUN = Date.now().toString(36);
const NICK = `tr${RUN}`;
const SPEAKER = `de${RUN}`;
const CHANNEL = "#seance";
const IRCD = process.env.SEANCE_IRC_WS || "ws://127.0.0.1:8067/";
const BASE = "http://localhost:8021/";

export const url = `${BASE}?host=127.0.0.1&port=8067&tls=false&nick=${NICK}&join=%23seance&fakeTranslate`;

const LINES = `document.querySelectorAll('.msg-translation[data-status="done"]').length`;
const GLOBE = "#chat button.translate";
const REQUESTS = `(window.__seanceTranslateFake && window.__seanceTranslateFake.requests) || []`;

function speaker(nick) {
	const ws = new WebSocket(IRCD, ["text.ircv3.net"]);
	let joinedResolve;
	let joinedReject;
	const joined = new Promise((resolve, reject) => {
		joinedResolve = resolve;
		joinedReject = reject;
		setTimeout(() => reject(new Error("speaker never joined")), 20000);
	});

	ws.onopen = () => {
		ws.send(`NICK ${nick}`);
		ws.send(`USER ${nick} 0 * :seance translation reader`);
	};
	ws.onmessage = (ev) => {
		const line = String(ev.data);

		if (line.startsWith("PING")) {
			ws.send(line.replace("PING", "PONG"));
		} else if (/ 001 /.test(line)) {
			ws.send(`JOIN ${CHANNEL}`);
		} else if (/ 433 /.test(line)) {
			ws.send(`NICK ${nick}_`);
		} else if (new RegExp(`^:${nick}\\S* JOIN`).test(line)) {
			joinedResolve();
		}
	};
	ws.onerror = () => joinedReject(new Error("speaker socket error"));

	return {
		joined,
		say: (text) => ws.send(`PRIVMSG ${CHANNEL} :${text}`),
		quit: () => ws.send("QUIT :done"),
	};
}

export default async function run(page) {
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

	await page.click(GLOBE);
	await page.waitFor(
		`document.querySelector(${JSON.stringify(GLOBE)}).classList.contains("on")`,
		{label: "globe on"}
	);
	await page.check(
		"tooltip names the language",
		String(
			await page.evaluate(
				`document.querySelector(${JSON.stringify(GLOBE)}).getAttribute("aria-label")`
			)
		).startsWith("Translating into")
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

	// The chip's menu: hide one translation.
	await page.click(".msg-translation-chip");
	await page.waitFor(`!!document.querySelector(".context-menu-translate-hide")`, {
		label: "chip menu open",
	});
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

	// Off again: a new German line gets nothing.
	await page.click(GLOBE);
	await page.waitFor(
		`!document.querySelector(${JSON.stringify(GLOBE)}).classList.contains("on")`,
		{label: "globe off"}
	);
	other.say("Nach dem Ausschalten passiert hier nichts mehr.");
	await page.waitFor(`document.body.innerText.includes("passiert hier nichts mehr")`, {
		label: "post-switch line arrived",
	});
	await page.sleep(1500);
	await page.check("no translation after switching off", (await page.evaluate(LINES)) === 7);

	other.quit();
	await page.check("no console errors", page.consoleErrors.length === 0);
}
