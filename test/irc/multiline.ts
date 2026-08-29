import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {joinMultiline, parseMultilineValue, planMultiline} from "../../client/js/irc/multiline";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {IrcMessage, MAX_LINE_BYTES, parseLine, utf8ByteLength} from "../../client/js/irc/message";
import {MessageType, SharedMsg} from "../../shared/types/msg";

class FakeTransport implements Transport {
	state: TransportState = "closed";
	sent: string[] = [];
	private listeners: ((ev: TransportEvent) => void)[] = [];

	on(listener: (ev: TransportEvent) => void): () => void {
		this.listeners.push(listener);

		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	connect(): void {
		this.state = "connecting";
	}

	send(line: string): void {
		this.sent.push(line);
	}

	close(): void {
		this.state = "closed";
	}

	open(): void {
		this.state = "open";
		this.emit({type: "open", subprotocol: "text.ircv3.net"});
	}

	line(line: string): void {
		this.emit({type: "line", line});
	}

	lines(...lines: string[]): void {
		lines.forEach((line) => this.line(line));
	}

	closed(): void {
		this.state = "closed";
		this.emit({type: "close", code: 1006, reason: "", wasClean: false, willReconnect: false});
	}

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

let dispatch: sinon.SinonSpy;
/** Whether this file installed the spy (test/irc/client.ts has a root-level one). */
let ownsSpy = false;

function installSpy(): void {
	const current = (socket as unknown as Record<string, unknown>).dispatch;

	if ((current as {isSinonProxy?: boolean}).isSinonProxy) {
		dispatch = current as sinon.SinonSpy;
		ownsSpy = false;
		return;
	}

	dispatch = sinon.spy(socket, "dispatch");
	ownsSpy = true;
}

function removeSpy(): void {
	if (ownsSpy) {
		dispatch.restore();
	}

	socket.removeAllListeners();
}

function messages(chanId: number): SharedMsg[] {
	return dispatch
		.getCalls()
		.filter((call) => call.args[0] === "msg")
		.map((call) => call.args[1] as {chan: number; msg: SharedMsg})
		.filter((p) => p.chan === chanId)
		.map((p) => p.msg);
}

const MULTILINE_VALUE = "max-bytes=16384,max-lines=100";
const OFFERED_CAPS = `batch message-tags server-time echo-message draft/multiline=${MULTILINE_VALUE}`;

interface Harness {
	client: IrcClient;
	transport: FakeTransport;
	chanId: number;
	/** Caps the client asked for in its `CAP REQ`. */
	requested: string[];
}

/** A registered client in #seance with bob and carol present. */
function setup(offered: string = OFFERED_CAPS): Harness {
	const transport = new FakeTransport();
	const client = new IrcClient({
		host: "irc.test",
		port: 8443,
		tls: true,
		nick: "alice",
		join: "#seance",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
		ids: new IdAllocator(),
		transportFactory: () => transport,
		highlights: () => ({keywords: [], exceptions: []}),
	});

	client.connect();
	transport.open();
	transport.line(`:irc.test CAP * LS :${offered}`);

	const req = transport.sent.find((line) => line.startsWith("CAP REQ :"));
	const requested = req ? req.slice("CAP REQ :".length).split(" ") : [];

	if (requested.length > 0) {
		transport.line(`:irc.test CAP alice ACK :${requested.join(" ")}`);
	}

	transport.lines(
		":irc.test 001 alice :Welcome to the SeanceDev IRC Network, alice",
		":irc.test 005 alice CHANTYPES=#& PREFIX=(ov)@+ CHANMODES=beI,k,l,imnpst CASEMAPPING=rfc1459 :are supported by this server",
		":irc.test 422 alice :MOTD File is missing",
		":alice!alice@host JOIN #seance",
		":irc.test 353 alice = #seance :@alice bob carol",
		":irc.test 366 alice #seance :End of /NAMES list."
	);
	dispatch.resetHistory();
	transport.sent.length = 0;

	return {client, transport, requested, chanId: client.findChannel("#seance")!.id};
}

describe("multiline cap", function () {
	beforeEach(function () {
		installSpy();
	});

	afterEach(function () {
		removeSpy();
	});

	describe("parseMultilineValue", function () {
		it("parses the documented value", function () {
			expect(parseMultilineValue("max-bytes=16384,max-lines=100")).to.deep.equal({
				maxBytes: 16384,
				maxLines: 100,
			});
		});

		it("accepts the tokens in either order and ignores unknown ones", function () {
			expect(parseMultilineValue("max-lines=24,foo=bar,max-bytes=4096")).to.deep.equal({
				maxBytes: 4096,
				maxLines: 24,
			});
		});

		it("treats a missing or unusable max-lines as no line limit", function () {
			// The draft makes max-lines RECOMMENDED, not REQUIRED.
			expect(parseMultilineValue("max-bytes=16384")).to.deep.equal({
				maxBytes: 16384,
				maxLines: Infinity,
			});
			expect(parseMultilineValue("max-bytes=16384,max-lines=0")).to.deep.equal({
				maxBytes: 16384,
				maxLines: Infinity,
			});
			expect(parseMultilineValue("max-bytes=16384,max-lines=lots")).to.deep.equal({
				maxBytes: 16384,
				maxLines: Infinity,
			});
		});

		it("rejects a value without a usable max-bytes", function () {
			expect(parseMultilineValue("max-lines=100")).to.equal(undefined);
			expect(parseMultilineValue("")).to.equal(undefined);
			expect(parseMultilineValue(undefined)).to.equal(undefined);
			expect(parseMultilineValue("max-bytes=0,max-lines=100")).to.equal(undefined);
			expect(parseMultilineValue("max-bytes=-1,max-lines=100")).to.equal(undefined);
			expect(parseMultilineValue("max-bytes=lots,max-lines=100")).to.equal(undefined);
			expect(parseMultilineValue("max-bytes,max-lines")).to.equal(undefined);
			expect(parseMultilineValue("garbage")).to.equal(undefined);
		});
	});

	describe("negotiation", function () {
		it("requests draft/multiline and exposes its limits", function () {
			const {client, requested} = setup();

			expect(requested).to.include("draft/multiline");
			expect(client.multilineLimits()).to.deep.equal({maxBytes: 16384, maxLines: 100});
		});

		it("does not request the cap when its value is unusable", function () {
			const {client, requested} = setup(
				"batch message-tags server-time draft/multiline=max-lines=100"
			);

			expect(requested).to.not.include("draft/multiline");
			expect(client.multilineLimits()).to.equal(undefined);
		});

		it("has no limits when the server never offers the cap", function () {
			const {client, requested} = setup("batch message-tags server-time");

			expect(requested).to.not.include("draft/multiline");
			expect(client.multilineLimits()).to.equal(undefined);
		});

		it("has no limits without batch", function () {
			const {client, requested} = setup(
				`message-tags server-time draft/multiline=${MULTILINE_VALUE}`
			);

			expect(requested).to.include("draft/multiline");
			expect(client.multilineLimits()).to.equal(undefined);
		});

		it("drops the limits when the cap is removed again", function () {
			const {client, transport} = setup();

			transport.line(":irc.test CAP alice DEL :draft/multiline");
			expect(client.multilineLimits()).to.equal(undefined);
		});
	});
});

describe("multiline batches", function () {
	beforeEach(function () {
		installSpy();
	});

	afterEach(function () {
		removeSpy();
	});

	function more(chanId: number): {messages: SharedMsg[]}[] {
		return dispatch
			.getCalls()
			.filter((call) => call.args[0] === "more")
			.map((call) => call.args[1] as {chan: number; messages: SharedMsg[]})
			.filter((p) => p.chan === chanId);
	}

	function line(text: string, tags = "", nick = "bob"): string {
		return `@batch=ml${tags} :${nick}!b@h PRIVMSG #seance :${text}`;
	}

	describe("joinMultiline", function () {
		function parsed(...lines: string[]): IrcMessage[] {
			return lines.map((l) => {
				const msg = parseLine(l);

				if (!msg) {
					throw new Error(`bad test line: ${l}`);
				}

				return msg;
			});
		}

		it("joins lines with a line feed", function () {
			expect(joinMultiline(parsed(line("a"), line("b"), line("c")))).to.deep.equal({
				command: "PRIVMSG",
				target: "#seance",
				text: "a\nb\nc",
				source: "bob!b@h",
			});
		});

		it("appends a draft/multiline-concat line without a separator", function () {
			expect(
				joinMultiline(parsed(line("a"), line("b", ";draft/multiline-concat"), line("c")))
					?.text
			).to.equal("ab\nc");
		});

		it("rewraps an ACTION batch around the joined text", function () {
			expect(
				joinMultiline(parsed(line("\x01ACTION a\x01"), line("\x01ACTION b\x01")))?.text
			).to.equal("\x01ACTION a\nb\x01");
		});

		it("rejects an empty batch, mixed targets and mixed commands", function () {
			expect(joinMultiline([])).to.equal(undefined);
			expect(
				joinMultiline(parsed(line("a"), "@batch=ml :bob!b@h PRIVMSG #other :b"))
			).to.equal(undefined);
			expect(
				joinMultiline(parsed(line("a"), "@batch=ml :bob!b@h NOTICE #seance :b"))
			).to.equal(undefined);
			expect(joinMultiline(parsed(line("a"), "@batch=ml :bob!b@h TAGMSG #seance"))).to.equal(
				undefined
			);
		});
	});

	it("delivers a multiline batch as one message", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			line("first"),
			line("second"),
			line("third")
		);
		expect(messages(chanId), "nothing before the batch closes").to.have.length(0);

		transport.line(":irc.test BATCH -ml");

		const shown = messages(chanId);
		expect(shown).to.have.length(1);
		expect(shown[0].text).to.equal("first\nsecond\nthird");
		expect(shown[0].type).to.equal(MessageType.MESSAGE);
		expect(shown[0].from?.nick).to.equal("bob");
	});

	it("takes msgid, time and the reply tag from the batch opener", function () {
		const {transport, chanId} = setup();

		transport.lines(
			"@msgid=m1;time=2026-08-29T10:00:00.000Z;+draft/reply=parent :irc.test BATCH +ml draft/multiline #seance",
			"@batch=ml;msgid=ignored :bob!b@h PRIVMSG #seance :one",
			"@batch=ml :bob!b@h PRIVMSG #seance :two",
			":irc.test BATCH -ml"
		);

		const [shown] = messages(chanId);
		expect(shown.text).to.equal("one\ntwo");
		expect(shown.msgid).to.equal("m1");
		expect(shown.time.toISOString()).to.equal("2026-08-29T10:00:00.000Z");
		expect(shown.replyTo).to.equal("parent");
	});

	it("falls back to the first line's msgid, time and account", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			"@batch=ml;msgid=l1;time=2026-08-29T10:00:00.000Z;account=bobby :bob!b@h PRIVMSG #seance :one",
			"@batch=ml :bob!b@h PRIVMSG #seance :two",
			":irc.test BATCH -ml"
		);

		const [shown] = messages(chanId);
		expect(shown.text).to.equal("one\ntwo");
		expect(shown.msgid).to.equal("l1");
		expect(shown.time.toISOString()).to.equal("2026-08-29T10:00:00.000Z");
		expect(shown.fromAccount).to.equal("bobby");
	});

	it("compares the lines' targets with the network's casemapping", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			line("one"),
			"@batch=ml :bob!b@h PRIVMSG #SEANCE :two",
			":irc.test BATCH -ml"
		);

		expect(messages(chanId).map((m) => m.text)).to.deep.equal(["one\ntwo"]);
	});

	it("joins an ACTION batch into one action", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			line("\x01ACTION waves\x01"),
			line("\x01ACTION and bows\x01"),
			":irc.test BATCH -ml"
		);

		const [shown] = messages(chanId);
		expect(shown.type).to.equal(MessageType.ACTION);
		expect(shown.text).to.equal("waves\nand bows");
	});

	it("keeps a NOTICE batch a notice", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			"@batch=ml :bob!b@h NOTICE #seance :one",
			"@batch=ml :bob!b@h NOTICE #seance :two",
			":irc.test BATCH -ml"
		);

		const [shown] = messages(chanId);
		expect(shown.type).to.equal(MessageType.NOTICE);
		expect(shown.text).to.equal("one\ntwo");
	});

	it("marks our own echoed batch as self", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			line("mine", "", "alice"),
			line("too", "", "alice"),
			":irc.test BATCH -ml"
		);

		const [shown] = messages(chanId);
		expect(shown.self).to.equal(true);
		expect(shown.text).to.equal("mine\ntoo");
	});

	it("delivers the lines individually when a target does not match", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +ml draft/multiline #seance",
			line("one"),
			"@batch=ml :bob!b@h PRIVMSG #other :two",
			":irc.test BATCH -ml"
		);

		expect(messages(chanId).map((m) => m.text)).to.deep.equal(["one"]);
	});

	it("shows nothing for an empty batch", function () {
		const {transport, chanId} = setup();

		transport.lines(":irc.test BATCH +ml draft/multiline #seance", ":irc.test BATCH -ml");

		expect(messages(chanId)).to.have.length(0);
	});

	it("folds into an enclosing chathistory batch in its place", function () {
		const {transport, chanId} = setup();

		transport.lines(
			":irc.test BATCH +hist chathistory #seance",
			"@batch=hist;msgid=h1;time=2026-08-29T09:00:00.000Z :bob!b@h PRIVMSG #seance :before",
			"@batch=hist;msgid=h2;time=2026-08-29T09:01:00.000Z :irc.test BATCH +ml draft/multiline #seance",
			"@batch=ml :bob!b@h PRIVMSG #seance :one",
			"@batch=ml :bob!b@h PRIVMSG #seance :two",
			"@batch=hist :irc.test BATCH -ml",
			"@batch=hist;msgid=h3;time=2026-08-29T09:02:00.000Z :bob!b@h PRIVMSG #seance :after",
			":irc.test BATCH -hist"
		);

		const pages = more(chanId);
		expect(pages).to.have.length(1);
		expect(pages[0].messages.map((m) => m.text)).to.deep.equal(["before", "one\ntwo", "after"]);
		expect(pages[0].messages[1].msgid).to.equal("h2");
	});
});

