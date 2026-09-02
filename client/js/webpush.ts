/**
 * Web Push subscriptions (IRCv3 `draft/webpush`, phase 1).
 *
 * docs/projects/push-subscription.md is the plan; `notifications.md` the
 * larger picture (delivery — the service-worker `push` handler — is phase 2).
 *
 * One browser `PushSubscription` exists per distinct VAPID key (the endpoint
 * is owned by the service-worker registration and bound to the
 * `applicationServerKey` it was created with). Every connected network whose
 * server advertises the same VAPID key gets the subscription registered with
 * it:
 *
 *   `webpush:available` (per network, at registration)  ──►  re-REGISTER stored subs
 *   Settings toggle ──► PushManager.subscribe()          ──►  `webpush:register`
 *   `webpush:state` (server echo / FAIL WEBPUSH)         ──►  state updates
 *
 * Re-sending an identical REGISTER on every connect is the draft's renewal
 * mechanism, so nothing else schedules refreshes. The subscription material
 * persists in `thelounge.push` keyed by VAPID key.
 */

import socket from "./socket";
import {store} from "./store";
import storage from "./localStorage";

/** A browser push subscription, reduced to what the ircd needs. */
interface PushMaterial {
	endpoint: string;
	keys: {p256dh: string; auth: string};
}

const STORAGE_KEY = "thelounge.push";

/** Per-network VAPID keys as announced by `webpush:available`. */
const servers = new Map<string, string | undefined>();
/** Persisted subscriptions by VAPID key. */
let subs = loadSubs();

function loadSubs(): Record<string, PushMaterial> {
	try {
		const raw = storage.get(STORAGE_KEY);

		return raw ? (JSON.parse(raw) as Record<string, PushMaterial>) : {};
	} catch {
		return {};
	}
}

function saveSubs(): void {
	storage.set(STORAGE_KEY, JSON.stringify(subs));
}

function setState(state: string): void {
	store.commit("pushNotificationState", state);
}

/** The browser half of Web Push: Push API + service worker + secure context. */
function browserSupported(): boolean {
	return (
		typeof window !== "undefined" &&
		"PushManager" in window &&
		"serviceWorker" in navigator &&
		window.isSecureContext
	);
}

/** iOS/iPadOS only expose the Push API to installed Home-Screen web apps. */
function needsInstall(): boolean {
	const isIOS =
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.userAgent.includes("Mac") && "ontouchend" in document);

	if (!isIOS) {
		return false;
	}

	return !("PushManager" in window);
}

function permissionDenied(): boolean {
	return typeof Notification !== "undefined" && Notification.permission === "denied";
}

/** Any VAPID key among the connected networks (they are per-ircd; see M7 notes). */
function anyVapid(): string | undefined {
	for (const vapid of servers.values()) {
		if (vapid !== undefined) {
			return vapid;
		}
	}

	return undefined;
}

/** Recompute the coarse state the Settings screen renders. */
function refreshState(): void {
	if (!browserSupported()) {
		setState(needsInstall() ? "not-installed" : "unsupported");
		return;
	}

	if (permissionDenied()) {
		setState("denied");
		return;
	}

	if (anyVapid() === undefined) {
		// No connected network advertises draft/webpush (or none is connected
		// yet) — the server half is what phase 1 cannot do without.
		setState("server-unsupported");
		return;
	}

	if (Object.keys(subs).length > 0) {
		setState("subscribed");
		return;
	}

	setState("unsubscribed");
}

/** Re-register a stored subscription with one freshly connected network. */
function autoRegister(network: string, vapid: string | undefined): void {
	if (vapid === undefined) {
		return;
	}

	const sub = subs[vapid];

	if (sub) {
		socket.emit("webpush:register", {network, endpoint: sub.endpoint, keys: sub.keys});
	}
}

socket.on("webpush:available", ({network, vapid}) => {
	servers.set(network, vapid);
	autoRegister(network, vapid);
	refreshState();
});

