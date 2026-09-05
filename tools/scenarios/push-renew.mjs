// VAPID rotation recovery (draft/webpush): the renew prompt, end to end in a
// real browser against the testnet ircd (SASL + draft/webpush).
//
//   npx webpack && python3 -m http.server -d public 8001 &
//   node tools/browser-drive.mjs tools/scenarios/push-renew.mjs [--chrome=…]
//
// Headless Chromium has no push service, so the Push API is faked with an
// init script that behaves like Chrome's: one subscription per service-worker
// registration, bound to the applicationServerKey it was created with, and
// `subscribe()` with a different key throws InvalidStateError until the old
// one is unsubscribed — the exact refusal a server-side VAPID rotation runs
// into. Everything else (service worker, SASL, WEBPUSH on the wire) is real.
//
// Claims under test (docs/projects/push-subscription.md § VAPID rotation):
//   1. with permission granted, a fresh connect subscribes silently and
//      registers with the server under its announced key;
//   2. once the stored subscription matches no announced key, the connect
//      opens the prompt in its `renew` variant instead of renewing silently;
//   3. "No" closes it, Settings reports the stale subscription with a Renew
//      button that recreates the subscription (old endpoint unregistered,
//      new one registered, stored map re-keyed) and the prompt returns on the
//      next connect;
//   4. "Never" sets thelounge.push.neverRenew and no later connect prompts
//      (the subscribe prompt's own never-flag stays untouched);
//   5. "Yes" does what the Renew button does;
//   6. the connect after a renewal re-registers the new endpoint and asks
//      nothing — and both prompt variants name the network (server, account).
// The fake endpoints are fixed per slot so re-runs re-register the same
// three, and the run ends by turning push off for the network so the account
// keeps none of them.

const ORIGIN = "http://127.0.0.1:8001";
const ACCOUNT = "pushtest1";
const PASSWORD = "pushtest1-pass";
const ENDPOINT = (slot) => `https://push.invalid/push-renew/e${slot}`;

export const url =
	`${ORIGIN}/?host=127.0.0.1&port=8067&tls=false` +
	`&nick=pwren&join=%23seance&sasl=plain&saslAccount=${ACCOUNT}&saslPassword=${PASSWORD}` +
	`&autoconnect=1`;

/** Chrome's Push API, minus the push service: the state lives in
 * localStorage (`__fakePush`) so it survives reloads like a real
 * subscription would. Keys are base64url, as the wire wants them. */
const FAKE_PUSH_API = `(() => {
	const STORE = "__fakePush";
	const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch { return null; } };
	const save = (s) => localStorage.setItem(STORE, JSON.stringify(s));
	const toB64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
	const fromB64url = (s) => { const std = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(std + "=".repeat((4 - (std.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
	const keyBytes = (k) => k instanceof ArrayBuffer ? new Uint8Array(k) : ArrayBuffer.isView(k) ? new Uint8Array(k.buffer, k.byteOffset, k.byteLength) : fromB64url(String(k));
	const fakeKey = (len, seed) => { const b = new Uint8Array(len); b[0] = 4; for (let i = 1; i < len; i++) { b[i] = (seed * 31 + i * 7) & 0xff; } return b; };
	const makeSub = (state) => ({
		endpoint: state.endpoint,
		options: {userVisibleOnly: true, applicationServerKey: fromB64url(state.key).buffer},
		toJSON() { return {endpoint: state.endpoint, keys: {p256dh: state.p256dh, auth: state.auth}}; },
		unsubscribe: async () => { save(null); return true; },
	});
	const manager = {
		getSubscription: async () => { const s = load(); return s ? makeSub(s) : null; },
		subscribe: async (opts) => {
			const wanted = keyBytes(opts.applicationServerKey);
			const cur = load();
			if (cur) {
				const have = fromB64url(cur.key);
				const same = have.length === wanted.length && have.every((b, i) => b === wanted[i]);
				if (!same) {
					throw new DOMException("Registration failed - A subscription with a different applicationServerKey (or gcm_sender_id) already exists; to change the applicationServerKey, unsubscribe then resubscribe.", "InvalidStateError");
				}
				return makeSub(cur);
			}
			const slot = Number(localStorage.getItem(STORE + ".slot") || "0") + 1;
			localStorage.setItem(STORE + ".slot", String(slot));
			const state = {
				endpoint: "https://push.invalid/push-renew/e" + slot,
				key: toB64url(wanted),
				p256dh: toB64url(fakeKey(65, slot)),
				auth: toB64url(fakeKey(16, slot + 100)),
			};
			save(state);
			return makeSub(state);
		},
	};
	Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {get() { return manager; }, configurable: true});
})();`;