describe("multiline sending", function () {
	beforeEach(function () {
		installSpy();
	});

	afterEach(function () {
		removeSpy();
	});

	/** The text a plan stands for, joined the way a receiver would join it. */
	function rejoin(lines: {text: string; concat: boolean}[]): string {
		return lines.map((l, i) => (i > 0 && !l.concat ? `\n${l.text}` : l.text)).join("");
	}

	function texts(plan: {text: string; concat: boolean}[][]): string[][] {
		return plan.map((batch) => batch.map((l) => l.text));
	}

	/** The offered caps with `draft/multiline` carrying `value`. */
	function offering(value: string, extra = "echo-message "): string {
		return `batch message-tags server-time ${extra}draft/multiline=${value}`;
	}

	describe("planMultiline", function () {
		const LIMITS = {maxBytes: 16384, maxLines: 100};

		it("makes one line per line feed", function () {
			expect(planMultiline("a\nb", 0, LIMITS)).to.deep.equal([
				[
					{text: "a", concat: false},
					{text: "b", concat: false},
				],
			]);
		});

		it("keeps blank lines inside the message and drops trailing ones", function () {
			expect(texts(planMultiline("a\n\nb\n\n", 0, LIMITS))).to.deep.equal([["a", "", "b"]]);
		});

		it("plans nothing for a message of blank lines only", function () {
			expect(planMultiline("\n\n", 0, LIMITS)).to.deep.equal([]);
			expect(planMultiline("", 0, LIMITS)).to.deep.equal([]);
		});

		it("normalises CRLF and keeps CR and NUL off the wire", function () {
			expect(texts(planMultiline("a\r\nb\rc\0d", 0, LIMITS))).to.deep.equal([["a", "b c d"]]);
		});

		it("splits an over-long line into concat chunks that rejoin exactly", function () {
			const long = Array.from({length: 200}, (_, i) => `word${i}`).join(" ");
			const text = `${long}\ntail`;
			const plan = planMultiline(text, 100, LIMITS);

			expect(plan).to.have.length(1);

			const [batch] = plan;
			expect(batch.length).to.be.greaterThan(2);
			expect(batch[0].concat).to.equal(false);
			expect(batch[1].concat).to.equal(true);
			expect(batch[batch.length - 1]).to.deep.equal({text: "tail", concat: false});
			expect(rejoin(batch), "a plan rejoins to exactly what was typed").to.equal(text);

			for (const line of batch) {
				expect(utf8ByteLength(line.text)).to.be.at.most(MAX_LINE_BYTES - 100);
			}
		});

		it("splits a line with no spaces at the byte budget", function () {
			const text = `${"x".repeat(30)}\ny`;
			const plan = planMultiline(text, MAX_LINE_BYTES - 10, {maxBytes: 16384, maxLines: 100});

			expect(texts(plan)).to.deep.equal([
				["x".repeat(10), "x".repeat(10), "x".repeat(10), "y"],
			]);
			expect(rejoin(plan[0])).to.equal(text);
		});

		it("opens a new batch past max-lines", function () {
			const text = ["l0", "l1", "l2", "l3", "l4", "l5", "l6"].join("\n");
			const plan = planMultiline(text, 0, {maxBytes: 16384, maxLines: 3});

			expect(texts(plan)).to.deep.equal([["l0", "l1", "l2"], ["l3", "l4", "l5"], ["l6"]]);
		});

		it("opens a new batch past max-bytes, line feeds counted", function () {
			// "aaa" + LF + "bbb" is 7 of 8 bytes; "ccc" needs 4 more.
			expect(
				texts(planMultiline("aaa\nbbb\nccc", 0, {maxBytes: 8, maxLines: 100}))
			).to.deep.equal([["aaa", "bbb"], ["ccc"]]);
		});

		it("starts a batch with a non-concat line even mid-paragraph", function () {
			const text = "abcdef";
			const plan = planMultiline(`${text}\nz`, MAX_LINE_BYTES - 2, {
				maxBytes: 16384,
				maxLines: 2,
			});

			expect(plan).to.deep.equal([
				[
					{text: "ab", concat: false},
					{text: "cd", concat: true},
				],
				[
					{text: "ef", concat: false},
					{text: "z", concat: false},
				],
			]);
		});

		it("counts the per-line body overhead against max-bytes", function () {
			// Each \x01ACTION …\x01 costs 9 bytes the server counts too.
			expect(
				texts(planMultiline("aaa\nbbb", 0, {maxBytes: 20, maxLines: 100}, 9))
			).to.deep.equal([["aaa"], ["bbb"]]);
		});

		it("never plans a line larger than one message may be", function () {
			// The line budget is clamped to max-bytes: a chunk over it could
			// never be sent, whatever the frame allows.
			const plan = planMultiline("abcdefghij\nz", 0, {maxBytes: 4, maxLines: 100});

			expect(texts(plan)).to.deep.equal([["abcd"], ["efgh"], ["ij", "z"]]);

			for (const line of plan.flat()) {
				expect(utf8ByteLength(line.text)).to.be.at.most(4);
			}
		});
	});

	describe("sendMessage", function () {
		it("sends a multi-line message as one batch", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "one\ntwo\nthree");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline #seance",
				"@batch=m1 PRIVMSG #seance :one",
				"@batch=m1 PRIVMSG #seance :two",
				"@batch=m1 PRIVMSG #seance :three",
				"BATCH -m1",
			]);
		});

		it("puts the reply tag on the opener only", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "one\ntwo", {reply: "parent"});

			expect(transport.sent).to.deep.equal([
				"@+draft/reply=parent BATCH +m1 draft/multiline #seance",
				"@batch=m1 PRIVMSG #seance :one",
				"@batch=m1 PRIVMSG #seance :two",
				"BATCH -m1",
			]);
		});

		it("puts the edit tag on the opener of a multi-line edit", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "one\ntwo", {edit: "old"});

			expect(transport.sent[0]).to.equal(
				"@+seance/edit=old BATCH +m1 draft/multiline #seance"
			);
			expect(transport.sent[1]).to.equal("@batch=m1 PRIVMSG #seance :one");
		});

		it("tags continuation chunks with draft/multiline-concat", function () {
			const {client, transport, chanId} = setup();
			const long = Array.from({length: 200}, (_, i) => `word${i}`).join(" ");

			client.input(chanId, `${long}\ntail`);

			expect(transport.sent[0]).to.equal("BATCH +m1 draft/multiline #seance");
			expect(transport.sent[1]).to.match(/^@batch=m1 PRIVMSG #seance :word0 /);
			expect(transport.sent[2]).to.match(
				/^@batch=m1;draft\/multiline-concat PRIVMSG #seance :/
			);
			expect(transport.sent[transport.sent.length - 2]).to.equal(
				"@batch=m1 PRIVMSG #seance :tail"
			);
			expect(transport.sent[transport.sent.length - 1]).to.equal("BATCH -m1");

			for (const line of transport.sent) {
				expect(utf8ByteLength(line)).to.be.at.most(MAX_LINE_BYTES);
			}
		});

		it("opens a second batch when the message does not fit one", function () {
			const {client, transport, chanId} = setup(offering("max-bytes=16384,max-lines=2"));

			client.input(chanId, "one\ntwo\nthree");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline #seance",
				"@batch=m1 PRIVMSG #seance :one",
				"@batch=m1 PRIVMSG #seance :two",
				"BATCH -m1",
				"BATCH +m2 draft/multiline #seance",
				"@batch=m2 PRIVMSG #seance :three",
				"BATCH -m2",
			]);
		});

		it("sends one line without a batch", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "one\n");

			expect(transport.sent).to.deep.equal(["PRIVMSG #seance :one"]);
		});

		it("keeps the per-line behaviour without the capability", function () {
			const {client, transport, chanId} = setup(
				"batch message-tags server-time echo-message"
			);

			client.input(chanId, "one\ntwo\r\n\nthree");

			expect(transport.sent).to.deep.equal([
				"PRIVMSG #seance :one",
				"PRIVMSG #seance :two",
				"PRIVMSG #seance :three",
			]);
		});

		it("shows one local message when echo-message is off", function () {
			const {client, transport, chanId} = setup(
				offering("max-bytes=16384,max-lines=100", "")
			);

			client.input(chanId, "one\ntwo");

			expect(transport.sent).to.have.length(4);

			const shown = messages(chanId);
			expect(shown).to.have.length(1);
			expect(shown[0].text).to.equal("one\ntwo");
			expect(shown[0].self).to.equal(true);
			expect(shown[0].type).to.equal(MessageType.MESSAGE);
		});
	});

	describe("dispatchInput", function () {
		it("sends a multi-line action framed on every line", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/me waves\nand bows");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline #seance",
				"@batch=m1 PRIVMSG #seance :\x01ACTION waves\x01",
				"@batch=m1 PRIVMSG #seance :\x01ACTION and bows\x01",
				"BATCH -m1",
			]);
		});

		it("sends a multi-line notice as a NOTICE batch", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/notice #other one\ntwo");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline #other",
				"@batch=m1 NOTICE #other :one",
				"@batch=m1 NOTICE #other :two",
				"BATCH -m1",
			]);
		});

		it("sends a multi-line /msg to the named target", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/msg bob one\ntwo");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline bob",
				"@batch=m1 PRIVMSG bob :one",
				"@batch=m1 PRIVMSG bob :two",
				"BATCH -m1",
			]);
		});

		it("runs any other command line by line", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/away gone\n/nick bobby");

			expect(transport.sent).to.deep.equal(["AWAY :gone", "NICK bobby"]);
		});

		it("takes the command name from the first line only", function () {
			const {client, transport, chanId} = setup();

			// Regression: `/me\nwaves` must not put a line feed on the wire.
			client.input(chanId, "/me\nwaves");

			expect(transport.sent).to.deep.equal(["PRIVMSG #seance :\x01ACTION waves\x01"]);
		});

		it("takes a /msg target up to the line feed", function () {
			const {client, transport, chanId} = setup();

			// Regression: the target used to be split on spaces only, so it
			// swallowed the line feed and `formatLine` threw out of `input`.
			client.input(chanId, "/msg bob\nhello world");

			expect(transport.sent).to.deep.equal(["PRIVMSG bob :hello world"]);
		});

		it("sends a /msg whose whole body is the second line", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/msg bob\nhello");

			expect(transport.sent).to.deep.equal(["PRIVMSG bob :hello"]);
		});

		it("batches a /msg body that spans lines of its own", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/msg bob\none\ntwo");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline bob",
				"@batch=m1 PRIVMSG bob :one",
				"@batch=m1 PRIVMSG bob :two",
				"BATCH -m1",
			]);
		});

		it("opens a /query for the target alone, never the whole line", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/query bob\nhello world");

			expect(transport.sent).to.deep.equal(["PRIVMSG bob :hello world"]);
			expect(client.channels.map((c) => c.name)).to.include("bob");
			expect(
				client.channels.every((c) => !/[\s]/.test(c.name)),
				"no garbage channel"
			).to.equal(true);
		});

		it("takes a /notice target up to the line feed", function () {
			const {client, transport, chanId} = setup();

			client.input(chanId, "/notice #other\nhello");

			expect(transport.sent).to.deep.equal(["NOTICE #other :hello"]);
		});

		it("puts the edit tag on the first opener only", function () {
			const {client, transport, chanId} = setup(offering("max-bytes=16384,max-lines=2"));

			// One edit replaces one message: the second batch is a new one.
			client.input(chanId, "one\ntwo\nthree", {edit: "old", reply: "parent"});

			expect(transport.sent[0]).to.equal(
				"@+seance/edit=old;+draft/reply=parent BATCH +m1 draft/multiline #seance"
			);
			expect(transport.sent[4]).to.equal(
				"@+draft/reply=parent BATCH +m2 draft/multiline #seance"
			);
		});

		it("synthesises one action per batch without echo-message", function () {
			const {client, transport, chanId} = setup(offering("max-bytes=16384,max-lines=2", ""));

			client.input(chanId, "/me one\ntwo\nthree");

			expect(transport.sent).to.deep.equal([
				"BATCH +m1 draft/multiline #seance",
				"@batch=m1 PRIVMSG #seance :\x01ACTION one\x01",
				"@batch=m1 PRIVMSG #seance :\x01ACTION two\x01",
				"BATCH -m1",
				"BATCH +m2 draft/multiline #seance",
				"@batch=m2 PRIVMSG #seance :\x01ACTION three\x01",
				"BATCH -m2",
			]);

			const shown = messages(chanId);
			expect(shown.map((m) => m.text)).to.deep.equal(["one\ntwo", "three"]);
			expect(shown.every((m) => m.type === MessageType.ACTION)).to.equal(true);
			expect(shown.every((m) => m.self === true)).to.equal(true);
		});
	});
});
