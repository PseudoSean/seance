/**
 * Service-worker push tests (docs/projects/push-subscription.md).
 *
 * Loads `client/service-worker.js` — the exact artifact the browser
 * registers — into a Node `vm` sandbox with a scripted IRC server and an
 * in-memory notification store, then drives the real handlers: push
 * rendering and per-target merging, the `t:"read"` cross-device relay,
 * notification reply (throwaway-connection PRIVMSG) and the 30m mute
 * (metadata GET-merge-SET).
 */
import {expect} from "chai";
import {readFileSync} from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {CONCAT_TAG, lineIndexOf, parsePushLine} from "../../client/js/push/line";
import {addMessage, MERGE_KEEP, renderMergedBody} from "../../client/js/push/merge";
import {notificationText, stripFormatting} from "../../client/js/push/strip";

const SW_SOURCE = readFileSync(path.join(__dirname, "../../client/service-worker.js"), "utf8");

interface Rec {
	tag: string;
	title: string;
	body: string;
	data: {
		kind?: string;
		count?: number;
		from?: string;
		target?: string;
		time?: string;
		messages?: Array<{from: string; text: string}>;
	};
	closed: boolean;
	close(): void;
}

interface Stash {
	vapid: string | null;
	networks: Array<{
		uuid: string;
		host: string;
		port: number;
		tls: boolean;
		saslAccount: string;
		saslPassword?: string;
	}>;
}

const STASH: Stash = {
	vapid: "BLB6-test",
	networks: [
		{
			uuid: "net-1",
			host: "127.0.0.1",
			port: 8067,
			tls: false,
			saslAccount: "pushtest1",
			saslPassword: "pw",
		},
	],
};

interface FakeReq {
	result?: unknown;
	onsuccess?: () => void;
	oncomplete?: () => void;
}

/** How the scripted ircd behaves beyond the happy path (nefarious2's
 * bouncer, as observed against the testnet — push-subscription.md). */
interface ServerScript {
	/** Answer the FIRST nick with 433 (a ghost of an earlier reply holds it). */
	nickTaken?: boolean;
	/** After 001, replay these channel memberships (an attach to the
	 * account's session), then the "Session resumed" notice. */
	joinReplay?: string[];
	/** Refuse the first channel PRIVMSG with 404 (the replay race). */
	refuseFirst?: boolean;
	/** Register with the session's nick, not the one the worker asked for. */
	sessionNick?: string;
}

/** Scripted ircd: replies the way the testnet server does. The mute list
 * value is read from `ws.mute` so tests can pre-seed one. */
function serve(ws: any, line: string): void {
	const reply = (s: string): void => {
		ws.onmessage({data: s});
	};

	const script: ServerScript = ws.script ?? {};
	const me = (): string => String(script.sessionNick ?? ws.nick ?? "seance-sw");

	// Like a real ircd, registration completes only once NICK, USER and
	// CAP END are all in — whatever order the client sent them.
	const tryRegister = (): void => {
		if (ws.registered || !ws.capEnded || !ws.nick || !ws.user) {
			return;
		}

		ws.registered = true;
		reply(`:irc.testnet.local 001 ${me()} :Welcome`);

		for (const chan of script.joinReplay ?? []) {
			reply(`:${me()}!u@h JOIN :${chan}`);
		}

		if (script.joinReplay) {
			reply(`:irc.testnet.local NOTICE ${me()} :Session resumed. You are in 1 channel(s).`);
		}
	};

	if (line === "CAP LS 302") {
		reply(":irc.testnet.local CAP * LS :multi-prefix sasl draft/metadata-2 draft/webpush");
	} else if (line.startsWith("NICK ")) {
		const nick = line.slice(5);

		if (script.nickTaken && ws.nicks.length === 0) {
			ws.nicks.push(nick);
			reply(`:irc.testnet.local 433 * ${nick} :Nickname is already in use.`);
		} else {
			ws.nicks.push(nick);
			ws.nick = nick;
			tryRegister();
		}
	} else if (line.startsWith("USER ")) {
		ws.user = true;
		tryRegister();
	} else if (line === "CAP REQ :sasl") {
		reply(":irc.testnet.local CAP * ACK :sasl");
	} else if (line === "AUTHENTICATE PLAIN") {
		reply("AUTHENTICATE +");
	} else if (line.startsWith("AUTHENTICATE ")) {
		reply(":irc.testnet.local 900 * :logged in");
		reply(":irc.testnet.local 903 * :SASL authentication successful");
	} else if (line === "CAP END") {
		ws.capEnded = true;
		tryRegister();
	} else if (line.startsWith("PRIVMSG #")) {
		if (script.refuseFirst && !ws.refused) {
			ws.refused = true;
			reply(`:irc.testnet.local 404 ${me()} ${line.split(" ")[1]} :Cannot send to channel`);
		}
	} else if (line.startsWith("WEBPUSH REGISTER ")) {
		reply(`:irc.testnet.local WEBPUSH REGISTER ${line.split(" ")[2]}`);
	} else if (line.startsWith("METADATA * GET")) {
		const v = ws.mute ?? "";
		reply(
			v === ""
				? `:irc.testnet.local 762 ${me()} draft/webpush/mute * :No matching key`
				: `:irc.testnet.local 761 ${me()} draft/webpush/mute private :${v}`
		);
	}
}

