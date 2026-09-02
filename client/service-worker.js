// @ts-nocheck
// Seance service worker (derived from The Lounge - https://github.com/thelounge/thelounge)
/* global clients */
"use strict";

// Seance is a static single-page app: everything under the registration scope
// is a build artifact (index.html, js/, css/, themes/, img/, ...). IRC traffic
// goes over WebSocket straight to the ircd and is never routed through here —
// service workers do not receive fetch events for WebSocket handshakes, and the
// same-origin/http(s) guards below make sure nothing else is intercepted either.
//
// Strategy: network-first with a cache fallback for the static bundle, plus a
// precached copy of the app shell (index.html) so that navigations still
// resolve when the host is unreachable and the PWA can open offline.
//
// Web Push (draft/webpush): the server sends one raw IRC line per push
// (no CRLF). The handler below is deliberately the smallest thing that
// renders one — phase-2 slice 0, per docs/projects/push-subscription.md;
// parsed messages, grouping and MARKREAD dedupe are planned in
// notifications.md. In-page `Notification` requests are still routed through
// this worker (see the "message" handler) so that clicks on them focus or
// reopen the app.

const cacheName = "__HASH__";
const isDevBuild = cacheName === "dev";

// The app shell is cached under the scope URL because, with hash-based
// routing, every navigation request resolves to the scope root.
const shellUrl = self.registration.scope;

// Everything a cold start needs, so that an installed app opens offline
// straight after the first visit (rather than only after a second load has
// filled the runtime cache). Versioned assets use the same `?v=` query as
// index.html so the keys match the requests. Other themes, sounds and icons
// are cached on first use.
const shellPaths = [
	"",
	"index.html",
	"manifest.webmanifest",
	"config.json",
	"favicon.ico",
	`js/loading-error-handlers.js?v=${cacheName}`,
	`js/bundle.vendor.js?v=${cacheName}`,
	`js/bundle.js?v=${cacheName}`,
	`css/style.css?v=${cacheName}`,
	"themes/default.css",
	"fonts/fa-solid-900.woff2",
	"img/logo-tile.png",
];

// Paths that must never be served from cache (Cloudflare challenge endpoints).
const excludedPathsFromCache = /^cdn-cgi\//;

self.addEventListener("install", function (event) {
	event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", function (event) {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names.filter((name) => name !== cacheName).map((name) => caches.delete(name))
				)
			)
	);

	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
	if (event.request.method !== "GET") {
		return;
	}

	const url = event.request.url;

	// Only ever touch http(s) requests inside our own scope. Cross-origin
	// requests (link previews, external images, ...) and anything that is not
	// a plain http(s) URL are left entirely to the browser.
	if (!/^https?:/i.test(url) || !url.startsWith(shellUrl)) {
		return;
	}

	const path = url.substring(shellUrl.length);

	if (excludedPathsFromCache.test(path)) {
		return;
	}

	event.respondWith(networkOrCache(event));
});

async function precacheShell() {
	if (isDevBuild) {
		return;
	}

	try {
		const cache = await caches.open(cacheName);

		await Promise.all(
			shellPaths.map(async (path) => {
				const response = await fetch(new URL(path, shellUrl).href, {
					cache: "no-cache",
					redirect: "follow",
				});

				if (response.ok) {
					await cache.put(cacheKeyFor(path), response);
				}
			})
		);
	} catch (e) {
		// A failed precache must not prevent the worker from installing; the
		// runtime cache will fill in on the first successful online load.
		// eslint-disable-next-line no-console
		console.warn("Failed to precache app shell:", e.message);
	}
}

function cacheKeyFor(path) {
	// index.html is the same document as the scope root; store it once.
	return path === "index.html" ? shellUrl : new URL(path, shellUrl).href;
}

function isNavigation(request) {
	return request.mode === "navigate" || request.destination === "document";
}

async function putInCache(request, response) {
	const cache = await caches.open(cacheName);
	await cache.put(request, response);
}

