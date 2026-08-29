import {expect, Page, test} from "@playwright/test";

// Live end-to-end cover for Markdown rendering: the built `public/` tree in a
// real browser, talking to a real ircd, asserting on what the DOM ends up
// holding. It only runs when SEANCE_E2E_IRC_URL points at a WebSocket ircd
// (e.g. `wss://irc.example.org:9998/`), and it sends three lines to a real
// channel, so keep it that way.
const ircUrl = process.env.SEANCE_E2E_IRC_URL;
const channel = process.env.SEANCE_E2E_CHANNEL ?? "#ps";

test.skip(!ircUrl, "set SEANCE_E2E_IRC_URL to run the live Markdown e2e test");

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

async function say(page: Page, text: string) {
	await page.click("#input");
	await page.fill("#input", text);
	await page.press("#input", "Enter");
}

// Our own message carrying `token`. Picking messages by a unique token rather
// than by position keeps the assertions pointed at one specific line in a
// channel other people are talking in.
function own(page: Page, nick: string, token: string) {
	return page
		.locator(`.msg[data-type="message"][data-from="${nick}"]:has-text("${token}")`)
		.first();
}

test("renders Markdown in own messages", async ({page}) => {
	const nick = await connect(page);
	const token = `md${nick.slice(-4)}`;

	await say(
		page,
		`${token}a **bold** *it* __ul__ ~~st~~ \`co\` ||sp|| [lnk](https://example.com/)`
	);

	const msg = own(page, nick, `${token}a`);

	await expect(msg.locator(".irc-bold")).toHaveText("bold");
	await expect(msg.locator(".irc-italic")).toHaveText("it");
	await expect(msg.locator(".irc-underline")).toHaveText("ul");
	await expect(msg.locator(".irc-strikethrough")).toHaveText("st");
	await expect(msg.locator(".irc-monospace")).toHaveText("co");
	await expect(msg.locator(".md-spoiler")).toHaveText("sp");
	// A Markdown link carries `title=`; one produced by linkify carries
	// `dir="auto"` instead, so this asserts where the anchor came from.
	await expect(msg.locator('a[title="https://example.com/"]')).toHaveText("lnk");
	await expect(msg.locator(".content")).not.toContainText("**");
	await expect(msg.locator(".content")).not.toContainText("||");

	await msg.locator(".md-spoiler").click();
	await expect(msg.locator(".md-spoiler")).toHaveClass(/md-spoiler-shown/);

	await say(page, `> ${token}b quoted \`\`\`block\`\`\``);

	const quoted = own(page, nick, `${token}b`);

	await expect(quoted.locator(".md-quote")).toContainText("quoted");
	await expect(quoted.locator(".md-code-block")).toHaveText("block");
	await expect(quoted.locator(".content")).not.toContainText(">");
});

test("leaves the text alone when the setting is off", async ({page}) => {
	const nick = await connect(page);
	const token = `md${nick.slice(-4)}`;
	// Navigate by hash only: `page.goto` would reload the SPA and drop the
	// socket, because the connect URL differs in path and query.
	const chat = await page.evaluate(() => location.hash);

	await page.evaluate(() => {
		location.hash = "#/settings/appearance";
	});

	const markdown = page.locator('input[name="markdown"]');

	await expect(markdown).toBeChecked();
	await markdown.click();
	await expect(markdown).not.toBeChecked();

	await page.evaluate((hash) => {
		location.hash = hash;
	}, chat);
	await page.waitForSelector("#input");

	await say(page, `${token}c **not bold**`);

	const msg = own(page, nick, `${token}c`);

	await expect(msg.locator(".content")).toContainText("**not bold**");
	await expect(msg.locator(".irc-bold")).toHaveCount(0);
});