/** Every FakeWS the harness created, newest last.  Typed structurally:
 * declaring it as FakeWS[] after the class (or before it) trips
 * no-use-before-define either way. */
const wsInstances: Array<{sent: string[]; closed: boolean; nicks: string[]}> = [];

class FakeWS {
	sent: string[] = [];
	nicks: string[] = [];
	nick?: string;
	user = false;
	capEnded = false;
	registered = false;
	refused = false;
	closed = false;
	onopen: () => void = () => {};
	onmessage: (e: {data: string}) => void = () => {};
	onclose: () => void = () => {};
	onerror: () => void = () => {};

	constructor(
		public url: string,
		public protocol: string | undefined,
		public mute: string,
		public script: ServerScript
	) {
		wsInstances.push(this);
		queueMicrotask(() => this.onopen());
	}

	send(line: string): void {
		this.sent.push(line);
		serve(this, line);
	}

	close(): void {
		this.closed = true;
	}
}

/** A window client of the app: records what the worker posts and, when
 * `ack` is given, answers a reply request through its MessageChannel port
 * (no `ack` = a frozen page that never answers). */
interface FakeClient {
	focused: boolean;
	visibilityState: string;
	posted: any[];
	focusCalls: number;
	ack?: (msg: any) => boolean;
	postMessage(msg: any, transfer?: any[]): void;
	focus(): void;
}

function makeClient(ack?: (msg: any) => boolean): FakeClient {
	const client: FakeClient = {
		focused: true,
		visibilityState: "visible",
		posted: [],
		focusCalls: 0,
		ack,
		postMessage(msg: any, transfer?: any[]) {
			client.posted.push(msg);
			const port = transfer && transfer[0];

			if (!port) {
				return;
			}

			if (client.ack) {
				const ok = client.ack(msg);
				setTimeout(() => {
					port.postMessage({ok});
					port.close(); // an open MessagePort keeps Node alive
				}, 5);
			} else {
				port.close();
			}
		},
		focus() {
			client.focusCalls++;
		},
	};

	return client;
}

interface SWHarness {
	sandbox: any;
	handlers: Record<string, Array<(ev: any) => void>>;
	records: Rec[];
	shown: Rec[];
	opened: string[];
	kv: Map<string, unknown>;
	socketsOpened(): number;
	lastSent(): string[];
	setMuteList(v: string): void;
}

interface HarnessOptions {
	script?: ServerScript;
	clients?: FakeClient[];
	/** Build the worker WITHOUT `sandbox.seancePush` — the js/push.js chunk
	 * failed to load, so `push()` falls back to its inline minimum. */
	noPushModule?: boolean;
	/** Make `indexedDB.open` throw synchronously — the worker must still
	 * show something rather than let handlePush reject silently. */
	failIndexedDB?: boolean;
}

const SCOPE = "https://app.test/";

