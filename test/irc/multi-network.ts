import {expect} from "chai";
import sinon from "ts-sinon";
import socket from "../../client/js/socket";
import {IrcClient, IrcClientOptions} from "../../client/js/irc/client";
import {IdAllocator} from "../../client/js/irc/ids";
import {ClientRegistry, registerBusHandlers} from "../../client/js/irc/bus";
import * as saved from "../../client/js/irc/saved-networks";
import type {SavedNetwork, StorageBackend} from "../../client/js/irc/saved-networks";
import type {Transport} from "../../client/js/irc/types";
import type {TransportEvent, TransportState} from "../../client/js/irc/transport";
import type {SharedNetwork} from "../../shared/types/network";

/** In-memory transport driven by the tests (same shape as test/irc/client.ts). */
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

	lines(...lines: string[]): void {
		lines.forEach((line) => this.emit({type: "line", line}));
	}

	closed(code = 1006, reason = ""): void {
		this.state = "closed";
		this.emit({type: "close", code, reason, wasClean: false, willReconnect: false});
	}

	private emit(ev: TransportEvent): void {
		for (const listener of [...this.listeners]) {
			listener(ev);
		}
	}
}

class MemoryBackend implements StorageBackend {
	data = new Map<string, string>();
	get(key: string): string | null {
		return this.data.get(key) ?? null;
	}
	set(key: string, value: string): void {
		this.data.set(key, value);
	}
	remove(key: string): void {
		this.data.delete(key);
	}
}

/**
 * A stand-in for `manager.ts` (which imports the store and so cannot load
 * under mocha): the same Map-keyed registry with a shared id allocator and
 * `networksForInit` spanning every live client.
 */
class FakeManager implements ClientRegistry {
	clients = new Map<string, IrcClient>();
	transports = new Map<string, FakeTransport>();
	ids = new IdAllocator();
	removed: string[] = [];

	createNetwork(options: Partial<IrcClientOptions> & {uuid: string; nick: string}): IrcClient {
		const transport = new FakeTransport();
		const client = new IrcClient({
			host: `${options.uuid}.test`,
			port: 8443,
			tls: true,
			join: "",
			sasl: "",
			saslAccount: "",
			saslPassword: "",
			ids: this.ids,
			transportFactory: () => transport,
			networksForInit: () => Array.from(this.clients.values()).map((c) => c.network),
			...options,
		});
		this.clients.set(client.uuid, client);
		this.transports.set(client.uuid, transport);
		client.connect();
		return client;
	}

	clientForNetwork(uuid: string): IrcClient | undefined {
		return this.clients.get(uuid);
	}

	clientForChannel(chanId: number): IrcClient | undefined {
		for (const client of this.clients.values()) {
			if (client.channelById(chanId)) {
				return client;
			}
		}

		return undefined;
	}

	allClients(): IrcClient[] {
		return Array.from(this.clients.values());
	}

	remove(uuid: string): void {
		this.removed.push(uuid);
		this.clients.delete(uuid);
	}

	transportOf(client: IrcClient): FakeTransport {
		return this.transports.get(client.uuid) as FakeTransport;
	}
}

let dispatch: sinon.SinonSpy;
/** Whether this file installed the spy (test/irc/client.ts has a root-level one). */
let ownsSpy = false;
let manager: FakeManager;
let backend: MemoryBackend;

function setUp(): void {
	const current = (socket as unknown as Record<string, unknown>).dispatch;

	if ((current as {isSinonProxy?: boolean}).isSinonProxy) {
		dispatch = current as sinon.SinonSpy;
		ownsSpy = false;
	} else {
		dispatch = sinon.spy(socket, "dispatch");
		ownsSpy = true;
	}

	manager = new FakeManager();
	backend = new MemoryBackend();
	saved.useStorageBackend(backend);
	registerBusHandlers(socket, manager);
}

function tearDown(): void {
	if (ownsSpy) {
		dispatch.restore();
	}

	socket.removeAllListeners();
	saved.useStorageBackend(null);
}

function payloads<T = any>(event: string): T[] {
	return dispatch
		.getCalls()
		.filter((call) => call.args[0] === event)
		.map((call) => call.args[1] as T);
}

/** Drive one client through CAP / 001 / 005 / 422 as `nick`. */
function register(client: IrcClient): void {
	const transport = manager.transportOf(client);
	const nick = client.nick;
	transport.open();
	transport.lines(`:irc.test CAP * LS :multi-prefix echo-message server-time`);
	const req = transport.sent.find((l) => l.startsWith("CAP REQ :")) as string;
	transport.lines(`:irc.test CAP ${nick} ACK :${req.slice("CAP REQ :".length)}`);
	transport.lines(
		`:irc.test 001 ${nick} :Welcome, ${nick}`,
		`:irc.test 005 ${nick} CHANTYPES=#& PREFIX=(ov)@+ NETWORK=${client.uuid.toUpperCase()} :are supported`,
		`:irc.test 422 ${nick} :MOTD File is missing`
	);
}

