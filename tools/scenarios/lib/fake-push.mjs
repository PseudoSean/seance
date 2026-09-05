// Chrome's Push API, minus the push service, for headless scenarios
// (`page.addInitScript(FAKE_PUSH_API)`): one subscription PER SERVICE-WORKER
// REGISTRATION, bound to the applicationServerKey it was created with, and
// `subscribe()` with a different key throws the InvalidStateError a VAPID
// rotation runs into until the old one is unsubscribed. State lives in
// localStorage (`__fakePush:<scope>`) so it survives reloads like a real
// subscription would; endpoints are numbered from one shared counter
// (`https://push.invalid/fake/e<n>`), so a run re-registers the same few
// and can be cleaned up. Keys are base64url, as the wire wants them.

export const FAKE_ENDPOINT = (slot) => `https://push.invalid/fake/e${slot}`;

/** The localStorage key of a registration's fake subscription. */
export const fakeKeyFor = (scope) => `__fakePush:${scope}`;

export const FAKE_PUSH_API = `(() => {
	const load = (scope) => { try { return JSON.parse(localStorage.getItem("__fakePush:" + scope) || "null"); } catch { return null; } };
	const save = (scope, s) => { if (s) { localStorage.setItem("__fakePush:" + scope, JSON.stringify(s)); } else { localStorage.removeItem("__fakePush:" + scope); } };
	const toB64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
	const fromB64url = (s) => { const std = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(std + "=".repeat((4 - (std.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
	const keyBytes = (k) => k instanceof ArrayBuffer ? new Uint8Array(k) : ArrayBuffer.isView(k) ? new Uint8Array(k.buffer, k.byteOffset, k.byteLength) : fromB64url(String(k));
	const fakeKey = (len, seed) => { const b = new Uint8Array(len); b[0] = 4; for (let i = 1; i < len; i++) { b[i] = (seed * 31 + i * 7) & 0xff; } return b; };
	const makeSub = (scope, state) => ({
		endpoint: state.endpoint,
		options: {userVisibleOnly: true, applicationServerKey: fromB64url(state.key).buffer},
		toJSON() { return {endpoint: state.endpoint, keys: {p256dh: state.p256dh, auth: state.auth}}; },
		unsubscribe: async () => { save(scope, null); return true; },
	});
	const managerFor = (scope) => ({
		getSubscription: async () => { const s = load(scope); return s ? makeSub(scope, s) : null; },
		subscribe: async (opts) => {
			const wanted = keyBytes(opts.applicationServerKey);
			const cur = load(scope);
			if (cur) {
				const have = fromB64url(cur.key);
				const same = have.length === wanted.length && have.every((b, i) => b === wanted[i]);
				if (!same) {
					throw new DOMException("Registration failed - A subscription with a different applicationServerKey (or gcm_sender_id) already exists; to change the applicationServerKey, unsubscribe then resubscribe.", "InvalidStateError");
				}
				return makeSub(scope, cur);
			}
			const slot = Number(localStorage.getItem("__fakePush.slot") || "0") + 1;
			localStorage.setItem("__fakePush.slot", String(slot));
			const state = {
				endpoint: "https://push.invalid/fake/e" + slot,
				key: toB64url(wanted),
				p256dh: toB64url(fakeKey(65, slot)),
				auth: toB64url(fakeKey(16, slot + 100)),
			};
			save(scope, state);
			return makeSub(scope, state);
		},
	});
	Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {get() { return managerFor(this.scope); }, configurable: true});
})();`;

const frameText = (f) => (typeof f.payloadData === "string" ? f.payloadData : "");

/** Poll `page.wsFrames` (from index `since`) for a frame in `dir` matching `re`. */
export async function waitFrame(page, since, dir, re, what, timeoutMs = 20000) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (page.wsFrames.slice(since).some((f) => f.dir === dir && re.test(frameText(f)))) {
			return true;
		}

		await page.sleep(100);
	}

	throw new Error(`timed out waiting for ${what}`);
}

/** Outgoing WEBPUSH lines since index `since`. */
export const webpushOut = (page, since) =>
	page.wsFrames
		.slice(since)
		.filter((f) => f.dir === "out" && frameText(f).startsWith("WEBPUSH "))
		.map(frameText);

/** The server's VAPID key, off the first CAP LS seen. */
export function announcedVapid(page) {
	for (const f of page.wsFrames) {
		const m = frameText(f).match(/draft\/webpush=vapid=([A-Za-z0-9_-]+)/);

		if (m) {
			return m[1];
		}
	}

	return undefined;
}

/** Write one setting the way the app persists them (localStorage `settings`). */
export const setSetting = (page, name, value) =>
	page.evaluate(`(() => {
		const all = JSON.parse(localStorage.getItem("settings") || "{}");
		all[${JSON.stringify(name)}] = ${JSON.stringify(value)};
		localStorage.setItem("settings", JSON.stringify(all));
		return true;
	})()`);

export const getSetting = (page, name) =>
	page.evaluate(`JSON.parse(localStorage.getItem("settings") || "{}")[${JSON.stringify(name)}]`);

/** The stored per-network entries (`thelounge.push`). */
export const storedSubs = (page) =>
	page.evaluate(`JSON.parse(localStorage.getItem("thelounge.push") || "{}")`);

/** The scopes of every service-worker registration on the origin. */
export const registrationScopes = (page) =>
	page.evaluate(
		`navigator.serviceWorker.getRegistrations().then((rs) => rs.map((r) => r.scope))`
	);

/** A network's push-only registration scope. */
export const pushScope = (origin, uuid) => `${origin}/push/${encodeURIComponent(uuid)}/`;

/** The server rotated its key for one network: that network's entry and the
 * browser's subscription for its registration both stay bound to a key no
 * server announces. */
export async function rotateAway(page, origin, uuid, tag) {
	await page.evaluate(`(() => {
		const oldKey = ("BOLD" + ${JSON.stringify(
			tag
		)} + "A".repeat(90)).slice(0, 88); // valid base64url length
		const subs = JSON.parse(localStorage.getItem("thelounge.push") || "{}");
		if (!subs[${JSON.stringify(uuid)}]) { throw new Error("no entry for the network"); }
		subs[${JSON.stringify(uuid)}].vapid = oldKey;
		localStorage.setItem("thelounge.push", JSON.stringify(subs));
		const key = "__fakePush:" + ${JSON.stringify(pushScope(origin, uuid))};
		const fake = JSON.parse(localStorage.getItem(key));
		if (!fake) { throw new Error("no fake subscription for the network's registration"); }
		fake.key = oldKey;
		localStorage.setItem(key, JSON.stringify(fake));
		return true;
	})()`);
}
