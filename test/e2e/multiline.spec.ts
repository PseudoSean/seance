import {expect, Page, test} from "@playwright/test";

// Live end-to-end cover for `draft/multiline`: the built `public/` tree in a
// real browser, talking to a real ircd. What only a browser can answer is
// whether Shift+Enter really composes one message — the newline has to survive
// the textarea, the store, `dispatchInput`, the batch on the wire and the way
// the timeline renders it, and every one of those is unit-tested apart. It only
// runs when SEANCE_E2E_IRC_URL points at a WebSocket ircd (e.g.
// `wss://irc.example.org:9998/`) that offers `draft/multiline`, and it sends
// one message to a real channel, so keep it that way.
const ircUrl = process.env.SEANCE_E2E_IRC_URL;
const channel = process.env.SEANCE_E2E_CHANNEL ?? "#ps";

test.skip(!ircUrl, "set SEANCE_E2E_IRC_URL to run the live multiline e2e test");

// `?uri=` speaks our own scheme (`docs/resources/irc-links.md`): the authority
// is the WebSocket endpoint, the fragment is the channel, TLS is implied.
function webIrcUri(url: string) {
	const chan = channel.startsWith("#") ? channel : `#${channel}`;

	return `web+irc://${new URL(url).host}/${chan}`;
}

// Connects through the connect form exactly as a `web+irc://` link does and
// waits until the channel window is open. The random nick doubles as the
// `data-from` selector for our own messages; keep it short enough to survive
// the server's NICKLEN.
async function connect(page: Page) {
	const nick = `seance-e2e-${Math.floor(1000 + Math.random() * 9000)}`;

	await page.goto(`/?uri=${encodeURIComponent(webIrcUri(ircUrl!))}`);
	await page.waitForSelector("#connect");
	await page.fill("#connect\\:nick", nick);
	await page.click("#connect form button[type=submit]");
	await page.waitForSelector(`#chat-container[data-current-channel="${channel}"]`);
	// The channel window opens as soon as the connect form is submitted, well
	// before registration finishes, and the input refuses to send until the
	// network is connected — so wait for our own nick to turn up in the
	// channel's user list, which only happens once the JOIN went through.
	await page.waitForSelector(`#chat-container .userlist .user[data-name="${nick}"]`, {
		timeout: 60_000,
	});
	await page.waitForSelector("#input");

	return nick;
}

// Composes `lines` the way a user does — Shift+Enter between them, Enter to
// send. `page.fill` would set the value in one go and never exercise the
// keyboard path, which is the whole point here (`ChatInput.vue` submits on
// `@keypress.enter.exact`, so Shift+Enter falls through to the textarea).
async function sayLines(page: Page, lines: string[]) {
	await page.click("#input");

	for (const [i, line] of lines.entries()) {
		if (i > 0) {
			await page.keyboard.press("Shift+Enter");
		}

		await page.keyboard.type(line);
	}

	await page.keyboard.press("Enter");
}

test("Shift+Enter composes one multi-line message", async ({page}) => {
	const nick = await connect(page);
	const token = `ml${nick.slice(-4)}`;
	// The token is on every line: had the client sent one message per line,
	// three messages would carry it instead of one.
	const lines = [`${token} line one`, `${token} line two`, `${token} line three`];

	await sayLines(page, lines);

	const own = page.locator(`.msg[data-type="message"][data-from="${nick}"]:has-text("${token}")`);

	await expect(own).toHaveCount(1);

	const content = own.locator(".content");

	for (const line of lines) {
		await expect(content).toContainText(line);
	}

	// Rendered as one entry with the line breaks kept, not as one run-on line.
	expect((await content.innerText()).trim().split("\n").filter(Boolean)).toHaveLength(3);

	// A per-line send would have produced the other two messages by now.
	await page.waitForTimeout(3_000);
	await expect(own).toHaveCount(1);
});
