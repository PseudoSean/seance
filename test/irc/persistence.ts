import {expect} from "chai";
import sinon from "ts-sinon";
import {RESTORE_WAIT_MS, awaitingRestoration} from "../../client/js/irc/persistence";
import {ChanState} from "../../shared/types/chan";
import {MessageType} from "../../shared/types/msg";
import {ALL_CAPS, Harness, batch, labelOf, register, setup} from "./support";

const CAPS = ALL_CAPS + " draft/persistence";
const HOLD = [":irc.test PERSISTENCE STATUS ON"];

/** Types of the messages the UI got for `chanId`. */
function types(h: Harness, chanId: number): MessageType[] {
	return h.messages(chanId).map((m) => m.type as MessageType);
}

/** The server's post-JOIN burst for #seance with `topic`, as a re-join or inside a batch. */
function joinBurst(topic: string, tag = ""): string[] {
	return [
		`${tag}:alice!alice@host JOIN #seance`,
		`${tag}:irc.test 332 alice #seance :${topic}`,
		`${tag}:irc.test 333 alice #seance bob!bob@host 1756000000`,
		`${tag}:irc.test 353 alice = #seance :@alice bob`,
		`${tag}:irc.test 366 alice #seance :End of /NAMES list.`,
	];
}

/** The `draft/persistence` batch restoring #seance (and optionally more channels). */
function restore(h: Harness, topic: string, extra: string[] = []): void {
	const tag = "@batch=p1 ";
	h.transport.line(":irc.test BATCH +p1 draft/persistence");
	h.transport.line(
		"@batch=p1;time=2026-08-20T10:00:00.000Z;msgid=j1 :alice!alice@host JOIN #seance alice :Alice"
	);

	for (const line of joinBurst(topic, tag).slice(1)) {
		h.transport.line(line);
	}

	for (const line of extra) {
		h.transport.line(tag + line);
	}

	h.transport.line(":irc.test BATCH -p1");
}

