// UI cleanup verification for the push-notification settings work:
//
//   corepack yarn build && python3 -m http.server -d public 8100 &
//   node tools/browser-drive.mjs tools/scenarios/ui-cleanup.mjs
//
// Checks, in a real browser against the testnet ircd (SASL + draft/webpush):
//   1. the connect-time "enable push notifications?" prompt appears once the
//      SASL'd registration completes on a push-capable network;
//   2. "No" closes it and it asks again on the next connect;
//   3. "Never" closes it and it stays closed across reloads (device-local);
//   4. the Settings → Notifications screen no longer renders the Session
//      panel (list / Refresh / Force logout are gone);
//   5. the snooze buttons sit in their own block with margins between the
//      buttons (a fake subscription is planted in localStorage to reach the
//      subscribed state — headless Chromium has no FCM to make a real one).

const IRCD = "ws://127.0.0.1:8067/";

export const url =
	`http://127.0.0.1:8100/?host=127.0.0.1&port=8067&tls=false` +
	`&nick=puiclean&join=%23seance&sasl=plain&saslAccount=testaccount&saslPassword=mypassword` +
	`&autoconnect=1`;

const frameText = (f) => (typeof f.payloadData === "string" ? f.payloadData : "");

/** Wait for the *next* registration after `before` (PERSISTENCE SET ON goes
 * out from onRegistered, so seeing one means SASL succeeded and the server
 * burst is done). */
async function waitRegistered(page, before) {
	await page.waitFor(`!!document.querySelector("#chat")`, {label: "the chat to render"});

	const deadline = Date.now() + 20000;

	while (Date.now() < deadline) {
		if (page.wsFrames.slice(before).some((f) => frameText(f).startsWith("PERSISTENCE"))) {
			return;
		}

		await page.sleep(100);
	}

	throw new Error("timed out waiting for the registration (PERSISTENCE SET)");
}

const promptOpened = `document.querySelector("#push-prompt-overlay")?.classList.contains("opened")`;

const openSettings = `(() => {
	const el = document.querySelector("#pushState");

	if (el) {
		const r = el.getBoundingClientRect();

		if (r.width > 0 && r.height > 0) {
			return true;
		}
	}

	location.hash = "#/settings/notifications";
	return false;
})()`;

export default async function run(page) {
	// --- pass 1: fresh profile, prompt appears, "No" closes it ------------
	let before = page.wsFrames.length;
	await page.goto(page.url, {waitForSelector: "#chat"});
	await waitRegistered(page, before);

	await page.waitFor(promptOpened, {label: "the push subscribe prompt to open"});
	await page.screenshot("1-prompt");
	page.check("prompt appears on a SASL'd connect to a webpush server", true);

	await page.click("#pushPromptNo");
	await page.waitFor(`!(${promptOpened})`, {label: "the prompt to close after No"});
	page.check("'No' closes the prompt", true);

	// --- pass 2: reload → "No" means it asks again -------------------------
	before = page.wsFrames.length;
	await page.goto(page.url, {waitForSelector: "#chat"});
	await waitRegistered(page, before);
	await page.waitFor(promptOpened, {label: "the prompt to ask again after 'No'"});
	page.check("'No' is not sticky: the prompt asks again on the next connect", true);

	await page.click("#pushPromptNever");
	await page.waitFor(`!(${promptOpened})`, {label: "the prompt to close after Never"});
	page.check("'Never' closes the prompt", true);

	// --- pass 3: reload → "Never" is sticky --------------------------------
	before = page.wsFrames.length;
	await page.goto(page.url, {waitForSelector: "#chat"});
	await waitRegistered(page, before);
	await page.sleep(1500); // give any (wrongly) shown prompt its moment
	await page.waitFor(`!(${promptOpened})`, {label: "the prompt to stay closed"});
	page.check("'Never' is sticky: no prompt after reload", true);

	// --- session panel removal --------------------------------------------
	await page.waitFor(openSettings, {label: "the settings window"});
	const sessionBits = await page.evaluate(
		`JSON.stringify({
			forceLogout: !!document.querySelector("#forceLogout"),
			refresh: !!document.querySelector("#refreshSessions"),
			list: !!document.querySelector("#sessionList"),
			empty: !!document.querySelector("#sessionEmpty"),
		})`
	);
	page.check(
		"the Session panel (list / Refresh / Force logout) is gone",
		sessionBits ===
			JSON.stringify({forceLogout: false, refresh: false, list: false, empty: false})
	);
	await page.screenshot("2-settings-unsubscribed");

	// --- snooze block with margins (fake subscription → subscribed) -------
	await page.evaluate(
		`localStorage.setItem("thelounge.push", JSON.stringify({
			"fake-vapid-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef": {
				endpoint: "https://fcm.googleapis.com/fcm/send/fake",
				keys: {p256dh: "B".repeat(88), auth: "A".repeat(22)},
			},
		}))`
	);
	before = page.wsFrames.length;
	await page.goto(page.url, {waitForSelector: "#chat"});
	await waitRegistered(page, before);
	await page.waitFor(`!(${promptOpened})`, {label: "no prompt while subscribed"});
	await page.waitFor(openSettings, {label: "the settings window again"});

	await page.waitFor(`!!document.querySelector(".push-networks")`, {
		label: "the per-network push list to render",
	});
	await page.waitFor(`!!document.querySelector(".push-snooze")`, {
		label: "the snooze row to render",
	});

	// The global toggle is gone; the network list is the only push switch.
	const netRows = await page.evaluate(
		`(() => {
			const rows = [...document.querySelectorAll(".push-network")];

			return JSON.stringify({
				count: rows.length,
				toggle: !!document.querySelector("#pushNotifications"),
				states: rows.map((r) => r.querySelector(".push-network-state")?.textContent),
			});
		})()`
	);
	page.check(
		"push settings are per-network rows with no global toggle",
		(() => {
			const parsed = JSON.parse(netRows);

			return (
				parsed.toggle === false && parsed.count > 0 && parsed.states.length === parsed.count
			);
		})()
	);

	const spacing = await page.evaluate(
		`(() => {
			const row = document.querySelector(".push-snooze");
			const btns = row ? [...row.querySelectorAll("button")] : [];
			const second = btns[1];

			return JSON.stringify({
				count: btns.length,
				block: row ? getComputedStyle(row).display !== "inline" : false,
				gap: second ? getComputedStyle(second).marginLeft : "none",
			});
		})()`
	);
	page.check(
		"snooze buttons render as their own block with margins between them",
		spacing === JSON.stringify({count: 4, block: true, gap: "8px"})
	);
	await page.screenshot("3-settings-subscribed");

	// Leave the profile clean of the fake subscription.
	await page.evaluate(`localStorage.removeItem("thelounge.push")`);
}
