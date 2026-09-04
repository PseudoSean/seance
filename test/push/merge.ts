import {expect} from "chai";
import {
	addMessage,
	joinLines,
	MergedMessage,
	midEllipsis,
	renderMergedBody,
} from "../../client/js/push/merge";

describe("push/merge", function () {
	describe("addMessage", function () {
		it("appends a plain message and reports it as new", function () {
			const {entries, isNew} = addMessage([], {from: "alice", text: "hi", msgid: "m1"});
			expect(isNew).to.equal(true);
			expect(entries).to.deep.equal([{from: "alice", text: "hi", msgid: "m1"}]);
		});

		it("keeps only the newest `keep` messages", function () {
			let entries: MergedMessage[] = [];

			for (let i = 1; i <= 6; i++) {
				entries = addMessage(entries, {from: "a", text: `m${i}`}, 4).entries;
			}

			expect(entries.map((e) => e.text)).to.deep.equal(["m3", "m4", "m5", "m6"]);
		});

		it("does not mutate its input", function () {
			const before: MergedMessage[] = [{from: "a", text: "x"}];
			addMessage(before, {from: "b", text: "y"});
			expect(before).to.deep.equal([{from: "a", text: "x"}]);
		});

		it("creates one entry for the first line of a batch and joins later lines into it", function () {
			const first = addMessage([], {
				from: "alice",
				text: "line one",
				msgid: "b1",
				batch: "b1",
				line: {index: 1, sent: 3, total: 3},
			});
			expect(first.isNew).to.equal(true);

			const second = addMessage(first.entries, {
				from: "alice",
				text: " continued",
				msgid: "b1",
				batch: "b1",
				line: {index: 2, sent: 3, total: 3},
				concat: true,
			});
			expect(second.isNew).to.equal(false);

			const third = addMessage(second.entries, {
				from: "alice",
				text: "line two",
				msgid: "b1",
				batch: "b1",
				line: {index: 3, sent: 3, total: 3},
			});
			expect(third.isNew).to.equal(false);
			expect(third.entries).to.have.length(1);
			expect(third.entries[0].text).to.equal("line one continued\nline two");
		});

		it("accepts lines out of order and a duplicate line without change", function () {
			const a = addMessage([], {
				from: "x",
				text: "two",
				batch: "b",
				line: {index: 2, sent: 2, total: 2},
			});
			expect(a.entries[0].text).to.equal("…\ntwo");

			const b = addMessage(a.entries, {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 2, total: 2},
			});
			expect(b.isNew).to.equal(false);
			expect(b.entries[0].text).to.equal("one\ntwo");

			const c = addMessage(b.entries, {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 2, total: 2},
			});
			expect(c.isNew).to.equal(false);
			expect(c.entries).to.deep.equal(b.entries);
		});

		it("marks a capped message as incomplete", function () {
			const {entries} = addMessage([], {
				from: "x",
				text: "one",
				batch: "b",
				line: {index: 1, sent: 1, total: 4},
			});
			expect(entries[0].text).to.equal("one\n…");
		});

		it("treats a line with a batch but no index as a plain message", function () {
			const {entries, isNew} = addMessage([], {from: "x", text: "one", batch: "b"});
			expect(isNew).to.equal(true);
			expect(entries[0].lines).to.equal(undefined);
		});
	});

	describe("joinLines", function () {
		it("returns the text of a plain entry", function () {
			expect(joinLines({from: "a", text: "plain"})).to.equal("plain");
		});
	});

	describe("midEllipsis", function () {
		it("keeps how a long text starts and ends", function () {
			const long = "a".repeat(60) + "b".repeat(30);
			const out = midEllipsis(long, 48, 18);
			expect(out).to.have.length(48 + 1 + 18);
			expect(out.startsWith("a".repeat(48) + "…")).to.equal(true);
			expect(out.endsWith("b".repeat(18))).to.equal(true);
			expect(midEllipsis("short", 48, 18)).to.equal("short");
		});
	});

	describe("renderMergedBody", function () {
		it("prefixes channel lines with the sender and applies the renderer", function () {
			const body = renderMergedBody(
				[
					{from: "alice", text: "**hi**"},
					{from: "bob", text: "yo"},
				],
				true,
				(t) => t.replace(/\*\*/g, "")
			);
			expect(body).to.equal("alice: hi\nbob: yo");
		});

		it("shows bare text in a DM", function () {
			expect(renderMergedBody([{from: "alice", text: "hi"}], false)).to.equal("hi");
		});

		it("collapses the middle over the budget", function () {
			const entries = Array.from({length: 4}, (_, i) => ({
				from: "a",
				text: `${i}`.repeat(60),
			}));
			const body = renderMergedBody(entries, false);
			expect(body).to.include("… +2 more");
			expect(body.split("\n")).to.have.length(3);
		});
	});
});
