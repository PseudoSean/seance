import {expect} from "chai";
import {
	applyEdit,
	applyReaction,
	applyRedaction,
	findMessageById,
	myReactions,
	replyQuote,
} from "../../client/js/helpers/messageUpdates";
import {MessageType, SharedMsg} from "../../shared/types/msg";

function msg(id: number, extra: Partial<SharedMsg> = {}): SharedMsg {
	return {
		id,
		time: new Date(1000 + id),
		type: MessageType.MESSAGE,
		users: [],
		msgid: `m${id}`,
		text: `text ${id}`,
		from: {nick: `nick${id}`, mode: ""},
		...extra,
	};
}

describe("message updates (msg:react / msg:redact / msg:edit)", function () {
	it("lists the reactions one nick has, whatever case they use", function () {
		const m = msg(1, {
			reactions: [
				{text: "👍", nicks: ["Alice", "bob"]},
				{text: "lol", nicks: ["bob"]},
				{text: "🎉", nicks: ["alICE"]},
			],
		});

		expect(myReactions(m, "alice")).to.deep.equal(["👍", "🎉"]);
		expect(myReactions(m, "bob")).to.deep.equal(["👍", "lol"]);
		expect(myReactions(m, "carol")).to.be.empty;
		expect(myReactions(msg(2), "alice")).to.be.empty;
	});

	it("finds messages by id, newest first", function () {
		const list = [msg(1), msg(2), msg(3)];
		expect(findMessageById(list, 2)).to.equal(list[1]);
		expect(findMessageById(list, 9)).to.be.undefined;
	});

	it("aggregates reactions, one nick per text, in first-seen order", function () {
		const m = msg(1);
		applyReaction(m, "👍", "alice", false);
		applyReaction(m, "❤️", "bob", false);
		applyReaction(m, "👍", "bob", false);
		applyReaction(m, "👍", "Alice", false); // duplicate (case-insensitive)

		expect(m.reactions).to.deep.equal([
			{text: "👍", nicks: ["alice", "bob"]},
			{text: "❤️", nicks: ["bob"]},
		]);
	});

	it("removes a nick and drops the entry at zero", function () {
		const m = msg(1);
		applyReaction(m, "👍", "alice", false);
		applyReaction(m, "👍", "bob", false);
		applyReaction(m, "🔥", "alice", false);

		applyReaction(m, "👍", "ALICE", true);
		expect(m.reactions).to.deep.equal([
			{text: "👍", nicks: ["bob"]},
			{text: "🔥", nicks: ["alice"]},
		]);

		applyReaction(m, "👍", "bob", true);
		expect(m.reactions).to.deep.equal([{text: "🔥", nicks: ["alice"]}]);

		applyReaction(m, "🔥", "alice", true);
		expect(m.reactions).to.be.undefined;

		// removing what is not there is a no-op
		applyReaction(m, "🔥", "alice", true);
		expect(m.reactions).to.be.undefined;
	});

	it("replaces the reactions array instead of mutating it", function () {
		const m = msg(1);
		applyReaction(m, "👍", "alice", false);
		const before = m.reactions;
		applyReaction(m, "👍", "bob", false);
		expect(m.reactions).to.not.equal(before);
		expect(before).to.deep.equal([{text: "👍", nicks: ["alice"]}]);
	});

	it("keeps the text on redaction", function () {
		const m = msg(1);
		const time = new Date();
		applyRedaction(m, {by: "op", reason: "spam", time});
		expect(m.redacted).to.deep.equal({by: "op", reason: "spam", time});
		expect(m.text).to.equal("text 1");
	});

	it("marks the old message superseded on edit", function () {
		const old = msg(1);
		applyEdit(old, 2);
		expect(old.supersededBy).to.equal(2);
	});

	it("builds reply quotes from loaded parents only", function () {
		const list = [
			msg(1, {text: "  a   very\n long ".padEnd(120, "x")}),
			msg(2, {supersededBy: 3}),
			msg(3, {msgid: "m2", editOf: "m2", text: "new text"}),
		];

		const quote = replyQuote(list, "m1");
		expect(quote?.id).to.equal(1);
		expect(quote?.nick).to.equal("nick1");
		expect(quote?.text.length).to.equal(80);
		expect(quote?.text.endsWith("…")).to.be.true;

		// superseded message is skipped, the replacement (same msgid here) wins
		expect(replyQuote(list, "m2")?.text).to.equal("new text");
		expect(replyQuote(list, "nope")).to.be.undefined;
	});
});
