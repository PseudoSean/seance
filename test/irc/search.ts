import {expect} from "chai";
import {MessageType} from "../../shared/types/msg";
import type {ClientChan, ClientMessage, ClientNetwork} from "../../client/js/types";
import {
	DEFAULT_SEARCH_LIMIT,
	messageMatches,
	searchMessages,
	SearchableState,
} from "../../client/js/search";

let nextId = 1;

function msg(
	text: string,
	nick: string,
	opts: {type?: MessageType; time?: Date; id?: number} = {}
): ClientMessage {
	const id = opts.id ?? nextId++;

	return {
		id,
		text,
		from: {nick, mode: ""},
		type: opts.type ?? MessageType.MESSAGE,
		time: opts.time ?? new Date(1_700_000_000_000 + id * 1000),
		users: [],
	};
}

function chan(id: number, name: string, messages: ClientMessage[]): ClientChan {
	return {
		id,
		name,
		messages,
	} as unknown as ClientChan;
}

function network(uuid: string, channels: ClientChan[]): ClientNetwork {
	return {uuid, name: uuid, channels} as unknown as ClientNetwork;
}

function fixture(): SearchableState {
	nextId = 1;

	const general = chan(1, "#general", [
		msg("hello world", "alice"),
		msg("Hello again", "bob"),
		msg("unrelated", "carol"),
		msg("bob joined", "server", {type: MessageType.JOIN}),
		msg("hello from a part", "bob", {type: MessageType.PART}),
		msg("+o hello", "chanserv", {type: MessageType.MODE}),
		msg("waves hello", "dave", {type: MessageType.ACTION}),
		msg("hello notice", "eve", {type: MessageType.NOTICE}),
	]);

	const other = chan(2, "#other", [msg("hello elsewhere", "frank"), msg("nothing", "grace")]);

	const away = network("net-b", [chan(3, "#general", [msg("hello on another net", "heidi")])]);

	return {networks: [network("net-a", [general, other]), away]};
}

