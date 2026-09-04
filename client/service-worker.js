// @ts-nocheck
// Seance service worker (derived from The Lounge - https://github.com/thelounge/thelounge)
/* global clients, importScripts */
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

// The push module (client/js/push/*, built to js/push.js): the line parser,
// the strippers and the merged-body renderer, shared with the page so the
// two agree. Loaded at start-up — a service worker may only importScripts
// what it imported while installing. If it fails, push() below falls back
// to the inline minimum (no Markdown stripping).
try {
	importScripts(`js/push.js?v=${cacheName}`);
} catch (e) {
	// push() falls back
}

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
	`js/push.js?v=${cacheName}`,
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

/** Page-requested notification (in-app notify path): tag/replace per channel.
 * The page also names the network (uuid) and the target so a click can
 * still find the conversation after the page — and its session-local
 * channel ids — is gone. */
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
					data: {
						kind: "page",
						network: payload.network,
						target: payload.target,
					},
				});
			})
	);
}

// --- Web Push (draft/webpush) ----------------------------------------------
// The ircd pushes one notification per event; nefarious2's payload is tiered
// JSON (account metadata `draft/webpush/payload`): `"t":"msg"` (a PM),
// `"t":"hl"` (a channel message mentioning the account — `from in #chan`),
// each with `from/target/msgid/time` and `text` on the full tier; reads
// arrive as `{"t":"read","target":…,"ts":…}` so this worker can close
// notifications that another device has already read. The draft spec's raw
// IRC line shape is handled as a fallback.
//
// Discord-style behaviour layered on top:
//   - per-target merging with a rising unread count, a combined body
//     (middle-ellipsised when it overflows; see renderMergedBody) and the
//     recent messages kept in the notification's data (tag `push-<target>`),
//   - app badge = total unread across push notifications,
//   - actions on every platform: Reply (an inline text field where the
//     platform has one; a button that opens the conversation elsewhere)
//     and Mute 30m. A typed reply goes out through an open page when there
//     is one, else over a short-lived IRC connection the worker opens
//     itself (credentials come from the page via IndexedDB, only stashed
//     when the user enabled push AND password remembering), else it is
//     queued in IndexedDB and the app opened on the conversation to send
//     it — never dropped. Mute uses the worker's connection.
//   - clicks deep-link by network + target (`#/net/<uuid>/<target>`), which
//     survives the page and its session-local channel ids,
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

/** How long a throwaway connection may take to reach 001 (or finish). */
const SW_IRC_TIMEOUT_MS = 15000;

/** A throwaway connection's nick. Random on purpose: nefarious2's bouncer
 * holds a QUIT'd account session as a ghost that keeps its nick, so a fixed
 * nick collides with the ghost of the previous reply (433) — and once the
 * connection attaches to the account's session the server renames it to
 * the session's nick anyway. */
function randomNick() {
	return "seance-" + Math.random().toString(36).slice(2, 8);
}

/**
 * Open a throwaway IRC connection (SASL PLAIN) and hand the live socket to
 * `onReady(ws, done, ctx)` at 001.  `pre` lines go out after SASL completes
 * but before CAP END.  `ctx.nick` is what the server calls us after
 * registration (the account's session nick when the bouncer attached us to
 * it); `ctx.onLine(fn)` sees every later line.  Resolves through done(ok):
 * false on any SASL/registration failure, a close, or the timeout.
 */