socket.on("webpush:state", ({network, action, endpoint, ok, code, reason}) => {
	if (ok) {
		refreshState();
		return;
	}

	// The server refused the subscription. ACCOUNT_REQUIRED is nefarious2's
	// non-spec code for "log in first"; MAX_REGISTRATIONS is spec but not yet
	// sent by the server. The state text is the user-facing report.
	store.commit("pushNotificationState", "blocked");
	// eslint-disable-next-line no-console
	console.warn(
		`[webpush] ${action} of ${endpoint} on ${network} failed (${code}): ${
			reason ?? "no reason given"
		}`
	);
});

/** URL-safe base64 (no padding) → the bytes PushManager expects. */
function urlB64ToUint8Array(b64: string): Uint8Array {
	const padding = "=".repeat((4 - (b64.length % 4)) % 4);
	const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = window.atob(base64);
	const out = new Uint8Array(raw.length);

	for (let i = 0; i < raw.length; i++) {
		out[i] = raw.charCodeAt(i);
	}

	return out;
}

async function pushSubscription(vapid: string): Promise<PushMaterial> {
	const registration = await navigator.serviceWorker.ready;
	const sub = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlB64ToUint8Array(vapid),
	});
	const json = sub.toJSON() as PushSubscriptionJSON & {
		keys?: {p256dh?: string; auth?: string};
	};
	const p256dh = json.keys?.p256dh;
	const auth = json.keys?.auth;

	if (!json.endpoint || !p256dh || !auth) {
		throw new Error("push subscription is missing endpoint or keys");
	}

	return {endpoint: json.endpoint, keys: {p256dh, auth}};
}

/**
 * Subscribe this device: ask permission (must be a user gesture), create the
 * browser subscription against the server's VAPID key, persist it, and
 * register it with every connected network advertising that key.
 */
async function subscribe(): Promise<void> {
	if (!browserSupported()) {
		refreshState();
		return;
	}

	try {
		const permission = await Notification.requestPermission();

		if (permission !== "granted") {
			setState("denied");
			return;
		}

		const vapid = anyVapid();

		if (vapid === undefined) {
			// No connected network can push (cap not negotiated or no key).
			setState("server-unsupported");
			return;
		}

		const material = await pushSubscription(vapid);
		subs = {[vapid]: material};
		saveSubs();

		for (const [network, serverVapid] of servers) {
			if (serverVapid === vapid) {
				socket.emit("webpush:register", {
					network,
					endpoint: material.endpoint,
					keys: material.keys,
				});
			}
		}

		setState("subscribed");
	} catch (error) {
		setState("blocked");
		// eslint-disable-next-line no-console
		console.warn("[webpush] subscription failed", error);
	}
}

/** Unsubscribe: drop the browser subscription and tell every network. */
async function unsubscribe(): Promise<void> {
	try {
		const registration = await navigator.serviceWorker.ready;
		const existing = await registration.pushManager.getSubscription();

		if (existing) {
			await existing.unsubscribe();
		}

		for (const [network, vapid] of servers) {
			const sub = vapid !== undefined ? subs[vapid] : undefined;

			if (sub) {
				socket.emit("webpush:unregister", {network, endpoint: sub.endpoint});
			}
		}

		subs = {};
		saveSubs();
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("[webpush] unsubscription failed", error);
	} finally {
		refreshState();
	}
}

/** The Settings toggle: subscribe when unsubscribed, unsubscribe otherwise. */
async function togglePushSubscription(): Promise<void> {
	if (store.state.pushNotificationState === "subscribed") {
		await unsubscribe();
	} else {
		await subscribe();
	}
}

// Boot: replace the stub's "unsupported" with what this browser can do.
// Servers announce themselves (and re-register stored subscriptions) via
// `webpush:available` as they connect.
refreshState();

export default {togglePushSubscription, subscribe, unsubscribe, refresh: refreshState};
