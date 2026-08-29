import {expect} from "chai";
import * as saved from "../../client/js/irc/saved-networks";
import type {SavedNetwork, StorageBackend} from "../../client/js/irc/saved-networks";

/** In-memory stand-in for the localStorage wrapper. */
class MemoryBackend implements StorageBackend {
	data = new Map<string, string>();

	get(key: string): string | null {
		return this.data.has(key) ? (this.data.get(key) as string) : null;
	}

	set(key: string, value: string): void {
		this.data.set(key, value);
	}

	remove(key: string): void {
		this.data.delete(key);
	}
}

function entry(overrides: Partial<SavedNetwork> = {}): SavedNetwork {
	return {
		uuid: "11111111-1111-4111-8111-111111111111",
		name: "",
		host: "irc.example.org",
		port: 8443,
		tls: true,
		nick: "alice",
		join: "#seance",
		sasl: "",
		saslAccount: "",
		saslPassword: "",
		...overrides,
	};
}

describe("saved-networks", function () {
	let backend: MemoryBackend;

	beforeEach(function () {
		backend = new MemoryBackend();
		saved.useStorageBackend(backend);
	});

	afterEach(function () {
		saved.useStorageBackend(null);
	});

	it("starts empty and tolerates missing storage", function () {
		expect(saved.list()).to.deep.equal([]);
		expect(saved.get("nope")).to.equal(undefined);
		expect(saved.lastUsed()).to.equal(undefined);

		saved.useStorageBackend(null); // real wrapper; no window under mocha
		expect(saved.list()).to.deep.equal([]);
	});

	it("saves and reads back an entry under thelounge.networks", function () {
		saved.save(entry());

		const raw = JSON.parse(backend.get(saved.STORAGE_KEY) as string);
		expect(raw).to.be.an("array").with.length(1);
		expect(raw[0]).to.include({uuid: entry().uuid, host: "irc.example.org", nick: "alice"});

		const stored = saved.get(entry().uuid);
		expect(stored).to.include({
			host: "irc.example.org",
			port: 8443,
			tls: true,
			nick: "alice",
			join: "#seance",
			sasl: "",
			autoconnect: false,
			rememberPassword: false,
		});
		expect(stored?.commands).to.deep.equal([]);
	});

	it("never persists the SASL password unless rememberPassword is set", function () {
		const net = entry({sasl: "plain", saslAccount: "alice", saslPassword: "hunter2"});
		const returned = saved.save(net);

		expect(returned.saslPassword).to.equal("");
		expect(saved.get(net.uuid)?.saslPassword).to.equal("");
		expect(backend.get(saved.STORAGE_KEY)).to.not.include("hunter2");

		saved.save({...net, rememberPassword: true});
		expect(saved.get(net.uuid)?.saslPassword).to.equal("hunter2");
		expect(saved.get(net.uuid)?.rememberPassword).to.equal(true);
	});

	it("drops SASL fields when sasl is off", function () {
		saved.save(entry({sasl: "", saslAccount: "x", saslPassword: "y", rememberPassword: true}));
		expect(saved.get(entry().uuid)).to.include({saslAccount: "", saslPassword: ""});
	});

	it("updates in place by uuid and keeps lastUsed", function () {
		saved.save(entry());
		saved.touchLastUsed(entry().uuid, 1000);
		saved.save(entry({nick: "alice2", name: "Home"}));

		expect(saved.list()).to.have.length(1);
		expect(saved.get(entry().uuid)).to.include({nick: "alice2", name: "Home", lastUsed: 1000});
	});

	it("keeps the catch-up cursor across saves and drops it with the entry", function () {
		saved.save(entry());
		saved.setCursor(entry().uuid, {msgid: "abc123", time: 1700});
		expect(saved.get(entry().uuid)?.cursor).to.deep.equal({msgid: "abc123", time: 1700});

		// An edit that knows nothing about the cursor must not lose it.
		saved.save(entry({name: "Home"}));
		expect(saved.get(entry().uuid)?.cursor).to.deep.equal({msgid: "abc123", time: 1700});

		// Junk in storage is dropped, and a missing time is 0.
		expect(saved.normalize({...entry(), cursor: {msgid: "", time: 5}})?.cursor).to.equal(
			undefined
		);
		expect(saved.normalize({...entry(), cursor: "nope"})?.cursor).to.equal(undefined);
		expect(saved.normalize({...entry(), cursor: {msgid: "x"}})?.cursor).to.deep.equal({
			msgid: "x",
			time: 0,
		});

		saved.setCursor("unknown", {msgid: "z", time: 1}); // no throw, no entry
		saved.remove(entry().uuid);
		expect(saved.get(entry().uuid)).to.equal(undefined);
	});

	it("removes entries", function () {
		saved.save(entry());
		saved.save(entry({uuid: "22222222-2222-4222-8222-222222222222", host: "other.example"}));
		saved.remove(entry().uuid);

		expect(saved.list().map((n) => n.host)).to.deep.equal(["other.example"]);
		saved.remove("unknown"); // no throw
		expect(saved.list()).to.have.length(1);
	});

	it("orders the list by recency and reports the last-used entry", function () {
		const a = entry({uuid: "a0000000-0000-4000-8000-000000000000", name: "Alpha"});
		const b = entry({uuid: "b0000000-0000-4000-8000-000000000000", name: "Beta"});
		const c = entry({uuid: "c0000000-0000-4000-8000-000000000000", name: "Gamma"});
		saved.save(c);
		saved.save(b);
		saved.save(a);

		// Never used: alphabetical by display name.
		expect(saved.list().map((n) => n.name)).to.deep.equal(["Alpha", "Beta", "Gamma"]);
		expect(saved.lastUsed()).to.equal(undefined);

		saved.touchLastUsed(b.uuid, 10);
		saved.touchLastUsed(c.uuid, 20);
		expect(saved.list().map((n) => n.name)).to.deep.equal(["Gamma", "Beta", "Alpha"]);
		expect(saved.lastUsed()?.uuid).to.equal(c.uuid);
	});

	it("finds an existing entry for the same host, port and nick", function () {
		saved.save(entry());

		expect(saved.findMatching("IRC.Example.org", 8443, "Alice")?.uuid).to.equal(entry().uuid);
		expect(saved.findMatching("wss://irc.example.org/ws", 8443, "alice")?.uuid).to.equal(
			entry().uuid
		);
		expect(saved.findMatching("irc.example.org", 8067, "alice")).to.equal(undefined);
		expect(saved.findMatching("irc.example.org", 8443, "bob")).to.equal(undefined);
	});

	it("generates stable, unique v4 uuids", function () {
		const a = saved.newUuid();
		const b = saved.newUuid();

		expect(a).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(a).to.not.equal(b);

		saved.save(entry({uuid: a}));
		expect(saved.get(a)?.uuid).to.equal(a);
	});

	it("normalizes the edit form's FormData-style payload", function () {
		const existing = saved.save(
			entry({sasl: "plain", saslAccount: "alice", saslPassword: "pw", rememberPassword: true})
		);

		const next = saved.fromForm(
			{
				uuid: existing.uuid,
				name: " Home ",
				host: "irc.example.org",
				port: "8067",
				nick: "alice",
				join: "#a, #b key",
				sasl: "plain",
				saslAccount: "alice",
				saslPassword: "",
				commands: "/msg NickServ IDENTIFY x\r\n\n  /join #late  ",
				rememberPassword: "on",
				// tls and autoconnect omitted: unchecked boxes are absent from FormData
			},
			existing
		);

		expect(next).to.include({
			name: "Home",
			port: 8067,
			tls: false,
			autoconnect: false,
			rememberPassword: true,
			join: "#a, #b key",
			saslPassword: "pw", // blank field keeps the stored password
		});
		expect(next.commands).to.deep.equal(["/msg NickServ IDENTIFY x", "/join #late"]);

		expect(() => saved.fromForm({name: "no uuid"})).to.throw(/uuid/);
	});

	it("coerces loose values and falls back to the default port", function () {
		const net = saved.normalize({
			uuid: "x",
			host: " irc.example.org ",
			port: "not a port",
			tls: "false",
			nick: 42,
			sasl: "external",
			commands: ["/a", "", " /b "],
			lastUsed: "yesterday",
		});

		expect(net).to.include({
			host: "irc.example.org",
			port: 8067,
			tls: false,
			nick: "42",
			sasl: "",
		});
		expect(net?.commands).to.deep.equal(["/a", "/b"]);
		expect(net?.lastUsed).to.equal(undefined);
		expect(saved.normalize({host: "irc.example.org"})).to.equal(undefined);
		expect(saved.defaultPort(true)).to.equal(8443);
	});

	it("ignores corrupt or malformed storage", function () {
		backend.set(saved.STORAGE_KEY, "{not json");
		expect(saved.list()).to.deep.equal([]);
		expect(backend.get(saved.STORAGE_KEY)).to.equal(null);

		backend.set(saved.STORAGE_KEY, JSON.stringify({uuid: "not-an-array"}));
		expect(saved.list()).to.deep.equal([]);

		backend.set(
			saved.STORAGE_KEY,
			JSON.stringify([null, 7, {uuid: "no-host"}, entry(), entry({nick: "dupe"})])
		);
		expect(saved.list().map((n) => n.nick)).to.deep.equal(["alice"]);
	});

	it("strips saved-only fields for the IRC client", function () {
		const opts = saved.toConnectOptions(
			entry({name: "Home", autoconnect: true, commands: ["/x"], lastUsed: 1})
		);

		expect(Object.keys(opts).sort()).to.deep.equal([
			"host",
			"join",
			"nick",
			"port",
			"sasl",
			"saslAccount",
			"saslPassword",
			"tls",
		]);
		expect(saved.displayName(entry())).to.equal("irc.example.org");
		expect(saved.displayName(entry({name: "Home"}))).to.equal("Home");
		expect(saved.displayName({name: "", host: "wss://h.example/ws"})).to.equal("h.example");
	});
});
