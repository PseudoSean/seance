import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {joinMultiline, parseMultilineValue} from "../../client/js/irc/multiline";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {IrcMessage, parseLine} from "../../client/js/irc/message";
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

		it("rejects a value missing either number", function () {
			expect(parseMultilineValue("max-bytes=16384")).to.equal(undefined);
			expect(parseMultilineValue("max-lines=100")).to.equal(undefined);
			expect(parseMultilineValue("")).to.equal(undefined);
			expect(parseMultilineValue(undefined)).to.equal(undefined);
		});

		it("rejects zero, negative and non-numeric limits", function () {
			expect(parseMultilineValue("max-bytes=0,max-lines=100")).to.equal(undefined);
			expect(parseMultilineValue("max-bytes=16384,max-lines=0")).to.equal(undefined);
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
				"batch message-tags server-time draft/multiline=max-bytes=16384"
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
			const {client, transport, chanId} = setup();

			expect(messages(chanId)).to.have.length(0);
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