function swIrcOpen(net, pre, onReady) {
	return new Promise((resolve) => {
		const scheme = net.tls ? "wss://" : "ws://";
		const url = scheme + net.host + ":" + net.port + "/";
		let ws = null;
		let stage = 0; // 0 LS, 1 REQ, 2 AUTHENTICATE PLAIN, 3 payload, 4 CAP END sent, 5 registered
		let nick = randomNick();
		let nickTries = 0;
		let settled = false;
		const watchers = [];
		const ctx = {
			nick,
			onLine(fn) {
				watchers.push(fn);
			},
		};

		const timer = setTimeout(() => done(false), SW_IRC_TIMEOUT_MS);

		function done(ok) {
			if (settled) {
				return;
			}

			settled = true;
			clearTimeout(timer);

			try {
				ws.close();
			} catch (e) {
				//
			}

			resolve(ok);
		}

		try {
			ws = new WebSocket(url, "text.ircv3.net");
		} catch (e) {
			done(false);
			return;
		}

		ws.onopen = () => {
			ws.send("CAP LS 302");
			ws.send("NICK " + nick);
			ws.send("USER seance-sw 0 * :seance service worker");
		};

		ws.onmessage = (e) => {
			const l = e.data;

			if (l.startsWith("PING")) {
				ws.send("PONG " + l.slice(5));
				return;
			}

			if (stage === 5) {
				for (const fn of watchers) {
					fn(l);
				}

				return;
			}

			// Nick taken before registration (433/436/437): try another.
			if (/^\S+ 43[367] /.test(l)) {
				if (++nickTries > 3) {
					done(false);
					return;
				}

				nick = randomNick();
				ctx.nick = nick;
				ws.send("NICK " + nick);
				return;
			}

			// Each branch flips the stage BEFORE sending: a synchronously
			// scripted (or locally proxied) server re-enters this handler
			// from send() before the send returns.
			if (stage === 0 && / CAP .* LS /.test(l)) {
				stage = 1;
				ws.send("CAP REQ :sasl");
				return;
			}

			if (stage === 1 && / CAP .* ACK /.test(l)) {
				stage = 2;
				ws.send("AUTHENTICATE PLAIN");
				return;
			}

			if (stage === 1 && / CAP .* NAK /.test(l)) {
				done(false);
				return;
			}

			if (stage === 2 && /^AUTHENTICATE \+$/.test(l)) {
				stage = 3;
				ws.send("AUTHENTICATE " + btoa("\0" + net.saslAccount + "\0" + net.saslPassword));
				return;
			}

			// SASL failures: 902 and 904-908 (903 success is handled below).
			if (stage === 3 && (l.startsWith("FAIL") || / 90[245678] /.test(l))) {
				done(false);
				return;
			}

			if (stage === 3 && / 903 /.test(l)) {
				stage = 4;

				for (const line of pre) {
					ws.send(line);
				}

				ws.send("CAP END");
				return;
			}

			if (stage === 4 && /^ERROR /.test(l)) {
				done(false);
				return;
			}

			if (stage === 4 && /^\S+ 001 /.test(l)) {
				stage = 5;
				// `:server 001 <nick> :Welcome…` — the bouncer may have renamed us.
				ctx.nick = l.split(" ")[2] || nick;
				onReady(ws, done, ctx);
			}
		};

		ws.onerror = () => done(false);
		ws.onclose = () => done(false);
	});
}

/** Run one batch of lines over a throwaway IRC connection: `pre` before
 * CAP END, `post` after 001.  Resolves true when both were sent. */
function swIrcAct(net, pre, post) {
	return swIrcOpen(net, pre, (ws, done) => {
		for (const line of post) {
			ws.send(line);
		}

		ws.send("QUIT :done");
		done(true);
	});
}

// --- sending a reply over a throwaway connection ---------------------------
// The reply connection logs in as the account, so nefarious2's bouncer
// attaches it to the account's session (as an alias while the app is
// connected elsewhere, resuming a held session otherwise). The session's
// channel memberships are replayed to us right AFTER 001 — a channel
// PRIVMSG fired at 001 races that replay and comes back as 404 — so a
// channel reply waits for our JOIN of the target (or the "Session resumed"
// notice that ends the replay), with a settle timer as the fallback, and a
// 404 earns one retry. A PM has no such race.

