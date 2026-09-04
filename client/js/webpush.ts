import {reactive} from "vue";

import socket from "./socket";
import {store} from "./store";
import storage from "./localStorage";
import {idbGet, idbSet} from "./idb";
import * as saved from "./irc/saved-networks";
import type {SavedNetwork} from "./irc/saved-networks";

/**
 * Web Push subscriptions (IRCv3 `draft/webpush`, phases 1+2).
 *
 * docs/projects/push-subscription.md is the plan; `notifications.md` the
 * bigger picture. One browser `PushSubscription` per distinct VAPID key (the
 * endpoint is owned by the service-worker registration and bound to the
 * `applicationServerKey` it was created with). Every connected network whose
 * server advertises the same VAPID key gets the subscription registered with
 * it:
 *
 *   `webpush:available` (per network, at registration)  ──►  re-REGISTER stored subs
 *   Settings toggle ──► PushManager.subscribe()          ──►  `webpush:register`
 *   `webpush:state` (server echo / FAIL WEBPUSH)         ──►  state updates
 *
 * Re-sending an identical REGISTER on every connect is the draft's renewal
 * mechanism, so nothing else schedules refreshes; `pushsubscriptionchange`
 * (and the SW) self-heal expired subscriptions. The subscription material
 * persists in `thelounge.push` keyed by VAPID key; the SW's own working copy
 * (VAPID + credentials for throwaway IRC connections used by quick-reply,
 * mute and renewal) lives in IndexedDB `seance-push` and is only written
 * when the user enabled push AND remembering the password.
 */

/** A browser push subscription, reduced to what the ircd needs. */
interface PushMaterial {
	endpoint: string;
	keys: {p256dh: string; auth: string};
}

const STORAGE_KEY = "thelounge.push";

/** Device-local "never ask again" answer for the connect-time subscribe
 * prompt (thelounge.* key convention; deliberately not in `thelounge.push`
 * so the subscription map keeps its shape). */
const NEVER_ASK_KEY = "thelounge.push.neverAsk";

/** The connect-time "enable push notifications?" prompt (yes/no/never).
 * Rendered by components/PushPrompt.vue; state lives here because the
 * decision needs this module's servers/subscriptions view. */
const pushPrompt = reactive({visible: false});

/** Per-network VAPID keys as announced by `webpush:available`. Reactive so
 * the Settings screen's per-network rows re-render when a network connects. */
const servers = reactive(new Map<string, string | undefined>());

/** Persisted subscriptions by VAPID key. Reactive for the same reason; kept
 * one object identity, replaced in place via {@link replaceSubs}. */
const subs = reactive<Record<string, PushMaterial>>(loadSubs());

function replaceSubs(next: Record<string, PushMaterial>): void {
	for (const key of Object.keys(subs)) {
		delete subs[key];
	}

	Object.assign(subs, next);
	saveSubs();
}

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
/** Guards the silent re-subscribe after a server VAPID rotation, so a
 * burst of webpush:available events (several networks, a reconnect) can
 * only mint one replacement subscription. */
let rotationInProgress = false;

function anyVapid(): string | undefined {
	for (const vapid of servers.values()) {
		if (vapid !== undefined) {
			return vapid;
		}
	}

	return undefined;
}

/** Whether a network takes part in Web Push: its saved `pushEnabled` flag
 * (Settings live per network — some servers can push, others cannot). */
function pushOn(uuid: string): boolean {
	return saved.pushEnabledOf(saved.get(uuid));
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

	// A stored subscription means "subscribed": it survives reloads and
	// disconnects (the server keeps it until the device unregisters, and the
	// worker renews it). This must win over the current-connection checks so
	// the Settings page doesn't flip to unsubscribed on every reload.
	if (Object.keys(subs).length > 0) {
		setState("subscribed");
		return;
	}

	if (anyVapid() === undefined) {
		// No connected network advertises draft/webpush (or none is connected
		// yet) — the server half is what phase 1 cannot do without.
		setState("server-unsupported");
		return;
	}

	setState("unsubscribed");
}

/** Re-register a stored subscription with one freshly connected network.
 *
 * Also self-heals server-side VAPID rotation: if subscriptions exist but
 * none was made against the key this network now announces, the old
 * subscription is dead (FCM binds an endpoint to the VAPID key that
 * created it), so silently mint a fresh one and register that instead —
 * no user gesture needed, permission already granted. */
