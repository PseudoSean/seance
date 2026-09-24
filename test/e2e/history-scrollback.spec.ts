import {expect, test, type Page} from "@playwright/test";
import * as net from "node:net";

// Scrollback in a real browser against a real ircd. Two invariants that a
// user on a phone saw broken (2026-09-06): the "show older messages" load
// is fired by an IntersectionObserver on the button, and
//
//  1. with no in-flight guard, a scroll that takes the button out of view
//     and back while a page is loading fired a SECOND request -- two in
//     flight, and a burst of them when the button re-rendered as each page
//     landed;
//  2. once two overlapped, the first reply cleared the shared
//     `historyLoading` flag while the second was pending, the second
//     prepend skipped the flag-gated scroll compensation, and the view was
//     left at the top of the buffer ("sticks to the top", button gone once
//     history ran out).
//
// The invariants asserted: never more than one CHATHISTORY request in
// flight, and `scrollHeight - scrollTop` (what keepScrollPosition preserves)
// unchanged across every prepend that delivered rows.
//
// Runs only when SEANCE_E2E_IRC_URL names a WebSocket ircd; it also needs
// SEANCE_E2E_SEED_HOST/PORT (plaintext) to seed the channel with history.

const ircUrl = process.env.SEANCE_E2E_IRC_URL;
const seedHost = process.env.SEANCE_E2E_SEED_HOST ?? "127.0.0.1";
const seedPort = Number(process.env.SEANCE_E2E_SEED_PORT ?? "6667");
const ROWS = 260; // > 2 pages of 100

test.skip(!ircUrl, "set SEANCE_E2E_IRC_URL to run the live scrollback e2e test");

const channel = `#e2esb-${Math.random().toString(36).slice(2, 8)}`;

function webIrcUri(url: string) {
	return `web+irc://${new URL(url).host}/${channel}`;
}

let seedSocket: net.Socket | null = null;

// The seeder stays in the channel: nefarious2 (2026-09-08) treats a
// channel that emptied and was rejoined as a new incarnation and hides the
// earlier rows, which is the ircd's business, not this test's.
test.afterEach(() => {
	seedSocket?.write("QUIT :seeded\r\n");
	seedSocket?.end();
	seedSocket = null;
});

/** Seed the channel over a plain TCP connection: ROWS messages, and stay. */
function seedHistory(): Promise<void> {
	return new Promise((resolve, reject) => {
		const s = net.connect(seedPort, seedHost);
		let buf = "";
		let registered = false;
		const nick = `seed${Math.floor(1000 + Math.random() * 9000)}`;
		s.setEncoding("utf8");
		s.on("error", reject);
		s.on("data", (d: string) => {
			buf += d;
			let i: number;

			while ((i = buf.indexOf("\r\n")) >= 0) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 2);

				if (line.startsWith("PING")) {
					s.write(`PONG ${line.slice(5)}\r\n`);
				}

				if (!registered && / 001 /.test(line)) {
					registered = true;
					s.write(`JOIN ${channel}\r\n`);
					let n = 0;
					const tick = setInterval(() => {
						s.write(`PRIVMSG ${channel} :row ${n}\r\n`);

						if (++n >= ROWS) {
							clearInterval(tick);
							// let the last rows persist
							setTimeout(() => {
								seedSocket = s;
								resolve();
							}, 1500);
						}
					}, 12);
				}
			}
		});
		s.write(`NICK ${nick}\r\nUSER e e e :seed\r\n`);
	});
}

async function connect(page: Page) {
	const nick = `sb-e2e-${Math.floor(1000 + Math.random() * 9000)}`;
	await page.goto(`/?uri=${encodeURIComponent(webIrcUri(ircUrl!))}`);
	await page.waitForSelector("#connect");
	await page.fill("#connect\\:nick", nick);
	await page.click("#connect form button[type=submit]");
	await page.waitForSelector(`#chat-container[data-current-channel="${channel}"]`);
	await page.waitForSelector(`#chat-container .userlist .user[data-name="${nick}"]`, {
		timeout: 60_000,
	});
	await page.waitForSelector("#input");
	return nick;
}

/** scrollHeight - scrollTop of the chat pane: the quantity keepScrollPosition preserves. */
function anchor(page: Page) {
	return page.evaluate(() => {
		const el = document.querySelector(".chat") as HTMLElement;
		return el.scrollHeight - el.scrollTop;
	});
}

function scrollTo(page: Page, top: number) {
	return page.evaluate((t) => {
		const el = document.querySelector(".chat") as HTMLElement;
		el.scrollTop = t;
	}, top);
}