const frameText = (f) => (typeof f.payloadData === "string" ? f.payloadData : "");
const promptOpened = `document.querySelector("#push-prompt-overlay")?.classList.contains("opened")`;
/** The overlay fades out over 0.2 s and swallows clicks until it is hidden. */
const promptGone = `getComputedStyle(document.querySelector("#push-prompt-overlay")).visibility === "hidden"`;

/** Wait for the *next* registration after `before` (PERSISTENCE SET ON goes
 * out from onRegistered, so seeing one means SASL succeeded). */
async function waitRegistered(page, before) {
	await page.waitFor(`!!document.querySelector("#chat")`, {
		label: "the chat to render",
		timeout: 60000,
	});
	await waitFrame(page, before, "out", /^PERSISTENCE/, "the registration (PERSISTENCE SET)");
}

async function waitFrame(page, since, dir, re, what, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (page.wsFrames.slice(since).some((f) => f.dir === dir && re.test(frameText(f)))) {
			return true;
		}

		await page.sleep(100);
	}

	throw new Error(`timed out waiting for ${what}`);
}

const webpushOut = (page, since) =>
	page.wsFrames
		.slice(since)
		.filter((f) => f.dir === "out" && frameText(f).startsWith("WEBPUSH "))
		.map(frameText);

/** The server rotated its key: the stored subscription and the browser's
 * one both stay bound to a key no connected server announces. */
async function rotateAway(page, tag) {
	await page.evaluate(`(() => {
		const subs = JSON.parse(localStorage.getItem("thelounge.push") || "{}");
		const material = Object.values(subs)[0];
		const oldKey = ("BOLD" + ${JSON.stringify(
			tag
		)} + "A".repeat(90)).slice(0, 88); // valid base64url length
		localStorage.setItem("thelounge.push", JSON.stringify({[oldKey]: material}));
		const fake = JSON.parse(localStorage.getItem("__fakePush"));
		fake.key = oldKey;
		localStorage.setItem("__fakePush", JSON.stringify(fake));
		return true;
	})()`);
}

/** Load `target`, wait for the registration, and make sure this document
 * sees the notification permission as granted: the CDP grant can lose the
 * race with the app's early connect (re-grant + reload until it sticks —
 * `Notification.requestPermission()` would otherwise hang headless, with
 * no prompt to answer). Returns the frame index the load started at. */
async function connect(page, target) {
	let before = page.wsFrames.length;
	await page.goto(target);
	await waitRegistered(page, before);

	for (let i = 0; i < 3; i++) {
		if (await page.evaluate(`Notification.permission === "granted"`)) {
			return before;
		}

		await page.grantPermissions(["notifications"], ORIGIN);
		before = page.wsFrames.length;
		await page.evaluate(`location.reload()`);
		await waitRegistered(page, before);
	}

	throw new Error("the page never saw the notification permission as granted");
}

const storedSubs = (page) =>
	page.evaluate(`JSON.parse(localStorage.getItem("thelounge.push") || "{}")`);