function autoRegister(network: string, vapid: string | undefined): void {
	if (vapid === undefined || !pushOn(network)) {
		return;
	}

	const sub = subs[vapid];

	if (sub) {
		socket.emit("webpush:register", {network, endpoint: sub.endpoint, keys: sub.keys});
		void writeStash(); // every connect: the worker's copy of the networks stays current
		return;
	}

	if (
		Object.keys(subs).length > 0 &&
		Notification.permission === "granted" &&
		!rotationInProgress
	) {
		const net = saved.get(network);

		if (!net || !net.saslAccount) {
			return; // re-registering requires an account; leave it to subscribe()
		}

		rotationInProgress = true;

		void (async () => {
			try {
				const material = await pushSubscription(vapid);

				replaceSubs({[vapid]: material});
				await writeStash();
				socket.emit("webpush:register", {
					network,
					endpoint: material.endpoint,
					keys: material.keys,
				});
				socket.emit("webpush:metadata", {
					network,
					key: "draft/webpush/payload",
					value: "full",
				});
				refreshState();
			} catch (error) {
				// eslint-disable-next-line no-console
				console.warn("[webpush] renewal after VAPID rotation failed", error);
			} finally {
				rotationInProgress = false;
			}
		})();
	}
}

socket.on("webpush:available", ({network, vapid, sasl}) => {
	servers.set(network, vapid);
	autoRegister(network, vapid);
	refreshState();
	maybePrompt(network, vapid, sasl);
});

/** Offer the subscribe prompt once per connection that logged in with SASL
 * on a push-capable network: the server can push only for accounts, so an
 * anonymous connect has nothing to offer. Skipped when this browser cannot
 * subscribe, permission is already denied, a subscription exists, or the
 * user answered "never" on this device. */
/** A subscribe() run is in flight (the auto-subscribe path can be
 * triggered by several networks at once). */
let subscribing = false;

function maybePrompt(network: string, vapid: string | undefined, sasl: boolean): void {
	if (!sasl || vapid === undefined || !pushOn(network) || pushPrompt.visible) {
		return;
	}

	if (!browserSupported() || needsInstall() || permissionDenied()) {
		return;
	}

	if (Object.keys(subs).length > 0) {
		return; // already subscribed; autoRegister re-registers it
	}

	// Permission already granted: the network's push option is the user's
	// choice, so subscribe directly instead of asking again. "default"
	// (never asked) needs a user gesture, which the prompt's buttons
	// provide; "never ask again" suppresses that prompt on this device.
	if (
		typeof Notification !== "undefined" &&
		Notification.permission === "granted" &&
		!subscribing
	) {
		void subscribe();
		return;
	}

	if (storage.get(NEVER_ASK_KEY)) {
		return;
	}

	pushPrompt.visible = true;
}

/** Prompt answer: subscribe (the click is the permission user gesture). */
function acceptPrompt(): void {
	pushPrompt.visible = false;
	void subscribe();
}

/** Prompt answer: not now — asked again on the next connect. */
function declinePrompt(): void {
	pushPrompt.visible = false;
}

/** Prompt answer: never ask again on this device. */
function neverPrompt(): void {
	storage.set(NEVER_ASK_KEY, "1");
	pushPrompt.visible = false;
}

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
	if (subscribing) {
		return;
	}

	subscribing = true;

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

		// Client-side enforcement of the account requirement (the server
		// refuses REGISTER without one anyway): at least one connected
		// push-capable network must have a SASL account configured.
		const pushCapable = [...servers.entries()].filter(
			([uuid, v]) => v !== undefined && pushOn(uuid)
		);
		const withAccount = pushCapable.filter(([uuid]) => {
			const net = saved.get(uuid);

			return Boolean(net && net.saslAccount);
		});

		if (pushCapable.length > 0 && withAccount.length === 0) {
			setState("blocked");
			return;
		}

		const vapid = anyVapid();

		if (vapid === undefined) {
			// No connected network can push (cap not negotiated or no key).
			setState("server-unsupported");
			return;
		}

		const material = await pushSubscription(vapid);
		replaceSubs({[vapid]: material});
		await writeStash();

		for (const [network, serverVapid] of servers) {
			if (serverVapid === vapid && pushOn(network)) {
				socket.emit("webpush:register", {
					network,
					endpoint: material.endpoint,
					keys: material.keys,
				});

				// Push payloads carry the message text (Discord-like); the
				// account's tier metadata controls this server-side.
				socket.emit("webpush:metadata", {
					network,
					key: "draft/webpush/payload",
					value: "full",
				});
			}
		}

		setState("subscribed");
	} catch (error) {
		setState("blocked");
		// eslint-disable-next-line no-console
		console.warn("[webpush] subscription failed", error);
	} finally {
		subscribing = false;
	}
}

