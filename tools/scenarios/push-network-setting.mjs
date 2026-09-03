// Per-network push settings verification:
//
//   corepack yarn build && python3 -m http.server -d public 8100 &
//   node tools/browser-drive.mjs tools/scenarios/push-network-setting.mjs
//
// Push notification settings live in the network settings (some servers can
// push, others cannot — the networks are independent).  Checks, in a real
// browser against the testnet ircd (SASL + draft/webpush):
//   1. Edit network renders a checked "Push notifications for this network"
//      box by default (entries without the flag read as enabled);
//   2. unchecking + saving persists pushEnabled: false into
//      thelounge.networks and the Settings per-network row flips to "Off";
//   3. re-checking and saving flips it back (and the row reads Subscribed
//      once a fake subscription for the server's VAPID key is planted).

const IRCD = "ws://127.0.0.1:8067/";

export const url =
	`http://127.0.0.1:8100/?host=127.0.0.1&port=8067&tls=false` +
	`&nick=puinet&join=%23seance&sasl=plain&saslAccount=testaccount&saslPassword=mypassword` +
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

export default async function run(page) {
	let before = page.wsFrames.length;
	await page.goto(page.url);
	await page.waitFor(`!!document.querySelector("#chat")`, {
		label: "the chat to render",
		timeout: 60000,
	});
	await waitRegistered(page, before);

	// Keep the connect-time prompt out of the way for the rest of the run.
	await page.evaluate(`localStorage.setItem("thelounge.push.neverAsk", "1")`);

	// The uuid of the network the URL parameters just created/saved.
	const uuid = await page.evaluate(
		`JSON.parse(localStorage.getItem("thelounge.networks"))[0].uuid`
	);

	// The server's VAPID key, off the CAP LS line (for the fake subscription).
	const vapid = (() => {
		for (const f of page.wsFrames) {
			const m = frameText(f).match(/draft\/webpush=vapid=([A-Za-z0-9_-]+)/);

			if (m) {
				return m[1];
			}
		}

		return undefined;
	})();

	page.check("the server announced a VAPID key in CAP LS", Boolean(vapid));

	// --- 1. the edit form renders a checked push box by default -----------
	await page.goto(`http://127.0.0.1:8100/#/edit-network/${uuid}`);
	await page.waitFor(`!!document.querySelector('input[name="pushEnabled"]')`, {
		label: "the push checkbox to render in Edit network",
		timeout: 60000,
	});

	const boxState = await page.evaluate(
		`(() => {
			const box = document.querySelector('input[name="pushEnabled"]');
			const r = box.getBoundingClientRect();

			return JSON.stringify({checked: box.checked, visible: r.width > 0});
		})()`
	);
	page.check(
		"Edit network defaults the push checkbox to checked",
		boxState === JSON.stringify({checked: true, visible: true})
	);
	await page.screenshot("1-edit-network-checked");

	// --- 2. uncheck + save → stored flag false, settings row says Off ----
	await page.evaluate(`document.querySelector('input[name="pushEnabled"]').click()`);
	await page.evaluate(`document.querySelector('button[type="submit"]').click()`);
	await page.waitFor(`!JSON.parse(localStorage.getItem("thelounge.networks"))[0].pushEnabled`, {
		label: "pushEnabled to persist as false",
	});

	// The settings screen reads the same flag for its per-network row.
	await page.evaluate(`location.hash = "#/settings/notifications"`);
	await page.waitFor(
		`[...document.querySelectorAll(".push-network-state")].some((el) =>
			el.textContent.includes("Off (disabled"))`,
		{label: "the network row to flip to Off"}
	);
	page.check("disabling a network persists and shows in Settings", true);
	await page.screenshot("2-settings-row-off");

	// --- 3. re-enable; with a fake subscription the row reads Subscribed --
	await page.evaluate(`location.hash = "#/edit-network/${uuid}"`);
	await page.waitFor(`!!document.querySelector('input[name="pushEnabled"]')`, {
		label: "the push checkbox again",
	});
	await page.evaluate(`document.querySelector('input[name="pushEnabled"]').click()`);
	await page.evaluate(`document.querySelector('button[type="submit"]').click()`);
	await page.waitFor(
		`JSON.parse(localStorage.getItem("thelounge.networks"))[0].pushEnabled === true`,
		{label: "pushEnabled to persist as true again"}
	);

	// A subscription made against the server's VAPID key (headless Chromium
	// cannot make a real one — fake the material, the page only keys off it).
	// Reload so the app re-reads localStorage into its subscription map.
	await page.evaluate(
		`localStorage.setItem("thelounge.push", JSON.stringify({
			"${vapid}": {
				endpoint: "https://fcm.googleapis.com/fcm/send/fake",
				keys: {p256dh: "B".repeat(88), auth: "A".repeat(22)},
			},
		}))`
	);
	await page.goto(page.url);
	const reloadMark = page.wsFrames.length;
	await page.waitFor(`!!document.querySelector("#chat")`, {
		label: "the chat to render after reload",
		timeout: 60000,
	});
	await waitRegistered(page, reloadMark);
	await page.evaluate(`location.hash = "#/settings/notifications"`);
	await page.waitFor(
		`[...document.querySelectorAll(".push-network-state")].some((el) =>
			el.textContent.trim() === "Subscribed")`,
		{label: "the network row to flip to Subscribed"}
	);
	page.check("re-enabling a network re-arms its push row", true);
	await page.screenshot("3-settings-row-subscribed");

	// Leave the profile clean.
	await page.evaluate(`localStorage.removeItem("thelounge.push")`);
	await page.evaluate(`localStorage.removeItem("thelounge.push.neverAsk")`);
}