describe("Session persistence and quiet re-joins (irc/persistence.ts)", function () {
	let clock: sinon.SinonFakeTimers;

	beforeEach(function () {
		clock = sinon.useFakeTimers({now: Date.parse("2026-08-27T12:00:00.000Z")});
	});

	afterEach(function () {
		clock.restore();
	});

	describe("draft/persistence", function () {
		it("requests the cap; STATUS ON before the MOTD end holds the autojoin back, silently", function () {
			const h = setup();
			register(h, CAPS, HOLD);
			const req = h.transport.sent.find((l) => l.startsWith("CAP REQ :"))!;
			expect(req).to.include("draft/persistence");
			expect(h.client.persistenceHold).to.equal(true);
			expect(awaitingRestoration(h.client)).to.equal(true);
			expect(h.transport.sent.filter((l) => l.startsWith("JOIN"))).to.deep.equal([]);
			expect(h.messages().some((m) => /^Session persistence/.test(m.text ?? ""))).to.equal(
				false
			);
		});

		it("STATUS OFF (or no STATUS) JOINs at once", function () {
			const off = setup();
			register(off, CAPS, [":irc.test PERSISTENCE STATUS OFF"]);
			expect(off.client.persistenceHold).to.equal(false);
			expect(off.transport.sent.filter((l) => l.startsWith("JOIN"))).to.deep.equal([
				"JOIN #seance",
			]);

			const none = setup();
			register(none, CAPS);
			expect(none.transport.sent.filter((l) => l.startsWith("JOIN"))).to.deep.equal([
				"JOIN #seance",
			]);
		});

		it("held but nothing restored: JOINs after RESTORE_WAIT_MS", function () {
			const h = setup();
			h.client.open(h.client.findChannel("#seance")!.id);
			register(h, CAPS, HOLD);
			clock.tick(RESTORE_WAIT_MS - 1);
			expect(h.sent()).to.deep.equal([]);
			clock.tick(1);
			expect(awaitingRestoration(h.client)).to.equal(false);
			const lines = h.sent();
			expect(lines[0]).to.equal("JOIN #seance");
			// The active channel's catch-up is pipelined behind it as usual.
			expect(lines[1]).to.match(/CHATHISTORY LATEST #seance/);
		});

		it("the restoration batch is applied as state, and only the rest is JOINed", function () {
			const h = setup({join: "#seance,#other"});
			const seance = h.client.findChannel("#seance")!;
			h.client.open(seance.id);
			register(h, CAPS, HOLD);
			restore(h, "Welcome");

			expect(seance.state).to.equal(ChanState.JOINED);
			expect(Array.from(seance.users.keys())).to.deep.equal(["alice", "bob"]);
			expect(seance.shared.topic).to.equal("Welcome");
			// A fresh client had no topic: that is news. Our JOIN is not.
			expect(types(h, seance.id)).to.deep.equal([
				MessageType.TOPIC,
				MessageType.TOPIC_SET_BY,
			]);
			expect(awaitingRestoration(h.client)).to.equal(false);

			const sent = h.sent();
			expect(sent.filter((l) => l.startsWith("JOIN"))).to.deep.equal(["JOIN #other"]);
			// The restored channel gets its catch-up (active: at once) and modes.
			expect(sent.some((l) => /CHATHISTORY LATEST #seance/.test(l))).to.equal(true);
			expect(sent).to.include("MODE #seance");
			expect(sent.filter((l) => l.includes("#other"))).to.deep.equal(["JOIN #other"]);
		});

		it("a drop and a resumed session: nothing is shown, history is fetched AFTER the newest line", function () {
			const h = setup();
			const seance = h.client.findChannel("#seance")!;
			h.client.open(seance.id);
			register(h, CAPS, HOLD);
			restore(h, "Welcome");
			batch(
				h,
				["@time=2026-08-27T11:59:00.000Z;msgid=m1 :bob!bob@host PRIVMSG #seance :hi"],
				{
					label: labelOf(h.sent()),
				}
			);
			h.dispatch.resetHistory();

			h.transport.closed();
			expect(seance.state).to.equal(ChanState.PARTED);
			expect(seance.rejoining).to.equal(true);
			register(h, CAPS, HOLD);
			h.dispatch.resetHistory();
			restore(h, "Welcome");

			expect(seance.state).to.equal(ChanState.JOINED);
			expect(seance.users.size).to.equal(2);
			expect(h.messages(seance.id)).to.deep.equal([]);
			expect(h.sent().filter((l) => !l.startsWith("MODE"))).to.have.length(1);
			expect(h.transport.sent[h.transport.sent.length - 2]).to.match(
				/CHATHISTORY AFTER #seance (msgid|timestamp)=\S+ \d+$/
			);
			expect(h.transport.sent.filter((l) => l.startsWith("JOIN"))).to.deep.equal([]);
		});

		it("a channel the server restored that we did not know is announced", function () {
			const h = setup();
			register(h, CAPS, HOLD);
			restore(h, "Welcome", [
				":alice!alice@host JOIN #extra",
				":irc.test 353 alice = #extra :@alice",
				":irc.test 366 alice #extra :End of /NAMES list.",
			]);
			const extra = h.client.findChannel("#extra")!;
			expect(extra.state).to.equal(ChanState.JOINED);
			expect(
				h.payloads<{chan: {name: string}}>("join").map((p) => p.chan.name)
			).to.deep.equal(["#extra"]);
			expect(types(h, extra.id)).to.deep.equal([]);
		});

		it("the batch also satisfies a later STATUS query in the lobby", function () {
			const h = setup();
			register(h, CAPS, HOLD);
			h.dispatch.resetHistory();
			h.transport.line(":irc.test PERSISTENCE STATUS OFF");
			expect(h.client.persistenceHold).to.equal(false);
			expect(h.lastMessage(h.client.lobby.id).text).to.match(/^Session persistence .*: OFF$/);
		});

		it("a close while waiting cancels the pending autojoin", function () {
			const h = setup();
			register(h, CAPS, HOLD);
			h.transport.closed();
			clock.tick(RESTORE_WAIT_MS * 2);
			expect(awaitingRestoration(h.client)).to.equal(false);
			expect(h.transport.sent.filter((l) => l.startsWith("JOIN"))).to.deep.equal([]);
		});
	});

	describe("re-join after a drop (no persistence)", function () {
		function connectedWithTopic(): Harness {
			const h = setup();
			register(h);
			h.transport.lines(...joinBurst("Welcome"));
			const seance = h.client.findChannel("#seance")!;
			expect(types(h, seance.id)).to.deep.equal([
				MessageType.JOIN,
				MessageType.TOPIC,
				MessageType.TOPIC_SET_BY,
			]);
			h.dispatch.resetHistory();
			h.sent();
			return h;
		}

		it("hides our JOIN and an unchanged topic, refills the user list", function () {
			const h = connectedWithTopic();
			const seance = h.client.findChannel("#seance")!;
			h.transport.closed();
			expect(seance.rejoining).to.equal(true);
			register(h);
			h.dispatch.resetHistory();
			h.transport.lines(...joinBurst("Welcome"));

			expect(seance.state).to.equal(ChanState.JOINED);
			expect(seance.users.size).to.equal(2);
			expect(h.messages(seance.id)).to.deep.equal([]);
			expect(seance.rejoining).to.equal(false);
			expect(seance.topicQuiet).to.equal(false);

			// Once the burst is over, the same replies (e.g. for /topic) are shown.
			h.transport.lines(
				":irc.test 332 alice #seance :Welcome",
				":irc.test 333 alice #seance bob!bob@host 1756000000"
			);
			expect(types(h, seance.id)).to.deep.equal([
				MessageType.TOPIC,
				MessageType.TOPIC_SET_BY,
			]);
		});

		it("shows a topic that changed while we were away", function () {
			const h = connectedWithTopic();
			const seance = h.client.findChannel("#seance")!;
			h.transport.closed();
			register(h);
			h.dispatch.resetHistory();
			h.transport.lines(...joinBurst("New topic"));

			expect(seance.shared.topic).to.equal("New topic");
			expect(types(h, seance.id)).to.deep.equal([
				MessageType.TOPIC,
				MessageType.TOPIC_SET_BY,
			]);
			expect(h.payloads("topic")).to.deep.equal([{chan: seance.id, topic: "New topic"}]);
		});

		it("a deliberate disconnect and reconnect shows the JOIN as before", function () {
			const h = connectedWithTopic();
			const seance = h.client.findChannel("#seance")!;
			h.client.disconnect();
			h.transport.closed();
			expect(seance.rejoining).to.equal(false);
			register(h);
			h.dispatch.resetHistory();
			h.transport.lines(...joinBurst("Welcome"));
			expect(types(h, seance.id)).to.deep.equal([
				MessageType.JOIN,
				MessageType.TOPIC,
				MessageType.TOPIC_SET_BY,
			]);
		});
	});
});