export default async function run(page) {
	await page.grantPermissions(["notifications"], ORIGIN);
	await page.addInitScript(FAKE_PUSH_API);

	// --- 1. fresh profile, permission granted: silent subscribe ------------
	let before = await connect(page, page.url);

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

	await waitFrame(
		page,
		before,
		"out",
		new RegExp(`^WEBPUSH REGISTER ${ENDPOINT(1)} `),
		"the first WEBPUSH REGISTER"
	);
	await waitFrame(
		page,
		before,
		"in",
		new RegExp(`WEBPUSH REGISTER ${ENDPOINT(1)}`),
		"the server's WEBPUSH REGISTER echo"
	);
	page.check(
		"1. permission granted: subscribed without a prompt",
		(await page.evaluate(`!(${promptOpened})`)) === true
	);
	let subs = await storedSubs(page);
	page.check(
		"1. the stored subscription is keyed by the server's key",
		Object.keys(subs).length === 1 && subs[vapid]?.endpoint === ENDPOINT(1)
	);
	await page.screenshot("1-subscribed");

	// Later passes reload the plain origin: the saved entry autoconnects
	// with its remembered password instead of the URL minting a network.
	await page.evaluate(`(() => {
		const all = JSON.parse(localStorage.getItem("thelounge.networks"));
		Object.assign(all[0], {autoconnect: true, rememberPassword: true, saslPassword: ${JSON.stringify(
			PASSWORD
		)}});
		localStorage.setItem("thelounge.networks", JSON.stringify(all));
		return all.length;
	})()`);
	const uuid = await page.evaluate(
		`JSON.parse(localStorage.getItem("thelounge.networks"))[0].uuid`
	);

	// --- 2. the server rotated its key: the renew prompt ------------------
	await rotateAway(page, "one");
	before = await connect(page, `${ORIGIN}/`);
	await page.waitFor(promptOpened, {label: "the prompt after a key rotation"});
	page.check(
		"2. the prompt is the renew variant",
		(await page.evaluate(
			`document.querySelector("#push-prompt")?.classList.contains("renew")`
		)) === true
	);
	page.check(
		"2. the title says renew",
		String(
			await page.evaluate(
				`document.querySelector("#push-prompt .confirm-text-title")?.textContent`
			)
		).includes("Renew")
	);
	page.check("2. nothing was renewed on its own", webpushOut(page, before).length === 0);
	const label = String(
		await page.evaluate(
			`document.querySelector("#push-prompt .push-prompt-target")?.textContent`
		)
	);
	page.check(
		"2. the prompt names the network's server and account",
		label.includes("127.0.0.1:8067") && label.includes(ACCOUNT)
	);
	await page.screenshot("2-renew-prompt");

	// --- 3. "No": closed, Settings says stale, Renew there works ------------
	await page.click("#pushPromptNo");
	await page.waitFor(promptGone, {label: "the prompt to close on No"});
	page.check("3. No sends nothing", webpushOut(page, before).length === 0);

	await page.evaluate(`location.hash = "#/settings/notifications"`);
	await page.waitFor(`!!document.querySelector("#pushStale")`, {
		label: "the stale warning in Settings",
	});
	page.check(
		"3. Settings hides the snooze row while stale",
		(await page.count(".push-snooze")) === 0
	);
	await page.screenshot("3-settings-stale");

	page.check(
		"3. the service worker is registered in this document",
		(await page.evaluate(`navigator.serviceWorker.getRegistration().then((r) => !!r)`)) === true
	);
	page.check(
		"3. permission is granted before Renew",
		(await page.evaluate(`Notification.permission`)) === "granted"
	);
	page.check(
		"3. the Renew button is what a click at its centre hits",
		(await page.evaluate(`(() => {
			const r = document.querySelector("#pushRenew").getBoundingClientRect();
			const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
			return Boolean(el && el.closest("#pushRenew"));
		})()`)) === true
	);
	let mark = page.wsFrames.length;
	await page.click("#pushRenew");
	await waitFrame(
		page,
		mark,
		"out",
		new RegExp(`^WEBPUSH UNREGISTER ${ENDPOINT(1)}$`),
		"the old endpoint's UNREGISTER (Renew button)"
	);
	await waitFrame(
		page,
		mark,
		"out",
		new RegExp(`^WEBPUSH REGISTER ${ENDPOINT(2)} `),
		"the new endpoint's REGISTER (Renew button)"
	);
	await waitFrame(
		page,
		mark,
		"in",
		new RegExp(`WEBPUSH REGISTER ${ENDPOINT(2)}`),
		"the server's echo for the renewed endpoint"
	);
	subs = await storedSubs(page);
	page.check(
		"3. Renew re-keyed the stored subscription to the server's key",
		Object.keys(subs).length === 1 && subs[vapid]?.endpoint === ENDPOINT(2)
	);
	await page.waitFor(`!!document.querySelector(".push-snooze")`, {
		label: "Settings back to subscribed",
	});
	page.check("3. the stale warning is gone", (await page.count("#pushStale")) === 0);
	await page.screenshot("4-settings-renewed");

	await rotateAway(page, "two");
	before = await connect(page, `${ORIGIN}/`);
	await page.waitFor(promptOpened, {label: "the prompt again after No"});
	page.check("3. No: asked again on the next connect", true);

	// --- 4. "Never": flag set, no prompt on later connects ------------------
	await page.click("#pushPromptNever");
	await page.waitFor(`localStorage.getItem("thelounge.push.neverRenew") === "1"`, {
		label: "the never-renew flag",
	});
	page.check(
		"4. Never leaves the subscribe prompt's own flag alone",
		(await page.evaluate(`localStorage.getItem("thelounge.push.neverAsk")`)) === null
	);

	before = await connect(page, `${ORIGIN}/`);
	await page.sleep(2000);
	page.check(
		"4. Never: no prompt on the next connect",
		(await page.evaluate(`!(${promptOpened})`)) === true
	);
	page.check("4. Never: nothing renewed on its own", webpushOut(page, before).length === 0);
	await page.screenshot("5-never-no-prompt");

	// --- 5. "Yes" -------------------------------------------------------------
	await page.evaluate(`localStorage.removeItem("thelounge.push.neverRenew")`);
	before = await connect(page, `${ORIGIN}/`);
	await page.waitFor(promptOpened, {label: "the prompt once the flag is cleared"});
	mark = page.wsFrames.length;
	await page.click("#pushPromptYes");
	await waitFrame(
		page,
		mark,
		"out",
		new RegExp(`^WEBPUSH UNREGISTER ${ENDPOINT(2)}$`),
		"the old endpoint's UNREGISTER (Yes)"
	);
	await waitFrame(
		page,
		mark,
		"out",
		new RegExp(`^WEBPUSH REGISTER ${ENDPOINT(3)} `),
		"the new endpoint's REGISTER (Yes)"
	);
	await waitFrame(
		page,
		mark,
		"in",
		new RegExp(`WEBPUSH REGISTER ${ENDPOINT(3)}`),
		"the server's echo (Yes)"
	);
	await page.waitFor(promptGone, {label: "the prompt to close on Yes"});
	subs = await storedSubs(page);
	page.check(
		"5. Yes re-keyed the stored subscription to the server's key",
		Object.keys(subs).length === 1 && subs[vapid]?.endpoint === ENDPOINT(3)
	);
	page.check(
		"5. the browser subscription was recreated under the server's key",
		(await page.evaluate(`JSON.parse(localStorage.getItem("__fakePush")).key`)) === vapid
	);
	await page.screenshot("6-renewed-by-yes");

	// --- 6. the next connect after Yes is quiet: the renewed subscription
	// matches the announced key, so it is re-registered and nobody is asked.
	before = await connect(page, `${ORIGIN}/`);
	await waitFrame(
		page,
		before,
		"out",
		new RegExp(`^WEBPUSH REGISTER ${ENDPOINT(3)} `),
		"the renewed endpoint's re-REGISTER on the next connect"
	);
	await page.sleep(1500);
	page.check(
		"6. no prompt on the connect after Yes",
		(await page.evaluate(`!(${promptOpened})`)) === true
	);
	page.check(
		"6. the stored subscription still matches the server's key",
		Object.keys(await storedSubs(page)).join() === vapid
	);

	// --- cleanup: push off for the network → the account forgets e3 ---------
	mark = page.wsFrames.length;
	await page.evaluate(`location.hash = "#/edit-network/${uuid}"`);
	await page.waitFor(`!!document.querySelector('input[name="pushEnabled"]')`, {
		label: "the push checkbox in Edit network",
	});
	// The form is longer than the viewport: bring each control on screen
	// before the real click (a click outside the viewport hits nothing).
	for (const selector of ['input[name="pushEnabled"]', 'button[type="submit"]']) {
		await page.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block: "center"})`
		);
		await page.click(selector);
	}
	await waitFrame(
		page,
		mark,
		"out",
		new RegExp(`^WEBPUSH UNREGISTER ${ENDPOINT(3)}$`),
		"the cleanup UNREGISTER"
	);
	page.check("cleanup: the run's endpoint was unregistered", true);

	page.check("no console errors", page.consoleErrors.length === 0);
}
