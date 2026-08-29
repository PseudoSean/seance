import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {parseMultilineValue} from "../../client/js/irc/multiline";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {SharedMsg} from "../../shared/types/msg";

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
