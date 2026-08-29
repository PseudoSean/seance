import {expect, Page, test} from "@playwright/test";

// Live end-to-end cover for Markdown rendering: the built `public/` tree in a
// real browser, talking to a real ircd, asserting on what the DOM ends up
// holding. The tree it renders from is unit-tested in `test/helpers/layout.ts`;
// what only a browser can answer is whether the elements that tree names really
// turn up. It only runs when SEANCE_E2E_IRC_URL points at a WebSocket ircd
// (e.g. `wss://irc.example.org:9998/`), and it sends four messages to a real
// channel — five when SEANCE_E2E_MULTILINE adds the multi-line one below — so
// keep it that way.
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
	// A masked link is the anchor carrying `md-link` and the destination in
	// its title, which is what tells it apart from a linkified one.
	const masked = msg.locator("a.md-link");

	await expect(masked).toHaveText("lnk");
	await expect(masked).toHaveAttribute("title", "https://example.com/");
	await expect(msg.locator(".content")).not.toContainText("**");
	await expect(msg.locator(".content")).not.toContainText("||");

	await msg.locator(".md-spoiler").click();
	await expect(msg.locator(".md-spoiler")).toHaveClass(/md-spoiler-shown/);

	await say(page, `> ${token}b quoted \`\`\`block https://example.com/x\`\`\``);

	const quoted = own(page, nick, `${token}b`);

	await expect(quoted.locator(".md-quote")).toContainText("quoted");
	await expect(quoted.locator(".md-code-block")).toHaveText("block https://example.com/x");
	await expect(quoted.locator(".content")).not.toContainText(">");
	// A code block renders its characters and nothing else, so the URL in it
	// stays code: the layout tree does hold a link node there, and the adapter
	// flattens it (`test/helpers/layout.ts`, "renders a code block from its
	// characters alone").
	await expect(quoted.locator(".md-code-block a")).toHaveCount(0);
	// A code block is rows now, one per line, with the gutter counter only on
	// blocks of two lines or more. One row is all a single-line message can
	// hold: a fence language tag is only a tag when the fence line ends in a
	// newline, and a second row needs one too. Newlines reach the wire only
	// where the server and the client both negotiate `draft/multiline` (a
	// separate branch/PR), so the multi-line case is the gated test below
	// rather than this one. The highlighter itself is covered by
	// `test/helpers/highlighter.ts`.
	await expect(quoted.locator(".md-code-block .md-line")).toHaveCount(1);
	await expect(quoted.locator(".md-code-block")).not.toHaveClass(/md-code-block--numbered/);
});

// The other half of the code block: the fence language tag and the gutter, both
// of which need a message with newlines in it. Only a client and server that
// negotiate `draft/multiline` put one on the wire, and that lives on a separate
// branch/PR — so this is gated on SEANCE_E2E_MULTILINE, and the rest of the
// file still runs on a build without it.
test("renders a fenced multi-line code block", async ({page}) => {
	test.skip(
		!process.env.SEANCE_E2E_MULTILINE,
		"set SEANCE_E2E_MULTILINE=1 on a build that negotiates draft/multiline"
	);

	const nick = await connect(page);

	// Composed the way a user does — Shift+Enter between the lines, Enter to
	// send. `page.fill` would set the value in one go and never exercise the
	// keyboard path, which is what puts the newlines there (`ChatInput.vue`
	// submits on `@keypress.enter.exact`, so Shift+Enter falls through to the
	// textarea).
	await page.click("#input");
	await page.keyboard.type("```js");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("const x = 1;");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("let y = x;");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("```");
	await page.keyboard.press("Enter");

	// The random nick is this run's token: nothing else in the channel comes
	// from it, so every own message here belongs to that one send.
	const msg = page.locator(`.msg[data-type="message"][data-from="${nick}"]`);
	const block = msg.locator(".md-code-block");

	// `data-lang` lands only once the lazy Prism chunk has resolved and the
	// block has re-rendered with its tokens, so this is the assertion that
	// waits for the highlighting — and `js` normalised to `javascript` is the
	// fence tag having survived as a tag.
	await expect(block).toHaveAttribute("data-lang", "javascript");

	const keywords = await block.locator(".tok-keyword").allInnerTexts();

	expect(keywords).toContain("const");
	expect(keywords).toContain("let");

	// Two code rows, so the block carries the gutter counter.
	await expect(msg.locator(".md-code-block--numbered .md-line")).toHaveCount(2);
	await expect(msg.locator(".content")).not.toContainText("```");
	// Last, deliberately: a per-line send would have shown up as four separate
	// messages long before the highlighted block above rendered.
	await expect(msg).toHaveCount(1);
});

test("leaves the text alone when the setting is off, Alt+K toggles it", async ({page}) => {
	const nick = await connect(page);
	const token = `md${nick.slice(-4)}`;
	// Navigate by hash only: `page.goto` would reload the SPA and drop the
	// socket, because the connect URL differs in path and query.
	const chat = await page.evaluate(() => location.hash);

	// Sent while the setting is still on, so the flip has to re-render it.
	// The words are deliberately neutral: everyone else in the channel sees
	// these lines rendered, so a payload that describes a look ("not bold")
	// reads as a bug on their screen.
	await say(page, `${token}p **toggle-probe**`);

	const pre = own(page, nick, `${token}p`);

	await expect(pre.locator(".irc-bold")).toHaveText("toggle-probe");

	// Alt+K with the chat input focused, exactly like a user would use it
	await page.click("#input");
	await page.keyboard.press("Alt+K");

	await page.evaluate(() => {
		location.hash = "#/settings/appearance";
	});

	const markdown = page.locator('input[name="markdown"]');

	await expect(markdown).not.toBeChecked();

	await page.evaluate((hash) => {
		location.hash = hash;
	}, chat);
	await page.waitForSelector("#input");

	// The message that was already on screen re-renders with the markers back
	await expect(pre.locator(".irc-bold")).toHaveCount(0);
	await expect(pre.locator(".content")).toContainText("**toggle-probe**");

	await say(page, `${token}c **markers-kept**`);

	const msg = own(page, nick, `${token}c`);

	await expect(msg.locator(".content")).toContainText("**markers-kept**");
	await expect(msg.locator(".irc-bold")).toHaveCount(0);

	// Alt+K again re-enables rendering, restoring both messages
	await page.click("#input");
	await page.keyboard.press("Alt+K");

	await page.evaluate(() => {
		location.hash = "#/settings/appearance";
	});

	await expect(markdown).toBeChecked();

	await page.evaluate((hash) => {
		location.hash = hash;
	}, chat);
	await page.waitForSelector("#input");

	await expect(pre.locator(".irc-bold")).toHaveText("toggle-probe");
	await expect(msg.locator(".irc-bold")).toHaveText("markers-kept");
});