/** Stash what the service worker needs: the VAPID key plus, for every
 * push-enabled network that announced a key, its uuid and connection
 * details — that is how the worker deep-links a notification and relays
 * a reply to this page. The SASL password rides along ONLY for networks
 * that remember it (it never hits IndexedDB otherwise); that is what lets
 * the worker send a reply, mute, or renew over its own connection when
 * no page is alive. Rewritten on every connect so a password remembered
 * later, or changed, reaches the worker without re-subscribing. */
async function writeStash(): Promise<void> {
	const vapid = anyVapid() ?? null;
	const networks = saved
		.list()
		.filter((net) => pushOn(net.uuid) && servers.get(net.uuid) !== undefined)
		.map((net) => ({
			uuid: net.uuid,
			host: net.host,
			port: net.port,
			tls: net.tls,
			saslAccount: net.saslAccount,
			saslPassword: net.rememberPassword === true ? net.saslPassword : undefined,
		}));

	try {
		await idbSet("stash", {vapid, networks});
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("[webpush] could not write the service worker stash", error);
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

		replaceSubs({});
		await idbSet("stash", {vapid: null, networks: []});
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

/**
 * Snooze pushes for `ms` (0 = clear the snooze): account-wide, enforced by
 * the ircd's mute gate, so every device stops being woken up. Per-channel
 * mutes ride the same metadata key (see /pushmute).
 */
function setSnooze(ms: number): void {
	const vapid = anyVapid();

	if (vapid === undefined) {
		return;
	}

	const until = ms > 0 ? Math.floor(Date.now() / 1000) + Math.floor(ms / 1000) : 0;

	for (const network of servers.keys()) {
		if (!pushOn(network)) {
			continue;
		}

		socket.emit("webpush:metadata", {
			network,
			key: "draft/webpush/mute",
			value: until > 0 ? `*:${until}` : "",
		});
	}
}

/** React to a saved network whose push flag changed (NetworkEdit form).
 *
 * Off: unregister this device's subscription from that network right away;
 * if no enabled push-capable network remains, the browser subscription
 * itself goes too (nothing would ever deliver through it).
 * On: re-register the stored subscription with the network when it is
 * connected; otherwise the next `webpush:available` re-registers via
 * {@link autoRegister}.
 *
 * Called from NetworkEdit after `network:edit` has saved the entry, with
 * the flag as it was *before* the save. */
/** Per-network browser-notification flag (the editor's checkbox), reactive
 * so sidebar icons re-render on edits; seeded from storage on first read. */
const notifyFlags = reactive(new Map<string, boolean>());

function onNetworkSaved(next: SavedNetwork, wasEnabled: boolean): void {
	notifyFlags.set(next.uuid, saved.notifyEnabledOf(next));
	void writeStash(); // a password (un)remembered, a push flag flipped

	const enabled = next.pushEnabled !== false;

	if (enabled === wasEnabled) {
		return;
	}

	const vapid = servers.get(next.uuid);

	if (!enabled) {
		const sub = vapid !== undefined ? subs[vapid] : undefined;

		if (vapid !== undefined && sub) {
			socket.emit("webpush:unregister", {network: next.uuid, endpoint: sub.endpoint});
		}

		refreshState();
		maybeDropSubscription();
	} else {
		autoRegister(next.uuid, vapid);
		refreshState();
	}
}

/** The subscription exists only to be delivered through some enabled
 * push-capable network; when the last one goes off, drop it entirely. */
function maybeDropSubscription(): void {
	if (Object.keys(subs).length === 0) {
		return;
	}

	for (const [uuid, vapid] of servers) {
		if (vapid !== undefined && pushOn(uuid)) {
			return;
		}
	}

	void unsubscribe();
}

/** One network's push situation, for the Settings screen's per-network
 * list. All inputs are reactive (`servers`, `subs`), so rows re-render. */
function notifyOn(uuid: string): boolean {
	if (!notifyFlags.has(uuid)) {
		notifyFlags.set(uuid, saved.notifyEnabledOf(saved.get(uuid)));
	}

	return Boolean(notifyFlags.get(uuid));
}

function networkPushInfo(uuid: string): {
	enabled: boolean;
	vapid: boolean;
	subscribed: boolean;
} {
	const vapid = servers.get(uuid);

	return {
		enabled: pushOn(uuid),
		vapid: vapid !== undefined,
		subscribed: vapid !== undefined && Boolean(subs[vapid]),
	};
}

// Boot: replace the stub's "unsupported" with what this browser can do.
// Servers announce themselves (and re-register stored subscriptions) via
// `webpush:available` as they connect.
refreshState();

// Opening the app means the user is catching up in-app: drop any push
// notifications the service worker is still showing (badge included).
socket.on("init", async () => {
	if (!browserSupported()) {
		return;
	}

	try {
		const registration = await navigator.serviceWorker.ready;

		for (const n of await registration.getNotifications()) {
			if (n.tag && n.tag.startsWith("push-")) {
				n.close();
			}
		}

		if (navigator.clearAppBadge) {
			void navigator.clearAppBadge();
		}
	} catch {
		// no SW / not ready — nothing to clear
	}
});

/** A reply typed into a notification, as the worker hands it over: by
 * network uuid + target name (the page's channel ids mean nothing to it). */
interface QueuedReply {
	network: string;
	target: string;
	text: string;
	time?: string;
}

const OUTBOX_KEY = "outbox";

/** Send a relayed reply now if that network is connected. */
function sendReplyNow(reply: QueuedReply): boolean {
	const network = store.getters.findNetwork(reply.network);

	if (!network || !network.status.connected) {
		return false;
	}

	socket.emit("send", {network: reply.network, target: reply.target, text: reply.text});

	return true;
}

/** Serialises outbox rewrites so a burst of connects cannot lose a reply. */
let outboxChain: Promise<void> = Promise.resolve();

/** Send what the worker queued for `network` (a reply typed while no page
 * could send it), now that the network is connected. */
function drainOutbox(network: string): void {
	outboxChain = outboxChain
		.then(async () => {
			const queued = (await idbGet<QueuedReply[]>(OUTBOX_KEY)) ?? [];

			if (!Array.isArray(queued) || queued.length === 0) {
				return;
			}

			const rest = queued.filter(
				(reply) => !(reply.network === network && sendReplyNow(reply))
			);

			if (rest.length !== queued.length) {
				await idbSet(OUTBOX_KEY, rest);
			}
		})
		.catch((error) => {
			// eslint-disable-next-line no-console
			console.warn("[webpush] could not drain the reply outbox", error);
		});
}

// A network is up (post-001): anything queued for it can go out now.
socket.on("webpush:available", ({network}) => {
	drainOutbox(network);
});

if (browserSupported() && "serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (!event.data) {
			return;
		}

		// The worker asks the page to redo a subscription it could not renew
		// itself (pushsubscriptionchange without stashed credentials).
		if (event.data.type === "resubscribe") {
			void subscribe();
			return;
		}

		// A reply typed into a notification: send it over this page's own
		// connection and tell the worker whether that worked (it falls back
		// to its own connection, or queues the reply, otherwise).
		if (event.data.type === "reply") {
			const reply = event.data as QueuedReply;
			const port = event.ports[0];
			let ok = false;

			try {
				ok = sendReplyNow(reply);
			} catch (error) {
				// eslint-disable-next-line no-console
				console.warn("[webpush] relayed reply failed", error);
			}

			if (port) {
				port.postMessage({ok});
			}
		}
	});
}

export default {
	togglePushSubscription,
	subscribe,
	unsubscribe,
	setSnooze,
	refresh: refreshState,
	onNetworkSaved,
	networkPushInfo,
	notifyOn,
	pushPrompt,
	acceptPrompt,
	declinePrompt,
	neverPrompt,
};
