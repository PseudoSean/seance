/**
 * IrcClient + SASL: the CAP REQ/ACK → AUTHENTICATE → CAP END wiring. The
 * pure state machine is covered in test/irc/sasl.ts.
 */
import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient, IrcClientOptions} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {encodePlain, SASL_TIMEOUT_MS} from "../../client/js/irc/sasl";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import {MessageType, SharedMsg} from "../../shared/types/msg";

/** Minimal in-memory transport: only what registration and line feeding need. */
class FakeTransport implements Transport {
	state: TransportState = "closed";
	sent: string[] = [];
	closeCalls = 0;
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
		if (this.state !== "open") {
			throw new Error("WsTransport: not open");
		}

		this.sent.push(line);
	}

	close(): void {
		this.closeCalls++;
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

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

const OFFERED_CAPS = "multi-prefix account-notify cap-notify server-time echo-message message-tags";

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

function errors(chanId: number): string[] {
	return messages(chanId)
		.filter((m) => m.type === MessageType.ERROR)
		.map((m) => m.text ?? "");
}

function setup(overrides: Partial<IrcClientOptions> = {}): {
	client: IrcClient;
	transport: FakeTransport;
} {
	const transport = new FakeTransport();
	const client = new IrcClient({
		host: "irc.test",
		port: 8443,
		tls: true,
		nick: "alice",
		join: "",
		sasl: "plain",
		saslAccount: "alice",
		saslPassword: "s3cret",
		ids: new IdAllocator(),
		transportFactory: () => transport,
		highlights: () => ({keywords: [], exceptions: []}),
		...overrides,
	});
	client.connect();
	transport.open();
	return {client, transport};
}

/** Send the LS, answer our REQ with an ACK, and return the requested cap names. */
function offer(transport: FakeTransport, offered: string): string[] {
	transport.line(`:irc.test CAP * LS :${offered}`);
	const req = transport.sent.find((l) => l.startsWith("CAP REQ :"));
	expect(req, "CAP REQ sent").to.be.a("string");
	const names = (req as string).slice("CAP REQ :".length).split(" ");
	transport.line(`:irc.test CAP alice ACK :${names.join(" ")}`);
	return names;
}

function finishRegistration(transport: FakeTransport): void {
	transport.lines(
		":irc.test 001 alice :Welcome to the SeanceDev IRC Network, alice",
		":irc.test 005 alice NETWORK=SeanceDev CASEMAPPING=rfc1459 :are supported by this server",
		":irc.test 422 alice :MOTD File is missing"
	);
}

describe("IrcClient SASL", function () {
	beforeEach(installSpy);
	afterEach(removeSpy);

	it("requests sasl, authenticates with PLAIN and then sends CAP END", function () {
		const {client, transport} = setup();
		const requested = offer(transport, `${OFFERED_CAPS} sasl=PLAIN,EXTERNAL`);

		expect(requested).to.include("sasl");
		expect(transport.sent).to.not.include("CAP END");
		expect(transport.sent[transport.sent.length - 1]).to.equal("AUTHENTICATE PLAIN");
		expect(client.sasl).to.not.equal(null);

		transport.line("AUTHENTICATE +");
		expect(transport.sent[transport.sent.length - 1]).to.equal(
			`AUTHENTICATE ${encodePlain("alice", "s3cret")}`
		);
		expect(transport.sent).to.not.include("CAP END");

		transport.lines(
			":irc.test 900 alice alice!alice@host alice :You are now logged in as alice",
			":irc.test 903 alice :SASL authentication successful"
		);
		expect(transport.sent[transport.sent.length - 1]).to.equal("CAP END");
		expect(transport.sent.filter((l) => l === "CAP END")).to.have.length(1);
		expect(client.sasl).to.equal(null);
		expect(client.account).to.equal("alice");
		expect(errors(client.lobby.id)).to.deep.equal([]);
		expect(messages(client.lobby.id).map((m) => m.text)).to.include(
			"You are now logged in as alice"
		);

		finishRegistration(transport);
		expect(client.isConnected).to.equal(true);
	});

	it("reports a 904 in the lobby and still completes registration", function () {
		const {client, transport} = setup();
		offer(transport, `${OFFERED_CAPS} sasl=PLAIN`);
		transport.line("AUTHENTICATE +");
		transport.line(":irc.test 904 alice :SASL authentication failed");

		expect(errors(client.lobby.id)).to.deep.equal([
			"SASL authentication failed: SASL authentication failed",
		]);
		expect(transport.sent[transport.sent.length - 1]).to.equal("CAP END");
		expect(transport.closeCalls).to.equal(0);
		expect(client.account).to.equal("");

		finishRegistration(transport);
		expect(client.isConnected).to.equal(true);
		expect(client.state).to.equal("registered");
	});

	it("disconnects on failure when saslDisconnectOnFail is set", function () {
		const {client, transport} = setup({saslDisconnectOnFail: true});
		offer(transport, `${OFFERED_CAPS} sasl=PLAIN`);
		transport.line("AUTHENTICATE +");
		transport.line(":irc.test 904 alice :SASL authentication failed");

		expect(errors(client.lobby.id)).to.have.length(1);
		expect(transport.sent).to.not.include("CAP END");
		expect(transport.sent[transport.sent.length - 1]).to.equal(
			"QUIT :SASL authentication failed"
		);
		expect(transport.closeCalls).to.equal(1);
		expect(client.isQuitting).to.equal(true);
	});

	it("skips SASL silently when the server does not offer the cap", function () {
		const {client, transport} = setup();
		const requested = offer(transport, OFFERED_CAPS);

		expect(requested).to.not.include("sasl");
		expect(transport.sent).to.not.include("AUTHENTICATE PLAIN");
		expect(transport.sent[transport.sent.length - 1]).to.equal("CAP END");
		expect(client.sasl).to.equal(null);
		expect(messages(client.lobby.id).some((m) => /SASL/i.test(m.text ?? ""))).to.equal(false);

		finishRegistration(transport);
		expect(client.isConnected).to.equal(true);
	});

	it("does not request sasl when PLAIN is not among the advertised mechanisms", function () {
		const {transport} = setup();
		const requested = offer(transport, `${OFFERED_CAPS} sasl=EXTERNAL`);

		expect(requested).to.not.include("sasl");
		expect(transport.sent[transport.sent.length - 1]).to.equal("CAP END");
	});

	it("requests sasl when the cap has no value (no CAP 302)", function () {
		const {transport} = setup();
		const requested = offer(transport, `${OFFERED_CAPS} sasl`);

		expect(requested).to.include("sasl");
		expect(transport.sent[transport.sent.length - 1]).to.equal("AUTHENTICATE PLAIN");
	});

	it("does not touch SASL when no account is configured", function () {
		const {transport} = setup({sasl: "", saslAccount: "", saslPassword: ""});
		const requested = offer(transport, `${OFFERED_CAPS} sasl=PLAIN`);

		expect(requested).to.not.include("sasl");
		expect(transport.sent[transport.sent.length - 1]).to.equal("CAP END");
	});

	it("pipelines AUTHENTICATE behind the REQ, and aborts to CAP END when the server NAKs sasl", function () {
		const {client, transport} = setup();
		transport.line(`:irc.test CAP * LS :${OFFERED_CAPS} sasl=PLAIN`);
		const req = transport.sent.find((l) => l.startsWith("CAP REQ :")) as string;
		const names = req.slice("CAP REQ :".length).split(" ");
		// The opener goes out with the REQ: no round trip waiting for the ACK.
		expect(transport.sent[transport.sent.indexOf(req) + 1]).to.equal("AUTHENTICATE PLAIN");
		expect(client.sasl).to.not.equal(null);

		// A NAKed multi-cap REQ is retried one cap at a time...
		transport.line(`:irc.test CAP alice NAK :${names.join(" ")}`);
		expect(transport.sent.filter((l) => l === "CAP REQ :sasl")).to.have.length(1);
		expect(transport.sent).to.not.include("CAP END");

		// ...and a NAK of `sasl` itself ends the exchange.
		transport.line(":irc.test CAP alice NAK :sasl");
		expect(transport.sent.slice(-2)).to.deep.equal(["AUTHENTICATE *", "CAP END"]);
		expect(client.sasl).to.equal(null);
	});

	it("aborts with AUTHENTICATE * after the timeout and continues", function () {
		const clock = sinon.useFakeTimers();

		try {
			const {client, transport} = setup();
			offer(transport, `${OFFERED_CAPS} sasl=PLAIN`);
			expect(transport.sent[transport.sent.length - 1]).to.equal("AUTHENTICATE PLAIN");

			clock.tick(SASL_TIMEOUT_MS + 1);

			expect(transport.sent.slice(-2)).to.deep.equal(["AUTHENTICATE *", "CAP END"]);
			expect(client.sasl).to.equal(null);
			expect(errors(client.lobby.id)).to.deep.equal([
				"SASL authentication failed: timed out waiting for the server",
			]);

			// The server's answer to our abort is shown but does not resend CAP END.
			transport.line(":irc.test 906 alice :SASL authentication aborted");
			expect(transport.sent.filter((l) => l === "CAP END")).to.have.length(1);
			expect(errors(client.lobby.id)).to.have.length(2);

			finishRegistration(transport);
			expect(client.isConnected).to.equal(true);
		} finally {
			clock.restore();
		}
	});

	it("does not fire the timeout once the exchange completed", function () {
		const clock = sinon.useFakeTimers();

		try {
			const {client, transport} = setup();
			offer(transport, `${OFFERED_CAPS} sasl=PLAIN`);
			transport.line("AUTHENTICATE +");
			transport.line(":irc.test 903 alice :SASL authentication successful");
			const sentBefore = transport.sent.length;

			clock.tick(SASL_TIMEOUT_MS * 2);

			expect(transport.sent).to.have.length(sentBefore);
			expect(errors(client.lobby.id)).to.deep.equal([]);
		} finally {
			clock.restore();
		}
	});

	it("tracks 901 (logged out) after registration", function () {
		const {client, transport} = setup();
		offer(transport, `${OFFERED_CAPS} sasl=PLAIN`);
		transport.line("AUTHENTICATE +");
		transport.lines(
			":irc.test 900 alice alice!alice@host alice :You are now logged in as alice",
			":irc.test 903 alice :SASL authentication successful"
		);
		finishRegistration(transport);
		expect(client.account).to.equal("alice");

		transport.line(":irc.test 901 alice alice!alice@host :You are now logged out");
		expect(client.account).to.equal("");
		expect(messages(client.lobby.id).map((m) => m.text)).to.include("You are now logged out");
	});

	it("EXTERNAL stub sends AUTHENTICATE EXTERNAL and an empty response", function () {
		const {transport} = setup({sasl: "external", saslAccount: "", saslPassword: ""});
		const requested = offer(transport, `${OFFERED_CAPS} sasl=PLAIN,EXTERNAL`);

		expect(requested).to.include("sasl");
		expect(transport.sent[transport.sent.length - 1]).to.equal("AUTHENTICATE EXTERNAL");
		transport.line("AUTHENTICATE +");
		expect(transport.sent[transport.sent.length - 1]).to.equal("AUTHENTICATE +");
	});
});