test("scrollback never overlaps requests and keeps the anchor across every prepend", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await seedHistory();

	// Track CHATHISTORY requests in flight from the WebSocket frames.
	let inFlight = 0;
	let maxInFlight = 0;
	let sent = 0;
	let landed = 0;
	const chathistoryBatches = new Set<string>();
	page.on("websocket", (ws) => {
		ws.on("framesent", (f) => {
			const p = String(f.payload);

			if (/^(@\S+ )?CHATHISTORY (BEFORE|LATEST) /i.test(p)) {
				sent++;
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
			}
		});
		ws.on("framereceived", (f) => {
			const p = String(f.payload);
			const open = /BATCH \+(\S+) chathistory/i.exec(p);

			if (open) {
				chathistoryBatches.add(open[1]);
			}

			const close = /BATCH -(\S+)/i.exec(p);

			if (close && chathistoryBatches.has(close[1])) {
				chathistoryBatches.delete(close[1]);
				landed++;
				inFlight = Math.max(0, inFlight - 1);
			}
		});
	});

	await connect(page);
	// The JOIN fill (first page) lands.
	await expect.poll(() => landed, {timeout: 30_000}).toBeGreaterThanOrEqual(1);
	await page.waitForTimeout(500);
	// A FULL first page (limit rows of a larger channel) must leave the
	// "show older messages" button available; the old arithmetic
	// (totalMessages+1 > live rows + new rows) hid it whenever the JOIN
	// echo landed before the fill, so scrollback was never offered.
	await expect(
		page.locator(".show-more button"),
		"older-messages button after a full page"
	).toBeVisible({visible: true, timeout: 5_000});

	function scrollTopOf(p: Page) {
		return p.evaluate(() => (document.querySelector(".chat") as HTMLElement).scrollTop);
	}

	// Page back three times. Each round: go to the top (the observer fires
	// the load), note the anchor THERE, then -- while it is loading -- take
	// the button out of view and back, what a thumb resting at the top does.
	// Without the guard that fired a second request into the first; and
	// once two overlapped, the second prepend skipped the scroll
	// compensation and left the view at the top.
	for (let round = 0; round < 3; round++) {
		const sentBefore = sent;
		const landedBefore = landed;

		await scrollTo(page, 0);
		await expect.poll(() => sent, {timeout: 10_000}).toBe(sentBefore + 1);
		const anchorAtTop = await anchor(page);

		// Provoke a second request while the first is in flight. A fast
		// server may have landed the page already (the bed answers in
		// ~100 ms); then the scroll back to 0 is a scroll of the user's own
		// on top of a finished prepend and the round's anchor check would be
		// meaningless -- so the round only asserts what its timing allows.
		await scrollTo(page, 240);
		await page.waitForTimeout(40);
		const stillLoading = landed === landedBefore;
		await scrollTo(page, 0);
		await page.waitForTimeout(150);

		if (stillLoading) {
			expect(sent, `round ${round}: a second request went out while one was loading`).toBe(
				sentBefore + 1
			);
		}

		await expect.poll(() => landed, {timeout: 30_000}).toBeGreaterThanOrEqual(landedBefore + 1);
		await page.waitForTimeout(800); // render + scroll restore settle

		if (!(await page.isVisible(".show-more button"))) {
			break; // history exhausted
		}

		if (!stillLoading) {
			continue;
		}

		// Invariant 2: the row that was at the top is still where it was --
		// the prepend added height above and scrollTop moved by the same
		// amount, so scrollHeight - scrollTop is unchanged and the view is
		// no longer at the top.
		const anchorAfter = await anchor(page);
		expect(
			Math.abs(anchorAfter - anchorAtTop),
			`round ${round}: anchor drifted`
		).toBeLessThanOrEqual(4);
		expect(await scrollTopOf(page), `round ${round}: view stuck at the top`).toBeGreaterThan(0);
	}

	// Invariant 1: never two history requests in flight.
	expect(maxInFlight, `max in flight (sent ${sent}, landed ${landed})`).toBeLessThanOrEqual(1);
});

test("a compensation the scroller drops is restored, and does not chain-load", async ({page}) => {
	// WebKit ignores a scrollTop written while a momentum scroll or a held
	// finger is active: the prepend lands, the view stays at the top, and
	// the button (re-rendered with every page) re-fires the observer -- one
	// lost compensation used to load page after page and leave the user
	// hours back. Emulated here by forcing the view back to 0 right after
	// the compensation applied.
	test.setTimeout(120_000);
	await seedHistory();

	let sent = 0;
	let landed = 0;
	const batches = new Set<string>();
	page.on("websocket", (ws) => {
		ws.on("framesent", (f) => {
			if (/^(@\S+ )?CHATHISTORY (BEFORE|LATEST) /i.test(String(f.payload))) {
				sent++;
			}
		});
		ws.on("framereceived", (f) => {
			const p = String(f.payload);
			const open = /BATCH \+(\S+) chathistory/i.exec(p);

			if (open) {
				batches.add(open[1]);
			}

			const close = /BATCH -(\S+)/i.exec(p);

			if (close && batches.delete(close[1])) {
				landed++;
			}
		});
	});

	await connect(page);
	await expect.poll(() => landed, {timeout: 30_000}).toBeGreaterThanOrEqual(1);
	await page.waitForTimeout(500);

	const scrollTopOf = () =>
		page.evaluate(() => (document.querySelector(".chat") as HTMLElement).scrollTop);

	const sentBefore = sent;
	const landedBefore = landed;
	await scrollTo(page, 0);
	await expect.poll(() => sent, {timeout: 10_000}).toBe(sentBefore + 1);
	const anchorAtTop = await anchor(page);
	await expect.poll(() => landed, {timeout: 30_000}).toBe(landedBefore + 1);
	// Let the compensation land, then take it away as WebKit would.
	await expect.poll(scrollTopOf, {timeout: 5_000}).toBeGreaterThan(0);
	await scrollTo(page, 0);
	await page.waitForTimeout(700);

	expect(Math.abs((await anchor(page)) - anchorAtTop), "anchor not restored").toBeLessThanOrEqual(
		4
	);
	expect(await scrollTopOf(), "view left at the top").toBeGreaterThan(0);
	expect(sent, "chain-loaded after the lost compensation").toBe(sentBefore + 1);

	// A scroll of the user's own, later, loads exactly one more page.
	await page.waitForTimeout(500);
	await scrollTo(page, 0);
	await expect.poll(() => sent, {timeout: 10_000}).toBe(sentBefore + 2);
	await expect.poll(() => landed, {timeout: 30_000}).toBe(landedBefore + 2);
	await page.waitForTimeout(800);
	expect(sent, "more than one page per user scroll").toBe(sentBefore + 2);
	expect(await scrollTopOf()).toBeGreaterThan(0);
});