async function cleanRedirect(response) {
	// Not all browsers support the Response.body stream, so fall back
	// to reading the entire body into memory as a blob.
	const bodyPromise = "body" in response ? Promise.resolve(response.body) : response.blob();

	const body = await bodyPromise;

	// new Response() is happy when passed either a stream or a Blob.
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}

async function networkOrCache(event) {
	const request = event.request;
	const navigation = isNavigation(request);

	try {
		let response = await fetch(request, {
			cache: "no-cache",
			redirect: "follow",
		});

		if (response.redirected) {
			response = await cleanRedirect(response.clone());
		}

		if (response.ok) {
			if (!isDevBuild) {
				// Navigations are stored under the shell key so that offline
				// opens of "/", "/index.html" and "/?anything" all find it.
				event.waitUntil(putInCache(navigation ? shellUrl : request, response.clone()));
			}

			return response;
		}

		throw new Error(`Request failed with HTTP ${response.status}`);
	} catch (e) {
		const cache = await caches.open(cacheName);
		let matching = await cache.match(request, {ignoreSearch: navigation});

		if (!matching && navigation) {
			matching = await cache.match(shellUrl);
		}

		if (matching) {
			return matching;
		}

		// eslint-disable-next-line no-console
		console.error(e.message, request.url);

		if (event.clientId) {
			const client = await clients.get(event.clientId);

			if (client) {
				client.postMessage({
					type: "fetch-error",
					message: e.message,
				});
			}
		}

		return Response.error();
	}
}

// Notifications requested by the page. Routing them through the worker (rather
// than `new Notification()` in the page) is what makes them work on Android and
// lets "notificationclick" below reopen the app when the tab is gone.
self.addEventListener("message", function (event) {
	if (!event.data || event.data.type !== "notification") {
		return;
	}

	showPageNotification(event, event.data);
});

/** Page-requested notification (in-app notify path): tag/replace per channel. */
function showPageNotification(event, payload) {
	event.waitUntil(
		self.registration
			.getNotifications({tag: `chan-${payload.chanId}`})
			.then((notifications) => {
				for (const notification of notifications) {
					notification.close();
				}

				return self.registration.showNotification(payload.title, {
					tag: `chan-${payload.chanId}`,
					icon: "img/icon-192.png",
					body: payload.body,
					timestamp: payload.timestamp,
				});
			})
	);
}

// --- Web Push (draft/webpush) ----------------------------------------------
// The ircd pushes one notification per event; nefarious2's payload is tiered
// JSON (account metadata `draft/webpush/payload`): `{"t":"msg","from":…,
// "target":…,"msgid":…,"time":…}` (+`"text"` on the full tier), and reads
// arrive as `{"t":"read","target":…,"ts":…}` so this worker can close
// notifications that another device has already read. The draft spec's raw
// IRC line shape is handled as a fallback.
//
// Discord-style behaviour layered on top:
//   - per-target merging with an unread count (tag `push-<target>`),
//   - app badge = total unread across push notifications,
//   - actions: Reply (inline text on desktop Chrome) and Mute 1h — both act
//     through a short-lived IRC connection the worker opens itself
//     (credentials come from the page via IndexedDB, only stashed when the
//     user enabled push AND password remembering),
//   - `pushsubscriptionchange` re-subscribes with the stashed VAPID key and
//     re-registers, so expiry self-heals.

const IDB_NAME = "seance-push";
const IDB_STORE = "kv";

