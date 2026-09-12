import {expect} from "chai";
import {
	SENT_READ_BACK_KEEP,
	SENT_READ_BACK_TTL_MS,
	SentReadBacks,
	type SentReadBackValue,
} from "../../client/js/translate/sentReadBack";

const value = (text: string): SentReadBackValue => ({
	text,
	from: "de",
	to: "en",
	engine: "llm",
});

describe("translate/sentReadBack", function () {
	it("hands a settled line without an echo its read-back once", function () {
		const map = new SentReadBacks();

		map.record(1, "[German] hallo", value("hello"), 0);

		expect(map.match(1, "[German] hallo", {id: 10}, 5)).to.deep.equal({value: value("hello")});
		expect(map.match(1, "[German] hallo", {id: 11}, 6)).to.equal(undefined);
		expect(map.size).to.equal(0);
	});

	it("gives the pending copy the read-back and keeps it for the echo", function () {
		const map = new SentReadBacks();

		map.record(1, "[German] hallo", value("hello"), 0);

		expect(map.match(1, "[German] hallo", {id: 10, pending: true}, 1)).to.deep.equal({
			value: value("hello"),
		});
		expect(map.size).to.equal(1);
		expect(map.match(1, "[German] hallo", {id: 12}, 2)).to.deep.equal({
			value: value("hello"),
			replacesCopy: 10,
		});
		expect(map.size).to.equal(0);
	});

	it("matches by channel and exact text", function () {
		const map = new SentReadBacks();

		map.record(1, "[German] hallo", value("hello"), 0);

		expect(map.match(2, "[German] hallo", {id: 10}, 1)).to.equal(undefined);
		expect(map.match(1, "[German] hallo ", {id: 10}, 1)).to.equal(undefined);
		expect(map.match(1, "[German] Hallo", {id: 10}, 1)).to.equal(undefined);
		expect(map.size).to.equal(1);
	});

	it("pairs two sends of the same text with their own copies and echoes, in order", function () {
		const map = new SentReadBacks();

		map.record(1, "ja", value("yes (first)"), 0);
		map.record(1, "ja", value("yes (second)"), 1);

		expect(map.match(1, "ja", {id: 10, pending: true}, 2)?.value.text).to.equal("yes (first)");
		expect(map.match(1, "ja", {id: 11, pending: true}, 2)?.value.text).to.equal("yes (second)");
		expect(map.match(1, "ja", {id: 12, pending: true}, 2)).to.equal(undefined);
		expect(map.match(1, "ja", {id: 20}, 3)).to.deep.equal({
			value: value("yes (first)"),
			replacesCopy: 10,
		});
		expect(map.match(1, "ja", {id: 21}, 3)).to.deep.equal({
			value: value("yes (second)"),
			replacesCopy: 11,
		});
	});

	it("drops a record its line never came back for", function () {
		const map = new SentReadBacks();

		map.record(1, "[German] hallo", value("hello"), 0);

		expect(map.match(1, "[German] hallo", {id: 10}, SENT_READ_BACK_TTL_MS)).to.equal(undefined);
		expect(map.size).to.equal(0);
	});

	it("keeps a bounded number of records, the oldest going first", function () {
		const map = new SentReadBacks();

		for (let i = 0; i <= SENT_READ_BACK_KEEP; i++) {
			map.record(1, `line ${i}`, value(`read ${i}`), i);
		}

		expect(map.size).to.equal(SENT_READ_BACK_KEEP);
		expect(map.match(1, "line 0", {id: 1}, 100)).to.equal(undefined);
		expect(map.match(1, `line ${SENT_READ_BACK_KEEP}`, {id: 2}, 100)?.value.text).to.equal(
			`read ${SENT_READ_BACK_KEEP}`
		);
	});

	it("forgets a channel's records", function () {
		const map = new SentReadBacks();

		map.record(1, "a", value("a"), 0);
		map.record(2, "b", value("b"), 0);
		map.forget(1);

		expect(map.match(1, "a", {id: 1}, 1)).to.equal(undefined);
		expect(map.match(2, "b", {id: 2}, 1)?.value.text).to.equal("b");
	});
});
