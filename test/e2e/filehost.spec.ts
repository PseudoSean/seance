/**
 * FILEHOST in a real browser against a real ircd and a real upload host
 * (client/js/upload.ts `uploadFilehost`, client/js/irc/authtoken.ts).
 *
 * The network advertises `draft/FILEHOST`; the browser asks the ircd for a
 * token (`TOKEN GENERATE FILEHOST #chan`), POSTs the file with it as a
 * bearer token, and the returned Location lands in the composer.
 *
 * Needs SEANCE_E2E_IRC_HOST/PORT for a PLAIN WebSocket port (the client
 * refuses an `http:` upload host over `wss:`, as the draft requires, and the
 * testnet's paste container speaks http), SEANCE_E2E_SASL_ACCOUNT/PASSWORD
 * (TOKEN GENERATE needs an account), and the ircd's `draft/FILEHOST` URL
 * reachable from the test runner.
 */

import {expect, test} from "@playwright/test";

const host = process.env.SEANCE_E2E_IRC_HOST;
const port = process.env.SEANCE_E2E_IRC_PORT ?? "8067";
const account = process.env.SEANCE_E2E_SASL_ACCOUNT ?? "";
const password = process.env.SEANCE_E2E_SASL_PASSWORD ?? "";

test.skip(
	!host || !account,
	"set SEANCE_E2E_IRC_HOST (plain ws port) and SEANCE_E2E_SASL_ACCOUNT/PASSWORD"
);

const channel = `#e2efh-${Math.random().toString(36).slice(2, 8)}`;
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64"
);

test("a file dropped on a network with draft/FILEHOST goes up with an authtoken and its URL lands in the composer", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const sent: string[] = [];
	let welcomed = "";
	page.on("websocket", (ws) => {
		ws.on("framesent", (f) => sent.push(String(f.payload)));
		ws.on("framereceived", (f) => {
			// The nick we end up with: a SASL login may revive a held bouncer
			// session and keep its nick (helpers do the same in the testnet).
			const m = /^(?:@\S+ )?:\S+ 001 (\S+) /.exec(String(f.payload));
			if (m) welcomed = m[1];
		});
	});

	// The connect form, plain ws, SASL PLAIN.
	const nick = `fh-e2e-${Math.floor(1000 + Math.random() * 9000)}`;
	await page.goto("/");
	await page.waitForSelector("#connect");
	await page.fill("#connect\\:host", host!);
	await page.fill("#connect\\:port", port);

	if (await page.isChecked("#connect input[name=tls]")) {
		await page.uncheck("#connect input[name=tls]");
	}

	await page.fill("#connect\\:nick", nick);
	await page.fill("#connect\\:channels", channel);
	await page.check("#connect input[name=sasl]"); // "I have a services account (SASL)"
	await page.fill("#connect\\:saslAccount", account);
	await page.fill("#connect\\:saslPassword", password);
	await page.click("#connect form button[type=submit]");
	await page.waitForSelector(`#chat-container[data-current-channel="${channel}"]`, {
		timeout: 60_000,
	});
	await expect.poll(() => welcomed, {timeout: 30_000}).not.toBe("");
	await page.waitForSelector(`#chat-container .userlist .user[data-name="${welcomed}"]`, {
		timeout: 60_000,
	});
	await page.waitForSelector("#input");

	// The paperclip shows for this network without any config.json uploads entry.
	await expect(page.locator("#upload")).toBeVisible({timeout: 10_000});

	// Drop a PNG: preview dialog, confirm, TOKEN GENERATE, POST, URL in the composer.
	const before = sent.length;
	await page.setInputFiles("#upload-input", {
		name: "dot.png",
		mimeType: "image/png",
		buffer: PNG,
	});
	await page.click("#upload-preview-confirm", {timeout: 10_000});
	await expect
		.poll(() => sent.slice(before).find((l) => /^TOKEN GENERATE FILEHOST /.test(l)) ?? "", {
			timeout: 15_000,
		})
		.toBe(`TOKEN GENERATE FILEHOST ${channel}`);
	await expect
		.poll(() => page.inputValue("#input"), {timeout: 20_000})
		.toMatch(/https?:\/\/\S+\/filehost\/[A-Za-z0-9]+\.png/);
	const url = (await page.inputValue("#input")).trim();
	const got = await fetch(url);
	expect(got.status).toBe(200);
	expect(got.headers.get("content-type")).toBe("image/png");

	// A text file becomes a paste; its raw URL lands too.
	await page.fill("#input", "");
	const before2 = sent.length;
	await page.setInputFiles("#upload-input", {
		name: "note.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("hello from seance\n"),
	});
	await page.click("#upload-preview-confirm", {timeout: 10_000});
	await expect
		.poll(() => sent.slice(before2).filter((l) => /^TOKEN GENERATE FILEHOST /.test(l)).length, {
			timeout: 15_000,
		})
		.toBe(1);
	await expect
		.poll(() => page.inputValue("#input"), {timeout: 20_000})
		.toMatch(/https?:\/\/\S+\/(raw\/|paste\.php)/);
	const text = await (await fetch((await page.inputValue("#input")).trim())).text();
	expect(text).toContain("hello from seance");
});