function makeSW(muteList = "", options: HarnessOptions = {}): SWHarness {
	const handlers: Record<string, Array<(ev: any) => void>> = {};
	const records: Rec[] = [];
	const shown: Rec[] = [];
	const opened: string[] = [];
	const kv = new Map<string, unknown>([["stash", STASH]]);
	const socketsBefore = wsInstances.length;
	let muteListValue = muteList;

	class HarnessWS extends FakeWS {
		constructor(url: string, protocol?: string) {
			super(url, protocol, muteListValue, options.script ?? {});
		}
	}

	const sandbox: any = {
		console,
		setTimeout,
		clearTimeout,
		MessageChannel,
		TextEncoder,
		btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
		navigator: {
			userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
			setAppBadge() {},
			clearAppBadge() {},
		},
		clients: {
			matchAll(): Promise<unknown[]> {
				return Promise.resolve(options.clients ?? []);
			},
			openWindow(u: string): void {
				opened.push(u);
			},
		},
		registration: {
			scope: SCOPE,
			getNotifications(filter?: {tag: string}): Promise<Rec[]> {
				return Promise.resolve(
					records.filter(
						(n) => !n.closed && (!filter || !filter.tag || n.tag === filter.tag)
					)
				);
			},
			showNotification(title: string, opts: any): Promise<void> {
				// The real Notifications API replaces a same-tag notification
				// silently rather than showing a second one; mirror that here
				// so the worker's tag-based merge (no explicit close-then-show)
				// behaves the same under test as in a browser.
				if (opts.tag) {
					for (const n of records) {
						if (!n.closed && n.tag === opts.tag) {
							n.closed = true;
						}
					}
				}

				const rec: Rec = {
					tag: opts.tag || "",
					title,
					body: opts.body,
					data: opts.data,
					closed: false,
					close() {
						rec.closed = true;
					},
				};
				records.push(rec);
				shown.push(rec);
				return Promise.resolve();
			},
		},
		caches: {
			open: (): Promise<any> =>
				Promise.resolve({
					match: (): Promise<undefined> => Promise.resolve(undefined),
					put: (): Promise<void> => Promise.resolve(),
				}),
		},
		fetch: (): Promise<any> =>
			Promise.resolve({
				ok: true,
				clone() {
					return this;
				},
				text: (): Promise<string> => Promise.resolve(""),
				arrayBuffer: (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(0)),
			}),
		importScripts(): void {},
		skipWaiting: (): Promise<void> => Promise.resolve(),
		indexedDB: {
			open() {
				if (options.failIndexedDB) {
					// Private mode / blocked storage: a real browser fires
					// `onerror` async, but a synchronous throw here rejects
					// idbOpen()'s Promise just the same (the executor throwing
					// auto-rejects) and is the smallest fake for it.
					throw new Error("IndexedDB is not available");
				}

				const req: FakeReq = {};
				queueMicrotask(() => {
					req.result = {
						transaction() {
							// The worker awaits the TRANSACTION's oncomplete
							// after a put, as real IndexedDB fires it.
							const tx: FakeReq = {};
							const store = {
								get(key: string) {
									const r: FakeReq = {result: kv.get(key)};
									queueMicrotask(() => {
										r.onsuccess?.();
									});
									return r;
								},
								put(value: unknown, key: string) {
									kv.set(key, value);
									queueMicrotask(() => {
										tx.oncomplete?.();
									});
									return {};
								},
							};

							return {
								objectStore: () => store,
								set oncomplete(fn: () => void) {
									tx.oncomplete = fn;
								},
								get oncomplete() {
									return tx.oncomplete;
								},
							};
						},
					};
					req.onsuccess();
				});
				return req;
			},
		},
		WebSocket: HarnessWS,
	};
	sandbox.self = sandbox;
	sandbox.globalThis = sandbox;

	// The real push module, exactly as js/push.js hands it to the worker
	// (client/js/push/worker-entry.ts) — so this sandbox exercises the path
	// the browser runs, not the worker's own no-module-loaded fallback.
	// `noPushModule` leaves it unset: `importScripts` is already a no-op
	// above, so that is exactly what a failed js/push.js fetch looks like,
	// and `push()` in the worker falls back to its inline minimum.
	if (!options.noPushModule) {
		sandbox.seancePush = {
			parsePushLine,
			lineIndexOf,
			CONCAT_TAG,
			notificationText,
			stripFormatting,
			addMessage,
			renderMergedBody,
			MERGE_KEEP,
		};
	}

	sandbox.addEventListener = (n: string, f: (ev: any) => void) => {
		(handlers[n] = handlers[n] || []).push(f);
	};

	vm.createContext(sandbox);
	vm.runInContext(SW_SOURCE, sandbox, {filename: "service-worker.js"});

	return {
		sandbox,
		handlers,
		records,
		shown,
		opened,
		kv,
		socketsOpened: (): number => wsInstances.length - socketsBefore,
		lastSent: (): string[] => wsInstances[wsInstances.length - 1].sent,
		setMuteList(v: string): void {
			muteListValue = v;
		},
	};
}

/** Fire one push payload through the worker's push handler. */
async function firePush(sw: SWHarness, raw: string): Promise<void> {
	const promises: Promise<unknown>[] = [];
	const ev = {
		data: {text: () => raw},
		waitUntil: (p: Promise<unknown>) => promises.push(p),
	};

	for (const h of sw.handlers.push) {
		h(ev);
	}

	await Promise.all(promises).catch(() => {});
}

/** Fire a notificationclick with the given action. */
async function fireClick(
	sw: SWHarness,
	notification: Rec,
	action: string,
	extra: {reply?: string} = {}
): Promise<void> {
	const promises: Promise<unknown>[] = [];
	const ev = {
		action,
		reply: extra.reply,
		notification: {
			tag: notification.tag,
			close: () => notification.close(),
			data: notification.data,
		},
		waitUntil: (p: Promise<unknown>) => promises.push(p),
	};

	for (const h of sw.handlers.notificationclick) {
		h(ev);
	}

	await Promise.all(promises).catch(() => {});
	await new Promise((r) => setTimeout(r, 350));
}

