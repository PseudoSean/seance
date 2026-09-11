// The reading pipeline in a real browser, on the in-page fake engine
// (?fakeTranslate on a non-production build) with a second user speaking
// German in #seance through a raw WebSocket to the dev ircd: nothing is
// translated before the globe is switched on; after it, a German line gets
// a "from German" line with the fake's "[English] …" echo, an English line
// gets none, a burst is translated line by line, the chip's menu can hide
// a translation, the toolbar's Translate does one message on request, and
// switching off stops new ones. Detection is real (franc); only the
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

	for (let i = 1; i <= 5; i++) {
		other.say(`Zeile ${i} von fünf, alle sollten übersetzt werden.`);
	}

	await page.waitFor(`${LINES} === 6`, {timeout: 20000, label: "burst translated"});

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
	await page.check("no translation after switching off", (await page.evaluate(LINES)) === 6);

	other.quit();
	await page.check("no console errors", page.consoleErrors.length === 0);
}