function idbOpen() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function idbGet(key) {
	const db = await idbOpen();

	return new Promise((resolve, reject) => {
		const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function idbSet(key, value) {
	const db = await idbOpen();

	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readwrite");
		tx.objectStore(IDB_STORE).put(value, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Run one batch of actions over a throwaway IRC connection (SASL PLAIN).
 * `pre` lines go out after SASL completes but before CAP END (that is the
 * only window `WEBPUSH REGISTER` accepts), `post` lines after 001.
 * Resolves true when every pre/post line was sent.
 */
function swIrcAct(net, pre, post) {
	return new Promise((resolve) => {
		const scheme = net.tls ? "wss://" : "ws://";
		const url = scheme + net.host + ":" + net.port + "/";
		let ws = null;

		const done = (ok) => {
			try {
				ws.close();
			} catch (e) {
				//
			}

			resolve(ok);
		};

		const timer = setTimeout(() => done(false), 10000);

		ws = new WebSocket(url, "text.ircv3.net");

		ws.onopen = () => {
			ws.send("CAP LS 302");
			ws.send("NICK seance-sw");
			ws.send("USER seance-sw 0 * :seance service worker");
		};

		ws.onmessage = (e) => {
			const l = e.data;

			if (l.startsWith("PING")) {
				ws.send("PONG " + l.slice(5));
				return;
			}

			if (/^AUTHENTICATE \+$/.test(l)) {
				ws.send("AUTHENTICATE " + btoa("\0" + net.saslAccount + "\0" + net.saslPassword));
				return;
			}

			if (l.startsWith("FAIL") || / 90[2-8] /.test(l)) {
				clearTimeout(timer);
				done(false);
				return;
			}

			if (/ 903 /.test(l) && pre.length > 0) {
				for (const line of pre) {
					ws.send(line);
				}

				ws.send("CAP END");
				return;
			}

			if (/ 903 /.test(l) && pre.length === 0) {
				ws.send("CAP END");
				return;
			}

			if (/ 001 /.test(l) && post.length > 0) {
				for (const line of post) {
					ws.send(line);
				}

				ws.send("QUIT :done");
				clearTimeout(timer);
				return;
			}

			if (/ 001 /.test(l)) {
				ws.send("QUIT :done");
				clearTimeout(timer);
			}
		};

		ws.onclose = () => {
			clearTimeout(timer);
			resolve(true);
		};

		ws.onerror = () => {
			clearTimeout(timer);
			resolve(false);
		};
	});
}

/** The stash the page writes when push is enabled: our VAPID key and the
 * networks that are push-capable AND remember their SASL password. */
async function getStash() {
	const stash = (await idbGet("stash")) || {};

	return {
		vapid: stash.vapid || null,
		networks: Array.isArray(stash.networks) ? stash.networks : [],
	};
}

/** Total unread across push notifications -> app badge. */
async function updateBadge() {
	const all = await self.registration.getNotifications();
	const total = all.reduce((sum, n) => sum + ((n.data && n.data.count) || 1), 0);

	if (total > 0 && self.navigator.setAppBadge) {
		self.navigator.setAppBadge(total);
	} else if (self.navigator.clearAppBadge) {
		self.navigator.clearAppBadge();
	}
}

self.addEventListener("push", function (event) {
	const raw = event.data ? event.data.text() : "";
	self.__pushDiag = event.data
		? "len" + raw.length + " tail" + raw.charCodeAt(raw.length - 1)
		: "nodata";

	event.waitUntil(handlePush(raw));
});

async function handlePush(raw) {
	let json = null;

	// RFC 8188 says the decrypter strips the aes128gcm padding delimiter
	// (a trailing 0x02) before the payload reaches the SW; if a browser
	// ever delivers it unstripped, JSON.parse would throw and the push
	// would degrade to the generic fallback. Trim trailing control bytes
	// before parsing so the payload is always clean.
	const clean = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+$/, "");

	try {
		json = JSON.parse(clean);
	} catch (e) {
		// not JSON — spec-shape raw IRC line
	}

	// Another device read a channel: close what we show for it.
	if (json && json.t === "read") {
		await closeForTarget(json.target, json.ts);
		await updateBadge();
		return;
	}

	const parsed = json
		? {from: json.from, target: json.target, text: json.text, time: json.time, kind: json.t}
		: parsePushLine(clean);

	if (
		parsed &&
		(parsed.kind === "msg" ||
			parsed.kind === "notice" ||
			parsed.command === "PRIVMSG" ||
			parsed.command === "NOTICE")
	) {
		const isChannel = parsed.target && parsed.target.startsWith("#");
		const replyTo = isChannel ? parsed.target : parsed.from;
		const tag = "push-" + (replyTo || "activity");
		const text =
			typeof parsed.text === "string"
				? parsed.text.replace(/\x01ACTION /, "*").replace(/\x01$/, "*")
				: "New message";

		// Merge per target: newest body, rising unread count.
		const existing = await self.registration.getNotifications({tag});
		const count = ((existing[0] && existing[0].data && existing[0].data.count) || 0) + 1;

		for (const n of existing) {
			n.close();
		}

		const title = isChannel
			? parsed.from + " in " + parsed.target + (count > 1 ? " (" + count + ")" : "")
			: parsed.from + (count > 1 ? " (" + count + ")" : "");

		// Inline reply is desktop-only: Chrome for Android rejects
		// type:"text" actions outright, which would sink the whole
		// notification after FCM already delivered it. Buttons only there.
		const isAndroid = /Android/.test(self.navigator.userAgent);
		const actions = isAndroid
			? [{action: "mute1h", title: "Mute 1h"}]
			: [
					{
						action: "reply",
						type: "text",
						title: "Reply",
						placeholder: "Reply…",
					},
					{action: "mute1h", title: "Mute 1h"},
			  ];

		await showSafely(title, {
			tag,
			icon: "img/icon-192.png",
			body: text,
			timestamp: parsed.time ? Date.parse(parsed.time) : undefined,
			data: {
				kind: "push",
				count,
				from: parsed.from,
				target: replyTo,
				time: parsed.time,
			},
			actions,
		});

		await updateBadge();
		return;
	}

	// userVisibleOnly means every push should surface something.
	await showSafely("Seance", {
		tag: "push-activity",
		icon: "img/icon-192.png",
		body: "New activity while you were away. [dbg:" + (self.__pushDiag || "?") + "]",
	});

	await updateBadge();
}

/** showNotification that cannot silently fail: if Chrome rejects any
 * option (an unsupported action, a bad icon), retry with the body only,
 * then bare.  A delivered push that renders nothing is the worst outcome
 * there is, so every path here ends in a visible notification. */
async function showSafely(title, options) {
	try {
		await self.registration.showNotification(title, options);
		return;
	} catch (e) {
		// fall through to the reduced forms
	}

	try {
		await self.registration.showNotification(title, {
			tag: options.tag,
			body: options.body,
		});
		return;
	} catch (e) {
		// fall through to the bare form
	}

	try {
		await self.registration.showNotification(title, {});
	} catch (e) {
		// nothing else to try
	}
}

/** Close push notifications for `target` whose message predates `ts`. */
async function closeForTarget(target, ts) {
	const cutoff = ts ? Date.parse(ts) : Infinity;
	const all = await self.registration.getNotifications();

	for (const n of all) {
		if (!n.tag || !n.tag.startsWith("push-")) {
			continue;
		}

		const sameTarget = n.data && n.data.target === target;
		const mine = !target && n.tag.startsWith("push-");

		if (
			(sameTarget || (mine && !target)) &&
			(!cutoff || !n.data.time || Date.parse(n.data.time) <= cutoff)
		) {
			n.close();
		}
	}
}

/** Enough of an IRC line for a notification: `@tags :nick!u@h CMD target :text`. */
function parsePushLine(line) {
	let rest = line;
	const tags = {};

	if (rest.startsWith("@")) {
		const space = rest.indexOf(" ");

		if (space === -1) {
			return null;
		}

		for (const pair of rest.slice(1, space).split(";")) {
			const eq = pair.indexOf("=");

			if (eq !== -1) {
				tags[pair.slice(0, eq)] = pair.slice(eq + 1);
			}
		}

		rest = rest.slice(space + 1);
	}

	if (!rest.startsWith(":")) {
		return null;
	}

	const first = rest.indexOf(" ");
	const nick = rest.slice(1, first).split("!")[0];
	const tail = rest.slice(first + 1);
	const second = tail.indexOf(" ");
	const command = (second === -1 ? tail : tail.slice(0, second)).toUpperCase();
	const params = second === -1 ? "" : tail.slice(second + 1);
	const colon = params.indexOf(" :");
	const target = (colon === -1 ? params : params.slice(0, colon)).split(" ")[0];
	const text = colon === -1 ? "" : params.slice(colon + 2);

	return {tags, nick, command, target, text, time: tags.time};
}

// Renewal: the browser tells us the subscription died (or rotated). Re-create
// it with the stashed VAPID key and re-register over a throwaway IRC
// connection; when credentials are not stashed, ask any open page to redo it
// from the UI instead.
self.addEventListener("pushsubscriptionchange", function (event) {
	event.waitUntil(handleResubscribe(event.oldSubscription, event.newSubscription));
});

async function handleResubscribe(oldSub, newSub) {
	const stash = await getStash();

	if (newSub && stash.vapid) {
		await idbSet("stash", {...stash, vapid: stash.vapid});
	}

	const sub = newSub || (stash.vapid ? await resubscribeWithVapid(stash.vapid) : null);

	if (!sub) {
		// No usable subscription: ask the page (next open) to redo it.
		const cs = await self.clients.matchAll({includeUncontrolled: true, type: "window"});

		for (const c of cs) {
			c.postMessage({type: "resubscribe"});
		}

		return;
	}

	const networks = stash.networks.filter((n) => n.saslAccount);

	if (networks.length === 0) {
		return;
	}

	await swIrcAct(
		networks[0],
		[
			"WEBPUSH REGISTER " +
				sub.endpoint +
				" p256dh=" +
				sub.keys.p256dh +
				";auth=" +
				sub.keys.auth,
		],
		[]
	);
}

async function resubscribeWithVapid(vapid) {
	const reg = self.registration;

	try {
		const key = Uint8Array.from(atob(vapidB64ToStd(vapid)), (c) => c.charCodeAt(0));

		return await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: key.buffer,
		});
	} catch (e) {
		return null;
	}
}

function vapidB64ToStd(b64) {
	const padding = "=".repeat((4 - (b64.length % 4)) % 4);

	return (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
}

/** Quick-reply / mute from the notification: run over a throwaway IRC
 * connection using the stashed credentials. Falls back to false when the
 * user did not enable password remembering (the click then just opens the
 * app). */
async function swAct(net, pre, post) {
	if (!net || !net.saslAccount || !net.saslPassword) {
		return false;
	}

	return swIrcAct(net, pre, post);
}

self.addEventListener("notificationclick", function (event) {
	const data = event.notification.data || {};

	// Inline reply (desktop Chrome): the text comes on event.reply. Send it
	// from the worker over a throwaway IRC connection when credentials are
	// stashed; otherwise just open the app.
	if (event.action === "reply" && event.reply && data.target) {
		event.notification.close();
		event.waitUntil(
			(async () => {
				const stash = await getStash();
				const sent = await swAct(
					stash.networks[0],
					[],
					["PRIVMSG " + data.target + " :" + event.reply]
				);

				if (sent) {
					await closeForTarget(data.target, new Date().toISOString());
					await updateBadge();
				} else {
					await openApp(data.target);
				}
			})()
		);
		return;
	}

	// Mute 1h: suppress pushes for this target via the account mute list
	// (the ircd gates pushes on it). GET-merge-SET so other entries survive.
	if (event.action === "mute1h" && data.target) {
		event.notification.close();
		event.waitUntil(
			(async () => {
				const stash = await getStash();
				const until = Math.floor(Date.now() / 1000) + 3600;
				const sent = await swMute1h(stash.networks[0], data.target, until);

				if (sent) {
					await closeForTarget(data.target, new Date().toISOString());
					await updateBadge();
				} else {
					await openApp();
				}
			})()
		);
		return;
	}

	event.notification.close();

	// Page-created notifications carry a `chan-<id>` tag; push notifications
	// deep-link by target (phase 2 refines msgid routing).
	const route = event.notification.tag.startsWith("chan-")
		? `.#/${event.notification.tag}`
		: shellUrl;

	event.waitUntil(
		clients
			.matchAll({
				includeUncontrolled: true,
				type: "window",
			})
			.then((clientList) => {
				if (clientList.length === 0) {
					if (clients.openWindow) {
						return clients.openWindow(route);
					}

					return;
				}

				const client = findSuitableClient(clientList);

				client.postMessage({
					type: "open",
					channel: event.notification.tag,
				});

				if ("focus" in client) {
					client.focus();
				}
			})
	);
});

async function openApp() {
	const cs = await clients.matchAll({includeUncontrolled: true, type: "window"});

	for (const c of cs) {
		if ("focus" in c) {
			await c.focus();
			return;
		}
	}

	if (clients.openWindow) {
		await clients.openWindow(shellUrl);
	}
}

/** Mute `target` for an hour: GET the account mute list, merge, SET. */
function swMute1h(net, target, until) {
	return new Promise((resolve) => {
		const scheme = net.tls ? "wss://" : "ws://";
		const url = scheme + net.host + ":" + net.port + "/";
		let ws = null;
		let value = null;
		let registered = false;
		const timer = setTimeout(() => {
			try {
				ws.close();
			} catch (e) {
				//
			}

			resolve(false);
		}, 10000);

		ws = new WebSocket(url, "text.ircv3.net");

		ws.onopen = () => {
			ws.send("CAP LS 302");
			ws.send("NICK seance-sw");
			ws.send("USER seance-sw 0 * :seance service worker");
		};

		ws.onmessage = (e) => {
			const l = e.data;

			if (l.startsWith("PING")) {
				ws.send("PONG " + l.slice(5));
				return;
			}

			if (/^AUTHENTICATE \+$/.test(l)) {
				ws.send("AUTHENTICATE " + btoa("\0" + net.saslAccount + "\0" + net.saslPassword));
				return;
			}

			if (/^:[^ ]+ 761 /.test(l)) {
				// RPL_METADATA: <me> <key> <visibility> :<value>
				const parts = l.split(" ");

				if (parts[3] === "draft/webpush/mute") {
					value = l.slice(l.indexOf(" :") + 2);
				}

				return;
			}

			if (/^:[^ ]+ METADATA /.test(l)) {
				// Batched metadata echo: METADATA <key> ... :<value>
				const bits = l.split(" METADATA ")[1] || "";

				if (bits.startsWith("draft/webpush/mute ")) {
					const colon = bits.indexOf(" :");

					if (colon !== -1) {
						value = bits.slice(colon + 2);
					}
				}

				return;
			}

			if (/ 903 /.test(l)) {
				ws.send("CAP END");
				return;
			}

			if (/ 001 /.test(l) && !registered) {
				registered = true;
				ws.send("METADATA * GET draft/webpush/mute");
				return;
			}

			if (registered && (value !== null || / 76[12] /.test(l))) {
				const merged = mergeMuteEntry(value || "", target, until);

				ws.send("METADATA * SET draft/webpush/mute * :" + merged);
				ws.send("QUIT :done");
				clearTimeout(timer);
				setTimeout(() => resolve(true), 200);
			}
		};

		ws.onclose = () => {
			clearTimeout(timer);
			resolve(registered && value !== null);
		};

		ws.onerror = () => {
			clearTimeout(timer);
			resolve(false);
		};
	});
}

/** Merge `target:until` into a semicolon-separated mute value (dropping any
 * previous entry for the target). */
function mergeMuteEntry(value, target, until) {
	const entries = (value || "").split(";").filter((e) => e && !e.startsWith(target + ":"));

	entries.push(target + ":" + until);

	return entries.join(";");
}

function findSuitableClient(clientList) {
	for (let i = 0; i < clientList.length; i++) {
		const client = clientList[i];

		if (client.focused || client.visibilityState === "visible") {
			return client;
		}
	}

	return clientList[0];
}