function joined(client: IrcClient, channel: string): number {
	const transport = manager.transportOf(client);
	const nick = client.nick;
	transport.lines(
		`:${nick}!${nick}@host JOIN ${channel}`,
		`:irc.test 353 ${nick} = ${channel} :@${nick} bob`,
		`:irc.test 366 ${nick} ${channel} :End of /NAMES list.`
	);
	return client.findChannel(channel)!.id;
}

describe("multiple networks", function () {
	beforeEach(setUp);
	afterEach(tearDown);

	it("keeps both networks in every init and allocates unique channel ids", function () {
		const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
		const b = manager.createNetwork({uuid: "net-b", nick: "alice", join: "#two"});

		const announced = payloads<{network: SharedNetwork}>("network");
		expect(announced.map((p) => p.network.uuid)).to.deep.equal(["net-a", "net-b"]);

		register(a);
		let inits = payloads<{active: number; networks: SharedNetwork[]}>("init");
		expect(inits).to.have.length(1);
		expect(inits[0].networks.map((n) => n.uuid)).to.deep.equal(["net-a", "net-b"]);
		expect(inits[0].networks[0].status.connected).to.equal(true);
		expect(inits[0].networks[1].status.connected).to.equal(false);

		register(b);
		inits = payloads("init");
		expect(inits).to.have.length(2);
		expect(inits[1].networks.map((n) => n.uuid)).to.deep.equal(["net-a", "net-b"]);
		expect(inits[1].networks.every((n) => n.status.connected)).to.equal(true);
		expect(inits[1].networks.map((n) => n.name)).to.deep.equal(["NET-A", "NET-B"]);

		const ids = inits[1].networks.flatMap((n) => n.channels.map((c) => c.id));
		expect(new Set(ids).size).to.equal(ids.length);
		expect(inits[1].active).to.equal(b.findChannel("#two")!.id);

		const status = payloads<{network: string; connected: boolean}>("network:status");
		expect(status).to.deep.include({network: "net-a", connected: true, secure: true});
		expect(status).to.deep.include({network: "net-b", connected: true, secure: true});
	});

	it("routes input, names, more and open by channel id to the owning client", function () {
		const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
		const b = manager.createNetwork({uuid: "net-b", nick: "alice", join: "#two"});
		register(a);
		register(b);
		const one = joined(a, "#one");
		const two = joined(b, "#two");
		const ta = manager.transportOf(a);
		const tb = manager.transportOf(b);
		const sentA = ta.sent.length;
		const sentB = tb.sent.length;

		socket.emit("input", {target: two, text: "hello two"});
		expect(tb.sent.slice(sentB)).to.deep.equal(["PRIVMSG #two :hello two"]);
		expect(ta.sent).to.have.length(sentA);

		socket.emit("input", {target: one, text: "/nick alice1"});
		expect(ta.sent.slice(sentA)).to.deep.equal(["NICK alice1"]);
		expect(tb.sent).to.have.length(sentB + 1);

		socket.emit("names", {target: two});
		const [names] = payloads<{id: number; users: {nick: string}[]}>("names");
		expect(names.id).to.equal(two);
		expect(names.users.map((u) => u.nick)).to.deep.equal(["alice", "bob"]);

		socket.emit("more", {target: one, lastId: -1, condensed: false});
		expect(payloads<{chan: number}>("more")[0].chan).to.equal(one);

		// Unread counting follows the open channel across networks.
		ta.lines(":bob!bob@host PRIVMSG #one :ping a");
		tb.lines(":bob!bob@host PRIVMSG #two :ping b");
		expect(a.findChannel("#one")!.shared.unread).to.equal(1);
		expect(b.findChannel("#two")!.shared.unread).to.equal(1);
		socket.emit("open", two);
		expect(b.findChannel("#two")!.shared.unread).to.equal(0);
		expect(a.findChannel("#one")!.shared.unread).to.equal(1);
		tb.lines(":bob!bob@host PRIVMSG #two :ping b again");
		expect(b.findChannel("#two")!.shared.unread).to.equal(0);
	});

	it("quitting one network leaves the other untouched", function () {
		const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
		const b = manager.createNetwork({uuid: "net-b", nick: "alice", join: "#two"});
		register(a);
		register(b);
		const one = joined(a, "#one");
		const two = joined(b, "#two");
		const ta = manager.transportOf(a);
		const tb = manager.transportOf(b);

		socket.emit("input", {target: two, text: "/quit bye"});
		expect(payloads<{network: string}>("quit")).to.deep.equal([{network: "net-b"}]);
		expect(manager.removed).to.deep.equal(["net-b"]);
		expect(tb.sent[tb.sent.length - 1]).to.equal("QUIT :bye");
		expect(tb.closeCalls).to.equal(1);
		tb.closed(1000);

		expect(ta.closeCalls).to.equal(0);
		expect(a.isConnected).to.equal(true);
		expect(a.findChannel("#one")!.users.size).to.equal(2);
		expect(manager.clientForChannel(one)).to.equal(a);
		expect(manager.clientForChannel(two)).to.equal(undefined);

		const statuses = payloads<{network: string; connected: boolean}>("network:status");
		expect(statuses.filter((s) => s.network === "net-a" && !s.connected)).to.have.length(0);

		// A later (re)registration of the survivor no longer mentions the quitter.
		ta.closed(1006, "gone");
		register(a);
		const inits = payloads<{networks: SharedNetwork[]}>("init");
		expect(inits[inits.length - 1].networks.map((n) => n.uuid)).to.deep.equal(["net-a"]);
	});

	it("a dropped connection only affects its own network", function () {
		const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
		const b = manager.createNetwork({uuid: "net-b", nick: "alice", join: "#two"});
		register(a);
		register(b);
		joined(a, "#one");
		const two = joined(b, "#two");

		manager.transportOf(a).closed(1006, "connection reset");

		expect(a.isConnected).to.equal(false);
		expect(a.findChannel("#one")!.users.size).to.equal(0);
		expect(b.isConnected).to.equal(true);
		expect(b.findChannel("#two")!.users.size).to.equal(2);

		const down = payloads<{network: string; connected: boolean}>("network:status").filter(
			(s) => !s.connected
		);
		expect(down).to.deep.equal([{network: "net-a", connected: false, secure: true}]);
		expect(manager.clientForNetwork("net-a")).to.equal(a);

		socket.emit("input", {target: two, text: "still here"});
		const tb = manager.transportOf(b);
		expect(tb.sent[tb.sent.length - 1]).to.equal("PRIVMSG #two :still here");
	});

	describe("network:get / network:edit against the saved store", function () {
		function stored(overrides: Partial<SavedNetwork> = {}): SavedNetwork {
			return saved.save({
				uuid: "net-a",
				name: "",
				host: "net-a.test",
				port: 8443,
				tls: true,
				nick: "alice",
				join: "#one",
				sasl: "plain",
				saslAccount: "alice",
				saslPassword: "pw",
				rememberPassword: true,
				commands: ["/msg NickServ IDENTIFY pw"],
				...overrides,
			});
		}

		it("merges the saved entry with live state for network:get", function () {
			stored({name: "Home"});
			const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
			register(a);
			manager.transportOf(a).lines(":alice!alice@host NICK :alice_");

			socket.emit("network:get", "net-a");
			const [info] = payloads<Record<string, unknown>>("network:info");
			expect(info).to.include({
				uuid: "net-a",
				name: "Home",
				nick: "alice_",
				host: "net-a.test",
				sasl: "plain",
				saslAccount: "alice",
				saslPassword: "pw",
				connected: true,
			});
			expect(info.commands).to.deep.equal(["/msg NickServ IDENTIFY pw"]);
		});

		it("answers network:get for a saved network that is not live, and stays silent for unknown ones", function () {
			stored();
			socket.emit("network:get", "net-a");
			socket.emit("network:get", "nope");

			const infos = payloads<Record<string, unknown>>("network:info");
			expect(infos).to.have.length(1);
			expect(infos[0]).to.include({uuid: "net-a", host: "net-a.test", connected: false});
		});

		it("network:edit saves, sends NICK when connected and renames live", function () {
			stored();
			const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
			register(a);
			const ta = manager.transportOf(a);
			const mark = ta.sent.length;

			socket.emit("network:edit", {
				uuid: "net-a",
				name: "Home",
				host: "new.test",
				port: "8067",
				nick: "alice2",
				join: "#one, #two",
				sasl: "plain",
				saslAccount: "alice",
				saslPassword: "",
				commands: "/join #late",
				rememberPassword: "on",
			});

			expect(ta.sent.slice(mark)).to.deep.equal(["NICK alice2"]);
			expect(a.name).to.equal("Home");
			expect(payloads<{uuid: string; name: string}>("network:name")).to.deep.include({
				uuid: "net-a",
				name: "Home",
			});

			const entry = saved.get("net-a");
			expect(entry).to.include({
				name: "Home",
				host: "new.test",
				port: 8067,
				tls: false,
				nick: "alice2",
				join: "#one, #two",
				saslPassword: "pw",
			});
			expect(entry?.commands).to.deep.equal(["/join #late"]);

			const infos = payloads<Record<string, unknown>>("network:info");
			expect(infos[infos.length - 1]).to.include({uuid: "net-a", name: "Home"});
		});

		it("network:edit applies the nick locally when disconnected and seeds unsaved networks", function () {
			const a = manager.createNetwork({uuid: "net-a", nick: "alice", join: "#one"});
			expect(saved.get("net-a")).to.equal(undefined);

			socket.emit("network:edit", {uuid: "net-a", nick: "alice3", host: "net-a.test"});

			expect(a.nick).to.equal("alice3");
			expect(payloads<{network: string; nick: string}>("nick")).to.deep.include({
				network: "net-a",
				nick: "alice3",
			});
			expect(saved.get("net-a")).to.include({host: "net-a.test", nick: "alice3", tls: false});

			socket.emit("network:edit", {uuid: "unknown", nick: "x"});
			expect(saved.get("unknown")).to.equal(undefined);
		});
	});
});