function msgPayload(from: string, target: string, text: string, msgid = "BjAAAaBjzZ0"): string {
	return (
		`{"t":"msg","from":"${from}","target":"${target}",` +
		`"msgid":"${msgid}","time":"2026-09-02T19:59:00.000Z","text":"${text}"}`
	);
}

describe("service worker push notifications", function () {
	it("renders a PM push with the sender as title and the text as body", async function () {
		const sw = makeSW();

		await firePush(sw, msgPayload("alice", "pushtest", "hello there"));

		expect(sw.shown).to.have.lengthOf(1);
		expect(sw.shown[0].title).to.equal("alice");
		expect(sw.shown[0].body).to.equal("hello there");
		expect(sw.shown[0].data.count).to.equal(1);
	});

	it("renders a channel highlight as `from in #chan` with the text", async function () {
		const sw = makeSW();

		await firePush(
			sw,
			`{"t":"hl","from":"alice","target":"#seance","msgid":"m1","time":"2026-09-02T19:59:00.000Z","text":"hey pushtest"}`
		);

		expect(sw.shown[0].title).to.equal("alice in #seance");
		expect(sw.shown[0].body).to.equal("alice: hey pushtest");
	});

	it("merges same-target pushes into one record with a rising count", async function () {
		const sw = makeSW();

		await firePush(sw, msgPayload("alice", "pushtest", "first"));
		await firePush(sw, msgPayload("alice", "pushtest", "second"));

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
		expect(live[0].data.count).to.equal(2);
		expect(live[0].body).to.contain("first");
		expect(live[0].body).to.contain("second");
		expect(live[0].data.messages).to.have.lengthOf(2);
	});

	it("middle-truncates a long single message", async function () {
		const sw = makeSW();

		const long = "x".repeat(30) + " MIDDLE " + "y".repeat(30);
		await firePush(sw, msgPayload("alice", "pushtest", long));

		expect(sw.shown[0].body).to.contain("…");
		expect(sw.shown[0].body.length).to.be.lessThan(70);
		expect(sw.shown[0].body.startsWith("xxx")).to.equal(true);
		expect(sw.shown[0].body.endsWith("yyy")).to.equal(true);
	});

	it("collapses an overflowing conversation behind `… +N more`", async function () {
		const sw = makeSW();
		const filler = "lorem ipsum dolor sit amet ".repeat(3); // ~81 chars

		for (let i = 1; i <= 5; i++) {
			await firePush(sw, msgPayload("alice", "pushtest", `msg${i} ${filler}`));
		}

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
		// MERGE_KEEP=4 retained msg2-msg5; msg1 aged out of the window
		// (the title's count=5 still covers it) and the body collapsed to
		// the oldest kept line, the +N marker, and the newest line.
		expect(live[0].body).to.contain("… +2 more");
		expect(live[0].body).to.contain("msg2"); // oldest kept for context
		expect(live[0].body).to.contain("msg5"); // newest kept
		expect(live[0].data.count).to.equal(5);
	});

	it("closes a target's notification when another device reads it", async function () {
		const sw = makeSW();

		await firePush(sw, msgPayload("alice", "pushtest", "for the desktop"));
		await firePush(sw, msgPayload("bob", "pushtest", "and one more"));

		const ts = new Date(Date.now() + 5000).toISOString();
		await firePush(sw, `{"t":"read","target":"alice","ts":"${ts}"}`);

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
		expect(live[0].data.target).to.equal("bob");
	});

	it("keeps a notification when the read marker predates its message", async function () {
		const sw = makeSW();

		// the payload's time is fixed in the past; the read marker predates it
		await firePush(sw, msgPayload("alice", "pushtest", "arrived later"));
		await firePush(sw, `{"t":"read","target":"pushtest","ts":"2026-09-01T00:00:00.000Z"}`);

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
	});

	it("strips IRC formatting always, and Markdown markers only when the reader renders it", async function () {
		const defaultPrefs = makeSW();
		await firePush(
			defaultPrefs,
			"@msgid=fmt1;time=2026-09-02T19:59:00.000Z :alice!u@h PRIVMSG pushtest :\x02**hello**\x02"
		);
		expect(defaultPrefs.shown[0].body).to.equal("hello");

		const markdownOff = makeSW();
		markdownOff.kv.set("prefs", {markdown: false});
		await firePush(
			markdownOff,
			"@msgid=fmt2;time=2026-09-02T19:59:00.000Z :alice!u@h PRIVMSG pushtest :\x02**hello**\x02"
		);
		expect(markdownOff.shown[0].body).to.equal("**hello**");
	});

	it("reassembles a multiline batch delivered out of order into one notification", async function () {
		const sw = makeSW();
		const T = "2026-09-02T19:59:00.000Z";
		const line = (i: number, text: string, concat = "") =>
			`@batch=b1;msgid=b1;time=${T};evilnet.github.io/line=${i}/3/3${concat} :bob!u@h PRIVMSG pushtest :${text}`;

		await firePush(sw, line(3, "```"));
		await firePush(sw, line(1, "```js"));
		await firePush(sw, line(2, "let x = 1;"));

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
		expect(live[0].data.count).to.equal(1);
		expect(live[0].body).to.equal("let x = 1;");
	});

	it("reassembles a multiline batch whose pushes arrive at the same time", async function () {
		// FCM hands a batch's pushes to the worker together; the handlers run
		// concurrently, and each one reads the notification's stored state
		// before writing it back. Every line must survive.
		const sw = makeSW();
		const T = "2026-09-02T19:59:00.000Z";
		const line = (i: number) =>
			`@batch=b2;msgid=b2;time=${T};evilnet.github.io/line=${i}/5/5 :bob!u@h PRIVMSG pushtest :line ${i}`;

		await Promise.all([1, 2, 3, 4, 5].map((i) => firePush(sw, line(i))));

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
		expect(live[0].data.count).to.equal(1);
		expect(live[0].body).to.equal("line 1\nline 2\nline 3\nline 4\nline 5");
	});

	it("a MARKREAD line closes the target's notification when it postdates the message", async function () {
		const sw = makeSW();

		await firePush(
			sw,
			"@msgid=mr1;time=2026-09-02T19:59:00.000Z :alice!u@h PRIVMSG pushtest :unread"
		);
		await firePush(sw, ":irc.example MARKREAD alice timestamp=2099-01-01T00:00:00.000Z");

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(0);
	});

	it("a MARKREAD line leaves a notification that postdates it", async function () {
		const sw = makeSW();

		await firePush(
			sw,
			"@msgid=mr2;time=2099-01-01T00:00:00.000Z :alice!u@h PRIVMSG pushtest :future"
		);
		await firePush(sw, ":irc.example MARKREAD alice timestamp=2026-09-02T19:59:00.000Z");

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
	});

	it("sends the inline reply over a throwaway connection", async function () {
		const sw = makeSW();

		await firePush(sw, msgPayload("alice", "pushtest", "need a reply"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		await fireClick(sw, rec, "reply", {reply: "on my way"});

		const sent = sw.lastSent().join("\n");
		expect(sent).to.contain("PRIVMSG alice :on my way"); // reply to the sender
		expect(rec.closed).to.equal(true);
	});

	it("falls back to opening the app when a reply arrives unsendable", async function () {
		const sw = makeSW();
		sw.kv.delete("stash");

		await firePush(sw, msgPayload("alice", "pushtest", "unanswered"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		await fireClick(sw, rec, "reply", {reply: "hello?"});

		expect(sw.opened).to.have.lengthOf(1);
	});

	it("mutes 30 minutes via metadata GET-merge-SET", async function () {
		const sw = makeSW();
		sw.setMuteList("otherchan:1799999999");

		await firePush(sw, msgPayload("alice", "pushtest", "silence me"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		await fireClick(sw, rec, "mute30");

		const sent = sw.lastSent().join("\n");
		const match = sent.match(/METADATA \* SET draft\/webpush\/mute \* :([^\r\n]+)/);
		expect(match, "SET line sent").to.exist;

		const entries = match![1].split(";");
		expect(entries).to.contain("otherchan:1799999999"); // preserved

		const mine = entries.find((e) => e.startsWith("alice:"));
		expect(mine, "alice muted").to.exist;

		const until = Number(mine!.split(":")[1]);
		expect(until).to.be.within(
			Math.floor(Date.now() / 1000) + 1790,
			Math.floor(Date.now() / 1000) + 1810
		);
	});

	it("starts the mute list from empty when none exists", async function () {
		const sw = makeSW();

		await firePush(sw, msgPayload("alice", "pushtest", "mute me"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		await fireClick(sw, rec, "mute30");

		const sent = sw.lastSent().join("\n");
		const match = sent.match(/METADATA \* SET draft\/webpush\/mute \* :([^\r\n]+)/);
		expect(match, "SET line sent").to.exist;
		expect(match![1]).to.match(/^alice:\d+$/);
	});

	it("drops a push whose msgid the live page already saw", async function () {
		const sw = makeSW();
		const msgid = "BjAAAaBjzZ0";

		// The page recorded this message while it was alive (push-seen.ts).
		sw.kv.set("seen", [msgid]);
		await firePush(sw, msgPayload("alice", "pushtest", "hello there"));

		expect(sw.shown, "suppressed when seen").to.have.lengthOf(0);

		// A different message (no record) still shows.
		await firePush(sw, msgPayload("alice", "pushtest", "second one", "BjAAAaBjzZ1"));
		expect(sw.shown, "shown when not seen").to.have.lengthOf(1);

		// The raw-line path dedupes on its own tags.msgid too, against the
		// same "seen" ring.
		sw.kv.set("seen", ["BjAAAaBjzZ9"]);
		await firePush(sw, "@msgid=BjAAAaBjzZ9 :alice PRIVMSG pushtest :old line");
		expect(sw.shown, "raw-line msgid in the seen ring is deduped").to.have.lengthOf(1);

		// A raw line with a msgid not in the ring still shows.
		await firePush(sw, "@msgid=BjAAAaBjzZ10 :alice PRIVMSG pushtest :new line");
		expect(sw.shown, "raw-line msgid not in the ring still shows").to.have.lengthOf(2);
	});

	it("keeps the read relay working when seen entries exist", async function () {
		const sw = makeSW();

		await firePush(sw, msgPayload("alice", "pushtest", "hello there"));
		expect(sw.shown).to.have.lengthOf(1);

		// The t:"read" relay carries ts, not msgid — never deduped.
		await firePush(sw, `{"t":"read","target":"alice","ts":"2026-09-03T00:00:00.000Z"}`);
		expect(sw.records[0].closed, "notification closed by read relay").to.be.true;
	});

	it("titles and tags a highlight on a non-# channel prefix (isChannelName, not startsWith('#'))", async function () {
		const sw = makeSW();

		await firePush(
			sw,
			"@msgid=amp1;time=2026-09-04T10:20:30.123Z :bob!u@h PRIVMSG &local :hey pushtest"
		);

		expect(sw.shown).to.have.lengthOf(1);
		expect(sw.shown[0].title).to.equal("bob in &local");
		expect(sw.shown[0].tag).to.equal("push-&local");
	});

	it("shows the generic notification when IndexedDB rejects", async function () {
		const sw = makeSW("", {failIndexedDB: true});

		await firePush(sw, msgPayload("alice", "pushtest", "hello there"));

		expect(sw.shown).to.have.lengthOf(1);
		expect(sw.shown[0].tag).to.equal("push-activity");
		expect(sw.shown[0].body).to.equal("New activity while you were away.");
	});
});

describe("service worker push notifications (inline fallback, js/push.js not loaded)", function () {
	it("renders a PM with control bytes stripped and Markdown left literal", async function () {
		const sw = makeSW("", {noPushModule: true});

		await firePush(
			sw,
			"@msgid=fb1;time=2026-09-04T10:20:30.123Z :alice!u@h PRIVMSG me :\x02**hi**\x02"
		);

		expect(sw.shown).to.have.lengthOf(1);
		expect(sw.shown[0].title).to.equal("alice");
		expect(sw.shown[0].body).to.equal("**hi**");
	});

	it("merges a second push for the same target into a two-line body", async function () {
		const sw = makeSW("", {noPushModule: true});

		await firePush(
			sw,
			"@msgid=fb2;time=2026-09-04T10:20:30.123Z :alice!u@h PRIVMSG me :\x02**hi**\x02"
		);
		await firePush(
			sw,
			"@msgid=fb3;time=2026-09-04T10:20:31.123Z :alice!u@h PRIVMSG me :\x02**bye**\x02"
		);

		const live = sw.records.filter((n) => !n.closed);
		expect(live).to.have.lengthOf(1);
		expect(live[0].body).to.equal("**hi**\n**bye**");
		expect(live[0].data.count).to.equal(2);
	});
});

/** Fire a page-posted message at the worker's `message` handler. */
async function fireMessage(sw: SWHarness, data: any): Promise<void> {
	const promises: Promise<unknown>[] = [];
	const ev = {data, waitUntil: (p: Promise<unknown>) => promises.push(p)};

	for (const h of sw.handlers.message) {
		h(ev);
	}

	await Promise.all(promises).catch(() => {});
}

async function pushed(sw: SWHarness, target = "pushtest", from = "alice"): Promise<Rec> {
	await firePush(sw, msgPayload(from, target, "need a reply"));

	return sw.records.filter((n) => !n.closed)[0];
}

function hlPayload(from: string, chan: string, text: string): string {
	return `{"t":"hl","from":"${from}","target":"${chan}","msgid":"m-${Math.random()}","time":"2026-09-02T19:59:00.000Z","text":"${text}"}`;
}

describe("service worker reply pipeline", function () {
	this.timeout(8000);

	it("registers under a random nick and recovers from 433", async function () {
		const sw = makeSW("", {script: {nickTaken: true}});
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {reply: "on my way"});

		const sent = sw.lastSent();
		const nicks = sent.filter((l) => l.startsWith("NICK ")).map((l) => l.slice(5));
		expect(nicks, "a second nick after 433").to.have.lengthOf(2);
		expect(nicks[0]).to.not.equal(nicks[1]);
		expect(nicks[0]).to.match(/^seance-[a-z0-9]{4,}$/);
		expect(nicks[0], "never the fixed nick that collides with its own ghost").to.not.equal(
			"seance-sw"
		);
		expect(sent.join("\n")).to.contain("PRIVMSG alice :on my way");
		expect(rec.closed).to.equal(true);
	});

	it("sends a channel reply once the bouncer replayed the JOIN, not at 001", async function () {
		const sw = makeSW("", {script: {joinReplay: ["#seance"], sessionNick: "pushtest1-pg"}});

		await firePush(sw, hlPayload("alice", "#seance", "hey pushtest1"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		const started = Date.now();
		await fireClick(sw, rec, "reply", {reply: "on my way"});

		expect(sw.lastSent().join("\n")).to.contain("PRIVMSG #seance :on my way");
		expect(Date.now() - started, "no settle wait once the JOIN replay arrived").to.be.below(
			1200
		);
		expect(rec.closed).to.equal(true);
	});

	it("falls back to a settle wait when no JOIN replay comes", async function () {
		const sw = makeSW();

		await firePush(sw, hlPayload("alice", "#seance", "hey pushtest1"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		const started = Date.now();
		await fireClick(sw, rec, "reply", {reply: "late"});

		expect(sw.lastSent().join("\n")).to.contain("PRIVMSG #seance :late");
		expect(Date.now() - started).to.be.at.least(1500);
	});

	it("retries a channel reply once after a 404 from the replay race", async function () {
		const sw = makeSW("", {script: {joinReplay: ["#seance"], refuseFirst: true}});

		await firePush(sw, hlPayload("alice", "#seance", "hey pushtest1"));
		const rec = sw.records.filter((n) => !n.closed)[0];
		await fireClick(sw, rec, "reply", {reply: "again"});

		const privmsgs = sw.lastSent().filter((l) => l.startsWith("PRIVMSG #seance :again"));
		expect(privmsgs, "sent twice").to.have.lengthOf(2);
		expect(rec.closed, "counted as sent").to.equal(true);
		expect(sw.opened, "no fallback to opening the app").to.have.lengthOf(0);
	});

	it("splits a long reply into frame-sized PRIVMSGs", async function () {
		const sw = makeSW();
		const rec = await pushed(sw);
		const long = Array.from({length: 120}, (_, i) => `word${i}`).join(" "); // ~830 chars

		await fireClick(sw, rec, "reply", {reply: long});

		const privmsgs = sw.lastSent().filter((l) => l.startsWith("PRIVMSG alice :"));
		expect(privmsgs.length).to.be.at.least(2);

		for (const l of privmsgs) {
			expect(Buffer.byteLength(l)).to.be.below(420);
		}

		expect(privmsgs.map((l) => l.slice("PRIVMSG alice :".length)).join(" ")).to.equal(long);
	});

	it("hands the reply to an open page first and opens no socket", async function () {
		const client = makeClient(() => true);
		const sw = makeSW("", {clients: [client]});
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {reply: "via page"});

		expect(client.posted).to.have.lengthOf(1);
		expect(client.posted[0]).to.include({
			type: "reply",
			network: "net-1",
			target: "alice",
			text: "via page",
		});
		expect(sw.socketsOpened(), "no throwaway connection").to.equal(0);
		expect(rec.closed).to.equal(true);
	});

	it("uses its own connection when the page does not answer (frozen)", async function () {
		const frozen = makeClient(); // never acks
		const sw = makeSW("", {clients: [frozen]});
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {reply: "page is frozen"});

		expect(frozen.posted).to.have.lengthOf(1);
		expect(sw.socketsOpened()).to.equal(1);
		expect(sw.lastSent().join("\n")).to.contain("PRIVMSG alice :page is frozen");
		expect(rec.closed).to.equal(true);
	});

	it("uses its own connection when the page reports it cannot send", async function () {
		const offline = makeClient(() => false); // network disconnected in the page
		const sw = makeSW("", {clients: [offline]});
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {reply: "page offline"});

		expect(sw.socketsOpened()).to.equal(1);
		expect(sw.lastSent().join("\n")).to.contain("PRIVMSG alice :page offline");
	});

	it("queues the reply and opens the conversation when nothing can send it", async function () {
		const sw = makeSW();
		// Password not remembered: the stash knows the network, not the login.
		sw.kv.set("stash", {
			...STASH,
			networks: [{...STASH.networks[0], saslPassword: undefined}],
		});
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {reply: "keep me"});

		expect(sw.socketsOpened(), "cannot log in").to.equal(0);
		const outbox = sw.kv.get("outbox") as any[];
		expect(outbox).to.have.lengthOf(1);
		expect(outbox[0]).to.include({network: "net-1", target: "alice", text: "keep me"});
		expect(sw.opened).to.deep.equal([`${SCOPE}#/net/net-1/alice`]);
	});

	it("opens the conversation when the reply button carries no text", async function () {
		const sw = makeSW();
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {});

		expect(sw.socketsOpened()).to.equal(0);
		expect(sw.kv.get("outbox")).to.equal(undefined);
		expect(sw.opened).to.deep.equal([`${SCOPE}#/net/net-1/alice`]);
	});

	it("does not touch the page's outbox when a reply went out", async function () {
		const sw = makeSW();
		const rec = await pushed(sw);

		await fireClick(sw, rec, "reply", {reply: "sent"});

		expect(sw.kv.get("outbox")).to.equal(undefined);
	});
});

describe("service worker notification click", function () {
	it("opens a window on the network/target deep link when no page is open", async function () {
		const sw = makeSW();
		const rec = await pushed(sw, "#seance");

		await fireClick(sw, rec, "");

		expect(sw.opened).to.deep.equal([`${SCOPE}#/net/net-1/%23seance`]);
	});

	it("tells an open page which conversation to show and focuses it", async function () {
		const client = makeClient();
		const sw = makeSW("", {clients: [client]});
		const rec = await pushed(sw, "#seance");

		await fireClick(sw, rec, "");

		expect(sw.opened).to.have.lengthOf(0);
		expect(client.posted[0]).to.include({type: "open", network: "net-1", target: "#seance"});
		expect(client.focusCalls).to.equal(1);
	});

	it("carries the page notification's network and target so it outlives the page", async function () {
		const sw = makeSW();

		await fireMessage(sw, {
			type: "notification",
			chanId: 7,
			network: "net-1",
			target: "#seance",
			title: "alice (#seance) says:",
			body: "hi",
			timestamp: Date.now(),
		});

		expect(sw.shown).to.have.lengthOf(1);
		expect(sw.shown[0].tag).to.equal("chan-7");
		expect(sw.shown[0].data).to.deep.equal({kind: "page", network: "net-1", target: "#seance"});

		await fireClick(sw, sw.shown[0], "");
		expect(sw.opened).to.deep.equal([`${SCOPE}#/net/net-1/%23seance`]);
	});

	it("falls back to the chan-<id> route for a page notification without a target", async function () {
		const sw = makeSW();

		await fireMessage(sw, {type: "notification", chanId: 7, title: "t", body: "b"});
		await fireClick(sw, sw.shown[0], "");

		expect(sw.opened).to.deep.equal([`${SCOPE}#/chan-7`]);
	});
});

describe("service worker subscription renewal", function () {
	it("re-registers after 001, where nefarious2 accepts WEBPUSH REGISTER", async function () {
		const sw = makeSW();
		const promises: Promise<unknown>[] = [];
		const ev = {
			oldSubscription: null,
			newSubscription: {endpoint: "https://push.example/e1", keys: {p256dh: "P", auth: "A"}},
			waitUntil: (p: Promise<unknown>) => promises.push(p),
		};

		for (const h of sw.handlers.pushsubscriptionchange) {
			h(ev);
		}

		await Promise.all(promises).catch(() => {});

		const sent = sw.lastSent();
		const capEnd = sent.indexOf("CAP END");
		const register = sent.findIndex((l) =>
			l.startsWith("WEBPUSH REGISTER https://push.example/e1")
		);
		expect(register, "REGISTER sent").to.be.greaterThan(-1);
		expect(register, "after CAP END, not before").to.be.greaterThan(capEnd);
	});

	it("unregisters the rotated-away endpoint so the device is not registered twice", async function () {
		const sw = makeSW();
		const promises: Promise<unknown>[] = [];
		const ev = {
			oldSubscription: {endpoint: "https://push.example/OLD"},
			newSubscription: {endpoint: "https://push.example/NEW", keys: {p256dh: "P", auth: "A"}},
			waitUntil: (p: Promise<unknown>) => promises.push(p),
		};

		for (const h of sw.handlers.pushsubscriptionchange) {
			h(ev);
		}

		await Promise.all(promises).catch(() => {});

		const sent = sw.lastSent();
		const unregister = sent.indexOf("WEBPUSH UNREGISTER https://push.example/OLD");
		const register = sent.findIndex((l) =>
			l.startsWith("WEBPUSH REGISTER https://push.example/NEW")
		);
		expect(unregister, "old endpoint unregistered").to.be.greaterThan(-1);
		expect(register, "new endpoint registered").to.be.greaterThan(-1);
		expect(unregister, "unregister before register").to.be.lessThan(register);
	});
});
