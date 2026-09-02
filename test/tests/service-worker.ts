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
		host: string;
		port: number;
		tls: boolean;
		saslAccount: string;
		saslPassword: string;
	}>;
}

const STASH: Stash = {
	vapid: "BLB6-test",
	networks: [
		{
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

/** Scripted ircd: replies the way the testnet server does. The mute list
 * value is read from `ws.mute` so tests can pre-seed one. */
function serve(ws: any, line: string): void {
	const reply = (s: string): void => {
		ws.onmessage({data: s});
	};

	if (line === "CAP LS 302") {
		reply(":irc.testnet.local CAP * LS :multi-prefix sasl draft/metadata-2 draft/webpush");
	} else if (line === "CAP REQ :sasl") {
		reply(":irc.testnet.local CAP * ACK :sasl");
	} else if (line === "AUTHENTICATE PLAIN") {
		reply("AUTHENTICATE +");
	} else if (line.startsWith("AUTHENTICATE ")) {
		reply(":irc.testnet.local 900 * :logged in");
		reply(":irc.testnet.local 903 * :SASL authentication successful");
	} else if (line === "CAP END") {
		reply(":irc.testnet.local 001 seance-sw :Welcome");
	} else if (line.startsWith("METADATA * GET")) {
		const v = ws.mute ?? "";
		reply(
			v === ""
				? ":irc.testnet.local 762 seance-sw draft/webpush/mute * :No matching key"
				: `:irc.testnet.local 761 seance-sw draft/webpush/mute private :${v}`
		);
	}
}

const wsInstances: FakeWS[] = [];

class FakeWS {
	sent: string[] = [];
	closed = false;
	onopen: () => void = () => {};
	onmessage: (e: {data: string}) => void = () => {};
	onclose: () => void = () => {};
	onerror: () => void = () => {};

	constructor(public url: string, public protocol: string | undefined, public mute: string) {
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

interface SWHarness {
	sandbox: any;
	handlers: Record<string, Array<(ev: any) => void>>;
	records: Rec[];
	shown: Rec[];
	opened: string[];
	lastSent(): string[];
	setMuteList(v: string): void;
}

function makeSW(muteList = ""): SWHarness {
	const handlers: Record<string, Array<(ev: any) => void>> = {};
	const records: Rec[] = [];
	const shown: Rec[] = [];
	const opened: string[] = [];
	const kv = new Map<string, unknown>([["stash", STASH]]);
	let muteListValue = muteList;

	class HarnessWS extends FakeWS {
		constructor(url: string, protocol?: string) {
			super(url, protocol, muteListValue);
		}
	}

	const sandbox: any = {
		console,
		setTimeout,
		clearTimeout,
		btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
		navigator: {
			userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
			setAppBadge() {},
			clearAppBadge() {},
		},
		clients: {
			matchAll(): Promise<unknown[]> {
				return Promise.resolve([]);
			},
			openWindow(u: string): void {
				opened.push(u);
			},
		},
		registration: {
			getNotifications(filter?: {tag: string}): Promise<Rec[]> {
				return Promise.resolve(
					records.filter(
						(n) => !n.closed && (!filter || !filter.tag || n.tag === filter.tag)
					)
				);
			},
			showNotification(title: string, options: any): Promise<void> {
				const rec: Rec = {
					tag: options.tag || "",
					title,
					body: options.body,
					data: options.data,
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
				const req: FakeReq = {};
				queueMicrotask(() => {
					req.result = {
						transaction: () => ({
							objectStore: () => ({
								get(key: string) {
									const r: FakeReq = {result: kv.get(key)};
									queueMicrotask(() => {
										r.onsuccess?.();
									});
									return r;
								},
								put(value: unknown, key: string) {
									kv.set(key, value);
									const r: FakeReq = {};
									queueMicrotask(() => {
										r.oncomplete?.();
									});
									return r;
								},
							}),
						}),
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

function msgPayload(from: string, target: string, text: string): string {
	return (
		`{"t":"msg","from":"${from}","target":"${target}",` +
		`"msgid":"BjAAAaBjzZ0","time":"2026-09-02T19:59:00.000Z","text":"${text}"}`
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
});
