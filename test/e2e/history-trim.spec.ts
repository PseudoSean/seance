import {expect, test, type Page} from "@playwright/test";
import * as net from "node:net";

// The UI keeps only 100 messages of a channel it is not showing (router.ts
// when navigating away, socket-events/msg.ts when a live line arrives) and
// turns "more history" back on. The IRC layer must forget the dropped rows
// too, or every page that brings them back is deduplicated away: the
// channel then answers each scroll-up with nothing, on that channel only,
// until a restart (2026-09-17, busy channels on a phone).
//
// Needs SEANCE_E2E_IRC_HOST/PORT (a PLAIN ws port), SEANCE_E2E_SASL_ACCOUNT/
// PASSWORD and SEANCE_E2E_SEED_HOST/PORT (plain TCP) to seed the channel.

const host = process.env.SEANCE_E2E_IRC_HOST;
const port = process.env.SEANCE_E2E_IRC_PORT ?? "8067";
const account = process.env.SEANCE_E2E_SASL_ACCOUNT ?? "";
const password = process.env.SEANCE_E2E_SASL_PASSWORD ?? "";
const seedHost = process.env.SEANCE_E2E_SEED_HOST ?? "127.0.0.1";
const seedPort = Number(process.env.SEANCE_E2E_SEED_PORT ?? "6667");
const ROWS = 400;

test.skip(!host || !account, "set SEANCE_E2E_IRC_HOST and SEANCE_E2E_SASL_ACCOUNT/PASSWORD");

const channel = `#e2etrim-${Math.random().toString(36).slice(2, 8)}`;
let seedSocket: net.Socket | null = null;

test.afterEach(() => {
	seedSocket?.write("QUIT :seeded\r\n");
	seedSocket?.end();
	seedSocket = null;
});

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

async function rows(page: Page): Promise<number[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('#chat-container .msg[data-type="message"] .content'))
			.map((el) => /row (\d+)/.exec((el as HTMLElement).innerText)?.[1])
			.filter((x): x is string => x !== undefined)
			.map(Number)
	);
}

function scrollTo(page: Page, top: number) {
	return page.evaluate((t) => {
		(document.querySelector(".chat") as HTMLElement).scrollTop = t;
	}, top);
}

async function pageOnce(page: Page, prev: number[], label: string): Promise<number[]> {
	await scrollTo(page, 0);
	await expect
		.poll(async () => (await rows(page))[0], {
			timeout: 30_000,
			message: `${label}: no older rows`,
		})
		.toBeLessThan(prev[0]);
	await page.waitForTimeout(800);
	const now = await rows(page);
	expect(now[now.length - 1], `${label}: the newest row changed`).toBe(prev[prev.length - 1]);
	expect(new Set(now).size, `${label}: duplicate rows`).toBe(now.length);

	for (let i = 1; i < now.length; i++) {
		expect(now[i], `${label}: order broken at ${i}`).toBe(now[i - 1] + 1);
	}

	return now;
}

test("a channel trimmed while not shown pages again when shown", async ({page}) => {
	test.setTimeout(240_000);
	await seedHistory();
	const nick = `trim-e2e-${Math.floor(1000 + Math.random() * 9000)}`;
	await page.goto("/");
	await page.waitForSelector("#connect");
	await page.fill("#connect\\:host", host!);
	await page.fill("#connect\\:port", port);

	if (await page.isChecked("#connect input[name=tls]")) {
		await page.uncheck("#connect input[name=tls]");
	}

	await page.fill("#connect\\:nick", nick);
	await page.fill("#connect\\:channels", channel);
	await page.check("#connect input[name=sasl]");
	await page.fill("#connect\\:saslAccount", account);
	await page.fill("#connect\\:saslPassword", password);
	await page.click("#connect form button[type=submit]");
	await page.waitForSelector(`#chat-container[data-current-channel="${channel}"]`, {
		timeout: 60_000,
	});
	await page.waitForSelector("#input:not([disabled])", {timeout: 60_000});
	await expect
		.poll(async () => (await rows(page)).length, {timeout: 30_000})
		.toBeGreaterThanOrEqual(40);

	// Two pages back: well over the 100 the UI keeps for a hidden channel.
	let shown = await rows(page);
	shown = await pageOnce(page, shown, "page 1");
	shown = await pageOnce(page, shown, "page 2");
	expect(shown.length).toBeGreaterThan(200);

	// Away (any other window trims the channel to 100) and back.
	const here = await page.evaluate(() => location.hash);
	await page.evaluate(() => {
		location.hash = "#/help";
	});
	await page.waitForSelector("#help", {timeout: 10_000});
	await page.evaluate((hash) => {
		location.hash = hash;
	}, here);
	await page.waitForSelector(`#chat-container[data-current-channel="${channel}"]`, {
		timeout: 10_000,
	});
	await page.waitForTimeout(500);
	// 100 messages kept, a couple of them the JOIN and names lines.
	const trimmed = await rows(page);
	expect(trimmed.length, "the UI keeps 100 of a channel it left").toBeLessThanOrEqual(100);
	expect(trimmed.length).toBeLessThan(shown.length);

	// The rows the UI dropped must come back on the next scroll-up, and
	// paging must go on past them.
	let again = await pageOnce(page, trimmed, "after the trim");
	again = await pageOnce(page, again, "past the trim");
	expect(again[0]).toBeLessThan(shown[0]);
});