const REPLAY_SETTLE_MS = 1500; // channel reply: wait at most this long for the JOIN replay
const REPLY_GRACE_MS = 600; // after sending: time for the server to refuse (404) before QUIT
const REPLY_RETRY_MS = 800;
/** One PRIVMSG line stays under nefarious2's 512-byte body / 528-byte frame
 * limits; the server prepends `:nick!user@host ` on relay. */
const REPLY_CHUNK_BYTES = 380;

function isChannelName(target) {
	return /^[#&!+]/.test(target || "");
}

/** Split reply text into PRIVMSG-sized chunks at word boundaries. */
function splitReply(text) {
	const encoder = new TextEncoder();
	const chunks = [];
	let rest = text.replace(/[\r\n]+/g, " ").trim();

	while (rest.length > 0) {
		if (encoder.encode(rest).length <= REPLY_CHUNK_BYTES) {
			chunks.push(rest);
			break;
		}

		let cut = rest.length;

		while (cut > 0 && encoder.encode(rest.slice(0, cut)).length > REPLY_CHUNK_BYTES) {
			cut--;
		}

		const space = rest.lastIndexOf(" ", cut);

		if (space > cut / 2) {
			cut = space;
		}

		chunks.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}

	return chunks;
}

/** Our own JOIN of `target` (the bouncer's membership replay). */
function isOwnJoin(line, nick, target) {
	const m = /^(?:@\S+ )?:([^! ]+)\S* JOIN :?(\S+)/.exec(line);

	return (
		m !== null &&
		m[1].toLowerCase() === nick.toLowerCase() &&
		m[2].toLowerCase() === target.toLowerCase()
	);
}

/** Send `text` to `target` over a throwaway connection as the account.
 * Resolves true once every chunk went out without a 404. */
function swIrcSend(net, target, text) {
	const chunks = splitReply(text);

	if (chunks.length === 0) {
		return Promise.resolve(false);
	}

	return swIrcOpen(net, [], (ws, done, ctx) => {
		const channel = isChannelName(target);
		let fired = false;
		let retried = false;
		let settle = null;
		let grace = null;

		const finish = (ok) => {
			clearTimeout(settle);
			clearTimeout(grace);

			try {
				ws.send("QUIT :done");
			} catch (e) {
				//
			}

			done(ok);
		};

		const fire = () => {
			if (fired) {
				return;
			}

			fired = true;
			clearTimeout(settle);

			for (const chunk of chunks) {
				ws.send("PRIVMSG " + target + " :" + chunk);
			}

			grace = setTimeout(() => finish(true), REPLY_GRACE_MS);
		};

		ctx.onLine((l) => {
			if (!fired && channel) {
				if (isOwnJoin(l, ctx.nick, target) || / NOTICE \S+ :Session resumed/.test(l)) {
					fire();
				}

				return;
			}

			if (fired && /^\S+ 404 /.test(l)) {
				clearTimeout(grace);

				if (retried) {
					finish(false);
					return;
				}

				retried = true;
				fired = false;
				settle = setTimeout(fire, REPLY_RETRY_MS);
			}
		});

		if (channel) {
			settle = setTimeout(fire, REPLAY_SETTLE_MS);
		} else {
			fire();
		}
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

	event.waitUntil(handlePush(raw));
});

// --- merged-notification body rendering ------------------------------------
// Notifications for one target merge into a single record; Chrome clips
// long bodies, so the renderer keeps how each message starts and ends and
// hides the middle behind an ellipsis — and over the whole-body budget it
// keeps the oldest and newest lines, hiding the middle as `… +N more`.

const MERGE_KEEP = 4; // messages retained in the notification's data
const BODY_BUDGET = 170; // total body characters before middle-dropping
const LINE_HEAD = 48; // per-line middle-ellipsis split
const LINE_TAIL = 18;

/** Middle ellipsis: keep how a long message starts and ends. */
function midEllipsis(s, head = LINE_HEAD, tail = LINE_TAIL) {
	if (s.length <= head + tail + 1) {
		return s;
	}

	return s.slice(0, head) + "…" + s.slice(s.length - tail);
}

/** Render the merged body: one line per message (`from: text` in channels,
 * bare text in DMs), newest last.  Over budget, the middle lines collapse
 * into `… +N more` between the oldest and the newest kept lines. */
function renderMergedBody(messages, isChannel) {
	const lines = messages.map((m) => (isChannel && m.from ? m.from + ": " + m.text : m.text));
	const shown = lines.map((l) => midEllipsis(l));
	let dropped = 0;

	while (shown.length > 2 && shown.join("\n").length > BODY_BUDGET) {
		shown.splice(shown.length - 2, 1);
		dropped++;
	}

	if (dropped > 0) {
		shown.splice(shown.length - 1, 0, "… +" + dropped + " more");
	}

	return shown.join("\n");
}

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

	// Dedup against the page's "seen" ring (client/js/push-seen.ts): a
	// live page that already received this message over its own WebSocket
	// owns its notification — its own rules decide whether the user sees
	// anything. The server pushes to attached-but-idle sessions too
	// (FEAT_WEBPUSH_IDLE), so without this every highlight would notify
	// twice. A frozen page writes nothing, which is exactly when the push
	// must show; the raw-line fallback carries no msgid and never dedups.
	if (json && typeof json.msgid === "string") {
		const seen = await idbGet("seen");

		if (Array.isArray(seen) && seen.includes(json.msgid)) {
			return;
		}
	}

	const parsed = json
		? {from: json.from, target: json.target, text: json.text, time: json.time, kind: json.t}
		: parsePushLine(clean);

	if (
		parsed &&
		(parsed.kind === "msg" ||
			parsed.kind === "notice" ||
			parsed.kind === "hl" ||
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

		// Merge per target: a combined body (newest last) and a rising
		// unread count.  The message list rides on the notification's data
		// so it survives the worker being killed between pushes.
		const existing = await self.registration.getNotifications({tag});
		const prev = existing[0] && existing[0].data;
		const count = ((prev && prev.count) || 0) + 1;
		const messages = [...((prev && prev.messages) || []), {from: parsed.from, text}].slice(
			-MERGE_KEEP
		);
		const body = renderMergedBody(messages, isChannel);

		for (const n of existing) {
			n.close();
		}

		const title = isChannel
			? parsed.from + " in " + parsed.target + (count > 1 ? " (" + count + ")" : "")
			: parsed.from + (count > 1 ? " (" + count + ")" : "");

		// Inline reply renders as a text field where the browser supports
		// it (desktop Chrome) and degrades to a button that deep-links the
		// chat where it does not — the click handler falls back to openApp
		// when no reply text arrives.  showSafely guards the whole call if
		// a browser rejects the actions outright.
		const actions = [
			{action: "reply", type: "text", title: "Reply", placeholder: "Reply…"},
			{action: "mute30", title: "Mute 30m"},
		];

		// The payload names no network; the stash lists the networks this
		// device is push-enrolled with (one, for a single-network deploy).
		const stash = await getStash();
		const network = stash.networks[0] ? stash.networks[0].uuid : undefined;

		await showSafely(title, {
			tag,
			icon: "img/icon-192.png",
			body,
			timestamp: parsed.time ? Date.parse(parsed.time) : undefined,
			data: {
				kind: "push",
				count,
				from: parsed.from,
				target: replyTo,
				network,
				time: parsed.time,
				messages,
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
		body: "New activity while you were away.",
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

	const networks = stash.networks.filter((n) => n.saslAccount && n.saslPassword);

	if (networks.length === 0) {
		return;
	}

	// Drop the endpoint that just rotated away, or the account keeps two
	// registrations for this one device and every push arrives twice.
	const post = [];
	const oldEndpoint = oldSub && oldSub.endpoint;

	if (oldEndpoint && oldEndpoint !== sub.endpoint) {
		post.push("WEBPUSH UNREGISTER " + oldEndpoint);
	}

	post.push(
		"WEBPUSH REGISTER " + sub.endpoint + " p256dh=" + sub.keys.p256dh + ";auth=" + sub.keys.auth
	);

	// After 001: nefarious2 silently drops a WEBPUSH REGISTER sent between
	// SASL and CAP END (docs/projects/push-subscription.md).
	await swIrcAct(networks[0], [], post);
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

/** The stashed network a notification belongs to: by uuid when the
 * notification names one, else the first (single-network deploys). */
function stashNetwork(stash, uuid) {
	return stash.networks.find((n) => uuid && n.uuid === uuid) || stash.networks[0] || null;
}

/** Whether a stashed network can log in on its own (the user remembered
 * the password; the page never stashes one otherwise). */
function canLogin(net) {
	return Boolean(net && net.saslAccount && net.saslPassword);
}

// --- replying from the notification ----------------------------------------
// A typed reply must never be lost. Three ways to send it, tried in order:
//   1. a live page (any window of the app, even a background one) sends it
//      over its own connection and acks through a MessageChannel — the
//      common case when the app is merely backgrounded;
//   2. the worker's own throwaway connection, when the password is stashed;
//   3. the outbox: the reply is queued in IndexedDB and the app is opened on
//      the conversation; the page sends the queue once that network is up.

const PAGE_REPLY_TIMEOUT_MS = 2500; // a frozen page never answers
const OUTBOX_KEY = "outbox";
const OUTBOX_CAP = 20;

/** Ask an open page to send the reply. Resolves true on the first ack. */
async function replyViaPage(reply) {
	const cs = await self.clients.matchAll({includeUncontrolled: true, type: "window"});

	if (cs.length === 0 || typeof MessageChannel !== "function") {
		return false;
	}

	return new Promise((resolve) => {
		let settled = false;
		let outstanding = cs.length;
		let timer = null;
		const ports = [];

		const finish = (ok) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);

				for (const port of ports) {
					port.close();
				}

				resolve(ok);
			}
		};

		timer = setTimeout(() => finish(false), PAGE_REPLY_TIMEOUT_MS);

		for (const c of cs) {
			const channel = new MessageChannel();

			ports.push(channel.port1);

			channel.port1.onmessage = (ev) => {
				if (ev.data && ev.data.ok) {
					finish(true);
				} else if (--outstanding === 0) {
					finish(false);
				}
			};

			try {
				c.postMessage({type: "reply", ...reply}, [channel.port2]);
			} catch (e) {
				if (--outstanding === 0) {
					finish(false);
				}
			}
		}
	});
}

/** Queue a reply for the page to send when its network is next connected. */
async function enqueueOutbox(reply) {
	const prev = await idbGet(OUTBOX_KEY);
	const outbox = Array.isArray(prev) ? prev : [];

	outbox.push(reply);
	await idbSet(OUTBOX_KEY, outbox.slice(-OUTBOX_CAP));
}

async function handleReply(data, text) {
	if (!text || !data.target) {
		await openApp(data);
		return;
	}

	const stash = await getStash();
	const net = stashNetwork(stash, data.network);
	const reply = {
		network: net ? net.uuid : data.network,
		target: data.target,
		text,
		time: new Date().toISOString(),
	};

	if (await replyViaPage(reply)) {
		await replyDone(data);
		return;
	}

	if (canLogin(net) && (await swIrcSend(net, data.target, text))) {
		await replyDone(data);
		return;
	}

	await enqueueOutbox(reply);
	await openApp(data);
}

async function replyDone(data) {
	await closeForTarget(data.target, new Date().toISOString());
	await updateBadge();
}

self.addEventListener("notificationclick", function (event) {
	const data = event.notification.data || {};

	// Reply: an inline text field where the platform has one (event.reply),
	// a plain button elsewhere — that one opens the conversation to type in.
	if (event.action === "reply") {
		event.notification.close();
		event.waitUntil(handleReply(data, String(event.reply || "").trim()));
		return;
	}

	// Mute 30m: suppress pushes for this target via the account mute list
	// (the ircd gates pushes on it). GET-merge-SET so other entries survive.
	if (event.action === "mute30" && data.target) {
		event.notification.close();
		event.waitUntil(
			(async () => {
				const stash = await getStash();
				const until = Math.floor(Date.now() / 1000) + 30 * 60;
				const sent = await swMute(stashNetwork(stash, data.network), data.target, until);

				if (sent) {
					await closeForTarget(data.target, new Date().toISOString());
					await updateBadge();
				} else {
					await openApp(data);
				}
			})()
		);
		return;
	}

	event.notification.close();
	event.waitUntil(openApp(data, event.notification.tag));
});

/** The in-app route for a notification: by network + target when known
 * (survives the page and its session-local ids), else by the page's
 * `chan-<id>` tag, else the app itself. */
function routeFor(data, tag) {
	if (data && data.network && data.target) {
		return `${shellUrl}#/net/${encodeURIComponent(data.network)}/${encodeURIComponent(
			data.target
		)}`;
	}

	if (tag && tag.startsWith("chan-")) {
		return `${shellUrl}#/${tag}`;
	}

	return shellUrl;
}

/** Bring the app to the conversation a notification is about: tell an open
 * page to switch (and focus it), or open a window on the deep link. */
async function openApp(data, tag) {
	const cs = await clients.matchAll({includeUncontrolled: true, type: "window"});

	// Focusing or opening a window needs the user activation a notification
	// click carries; without it (a synthetic call) the browser refuses.
	// Nothing here may throw: a queued reply is already safe in the outbox,
	// and the page that is (or gets) told where to go does the rest.
	if (cs.length === 0) {
		if (clients.openWindow) {
			try {
				await clients.openWindow(routeFor(data, tag));
			} catch (e) {
				// eslint-disable-next-line no-console
				console.warn("[sw] could not open a window", e);
			}
		}

		return;
	}

	const client = findSuitableClient(cs);

	client.postMessage({
		type: "open",
		channel: tag,
		network: data ? data.network : undefined,
		target: data ? data.target : undefined,
	});

	if ("focus" in client) {
		try {
			await client.focus();
		} catch (e) {
			// already told where to go; focus is best effort
		}
	}
}

/** Mute `target` until `until` (epoch seconds): open a throwaway
 * connection, GET the account mute list, merge, SET.  Resolves true when
 * the SET went out. */
function swMute(net, target, until) {
	return swIrcOpen(net, [], (ws, done) => {
		let value = null;

		const timer = setTimeout(() => done(false), 10000);

		const finish = () => {
			clearTimeout(timer);
			ws.send(
				"METADATA * SET draft/webpush/mute * :" + mergeMuteEntry(value ?? "", target, until)
			);
			ws.send("QUIT :done");
			setTimeout(() => done(true), 200);
		};

		ws.onmessage = (e) => {
			const l = e.data;

			if (l.startsWith("PING")) {
				ws.send("PONG " + l.slice(5));
				return;
			}

			if (/^:[^ ]+ 761 /.test(l)) {
				// RPL_METADATA: <me> <key> <visibility> :<value>
				const parts = l.split(" ");

				if (parts[3] === "draft/webpush/mute") {
					value = l.slice(l.indexOf(" :") + 2);
					finish();
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
						finish();
					}
				}

				return;
			}

			if (/ 762 /.test(l)) {
				// ERR_NOMATCHINGKEY: no mute list yet; start from empty.
				value = "";
				finish();
			}
		};

		ws.send("METADATA * GET draft/webpush/mute");
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