describe("client/js/search", function () {
	describe("searchMessages", function () {
		it("matches text case-insensitively", function () {
			const state = fixture();
			const {results, total} = searchMessages(state, {networkUuid: "net-a", query: "HELLO"});

			const texts = results.map((r) => r.text);
			expect(texts).to.include("hello world");
			expect(texts).to.include("Hello again");
			expect(texts).to.include("hello elsewhere");
			expect(texts).to.not.include("unrelated");
			expect(total).to.equal(results.length);
		});

		it("matches on the sender nick", function () {
			const state = fixture();
			const {results} = searchMessages(state, {networkUuid: "net-a", query: "CaRoL"});

			expect(results).to.have.length(1);
			expect(results[0].text).to.equal("unrelated");
			expect(results[0].from?.nick).to.equal("carol");
		});

		it("excludes non-chat message types", function () {
			const state = fixture();
			const {results} = searchMessages(state, {networkUuid: "net-a", query: "hello"});

			const types = results.map((r) => r.type);
			expect(types).to.not.include(MessageType.JOIN);
			expect(types).to.not.include(MessageType.PART);
			expect(types).to.not.include(MessageType.MODE);
			expect(types).to.include(MessageType.ACTION);
			expect(types).to.include(MessageType.NOTICE);
		});

		it("scopes to the requested network", function () {
			const state = fixture();
			const {results} = searchMessages(state, {networkUuid: "net-b", query: "hello"});

			expect(results).to.have.length(1);
			expect(results[0].text).to.equal("hello on another net");
			expect(results[0].networkUuid).to.equal("net-b");
			expect(results[0].chanId).to.equal(3);
		});

		it("returns nothing for an unknown network", function () {
			const state = fixture();
			const response = searchMessages(state, {networkUuid: "nope", query: "hello"});

			expect(response).to.deep.equal({results: [], total: 0});
		});

		it("filters by channel when channelId is given", function () {
			const state = fixture();
			const {results, total} = searchMessages(state, {
				networkUuid: "net-a",
				channelId: 2,
				query: "hello",
			});

			expect(total).to.equal(1);
			expect(results[0].text).to.equal("hello elsewhere");
			expect(results.every((r) => r.chanId === 2)).to.equal(true);
		});

		it("returns nothing for a channel that is not on that network", function () {
			const state = fixture();
			const {total} = searchMessages(state, {
				networkUuid: "net-b",
				channelId: 1,
				query: "hello",
			});

			expect(total).to.equal(0);
		});

		it("orders results newest first, by time then id", function () {
			const sameTime = new Date(1_700_000_000_000);
			const state: SearchableState = {
				networks: [
					network("n", [
						chan(1, "#c", [
							msg("x one", "a", {id: 1, time: new Date(1_700_000_001_000)}),
							msg("x two", "a", {id: 2, time: sameTime}),
							msg("x three", "a", {id: 3, time: sameTime}),
							msg("x four", "a", {id: 4, time: new Date(1_700_000_005_000)}),
						]),
					]),
				],
			};

			const {results} = searchMessages(state, {networkUuid: "n", query: "x"});

			expect(results.map((r) => r.id)).to.deep.equal([4, 1, 3, 2]);
		});

		it("pages with limit and offset and reports the full total", function () {
			const state: SearchableState = {
				networks: [
					network("n", [
						chan(
							1,
							"#c",
							Array.from({length: 25}, (_, i) => msg(`ping ${i}`, "a", {id: i + 1}))
						),
					]),
				],
			};

			const first = searchMessages(state, {networkUuid: "n", query: "ping", limit: 10});
			expect(first.total).to.equal(25);
			expect(first.results.map((r) => r.id)).to.deep.equal([
				25, 24, 23, 22, 21, 20, 19, 18, 17, 16,
			]);

			const second = searchMessages(state, {
				networkUuid: "n",
				query: "ping",
				limit: 10,
				offset: 10,
			});
			expect(second.total).to.equal(25);
			expect(second.results.map((r) => r.id)).to.deep.equal([
				15, 14, 13, 12, 11, 10, 9, 8, 7, 6,
			]);

			const last = searchMessages(state, {
				networkUuid: "n",
				query: "ping",
				limit: 10,
				offset: 20,
			});
			expect(last.results.map((r) => r.id)).to.deep.equal([5, 4, 3, 2, 1]);

			const past = searchMessages(state, {
				networkUuid: "n",
				query: "ping",
				limit: 10,
				offset: 30,
			});
			expect(past.results).to.have.length(0);
			expect(past.total).to.equal(25);
		});

		it("defaults the page size to DEFAULT_SEARCH_LIMIT", function () {
			const count = DEFAULT_SEARCH_LIMIT + 5;
			const state: SearchableState = {
				networks: [
					network("n", [
						chan(
							1,
							"#c",
							Array.from({length: count}, (_, i) =>
								msg(`ping ${i}`, "a", {id: i + 1})
							)
						),
					]),
				],
			};

			const {results, total} = searchMessages(state, {networkUuid: "n", query: "ping"});

			expect(results).to.have.length(DEFAULT_SEARCH_LIMIT);
			expect(total).to.equal(count);
		});

		it("rejects an empty or whitespace-only query", function () {
			const state = fixture();

			expect(() => searchMessages(state, {networkUuid: "net-a", query: ""})).to.throw(
				/must not be empty/
			);
			expect(() => searchMessages(state, {networkUuid: "net-a", query: "   "})).to.throw(
				/must not be empty/
			);
		});

		it("trims the query before matching", function () {
			const state = fixture();
			const {results} = searchMessages(state, {networkUuid: "net-a", query: "  again  "});

			expect(results).to.have.length(1);
			expect(results[0].text).to.equal("Hello again");
		});

		it("tags each result with chanId and networkUuid", function () {
			const state = fixture();
			const {results} = searchMessages(state, {networkUuid: "net-a", query: "world"});

			expect(results).to.have.length(1);
			expect(results[0]).to.include({chanId: 1, networkUuid: "net-a", text: "hello world"});
		});

		it("does not mutate the store messages", function () {
			const state = fixture();
			const original = state.networks[0].channels[0].messages[0];
			const before = {...original};

			searchMessages(state, {networkUuid: "net-a", query: "hello"});

			expect(original).to.deep.equal(before);
			expect(original).to.not.have.property("chanId");
		});
	});

	describe("messageMatches", function () {
		it("treats a missing type as a chat message", function () {
			const m = msg("hello", "a");
			delete m.type;

			expect(messageMatches(m, "hello")).to.equal(true);
		});

		it("never matches an empty needle", function () {
			expect(messageMatches(msg("hello", "a"), "")).to.equal(false);
		});

		it("ignores messages without text when the nick does not match", function () {
			const m = msg("", "a");
			delete m.text;

			expect(messageMatches(m, "hello")).to.equal(false);
			expect(messageMatches(m, "a")).to.equal(true);
		});
	});
});
