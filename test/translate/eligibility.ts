import {expect} from "chai";
import {
	HISTORY_QUEUE_CAP,
	MIN_WORDS,
	historyQueueOrder,
	isEligible,
	plainTextOf,
	wordCount,
} from "../../client/js/translate/eligibility";

const nicks = ["ada", "jonas", "Storm"];
const since = Date.parse("2026-09-11T12:00:00Z");

function msg(overrides: Record<string, unknown> = {}) {
	return {
		type: "message",
		self: false,
		pending: false,
		time: new Date(since + 1000),
		text: "Ja, gestern, der Batch-Cooldown greift jetzt auch bei leeren Zeilen.",
		...overrides,
	};
}

describe("translate/eligibility", () => {
	// A loaded history page: the newest lines are the ones the reader is
	// looking at, and a long page is cut rather than queued whole.
	it("a loaded history page is taken newest first, up to the cap", () => {
		expect(HISTORY_QUEUE_CAP).to.equal(40);
		expect(historyQueueOrder(["a", "b", "c"])).to.deep.equal(["c", "b", "a"]);
		expect(historyQueueOrder(["a", "b", "c", "d"], 2)).to.deep.equal(["d", "c"]);
		expect(historyQueueOrder([], 2)).to.deep.equal([]);
		expect(historyQueueOrder(["a", "b"], 0)).to.deep.equal([]);

		const page = Array.from({length: HISTORY_QUEUE_CAP + 5}, (_, i) => i);
		const queued = historyQueueOrder(page);

		expect(queued.length).to.equal(HISTORY_QUEUE_CAP);
		expect(queued[0]).to.equal(HISTORY_QUEUE_CAP + 4);
		expect(queued).to.not.include(0);
	});

	it("plainTextOf strips what a detector must not see", () => {
		expect(
			plainTextOf(
				"ada: schau mal https://example.test/a `code hier` :tada: \x02fett\x02 🎉 jonas, danke",
				nicks
			)
		).to.equal("schau mal fett danke");
		expect(plainTextOf("Ich komme um 10:30:45 Uhr :+1:", [])).to.equal(
			"Ich komme um 10:30:45 Uhr"
		);
	});

	it("wordCount counts words, not punctuation", () => {
		expect(wordCount("Ja, gestern.")).to.equal(2);
		expect(wordCount("  ")).to.equal(0);
		expect(MIN_WORDS).to.equal(3);
	});

	it("a message from someone else, after the switch, with three words, qualifies", () => {
		expect(isEligible(msg(), {since, nicks})).to.equal(true);
		expect(isEligible(msg({type: "action"}), {since, nicks})).to.equal(true);
		expect(isEligible(msg({type: "notice"}), {since, nicks})).to.equal(true);
	});

	it("own, pending, other-typed and pre-switch messages do not", () => {
		expect(isEligible(msg({self: true}), {since, nicks})).to.equal(false);
		expect(isEligible(msg({pending: true}), {since, nicks})).to.equal(false);
		expect(isEligible(msg({type: "join"}), {since, nicks})).to.equal(false);
		expect(isEligible(msg({time: new Date(since - 1)}), {since, nicks})).to.equal(false);
		expect(isEligible(msg({time: since - 1}), {since, nicks})).to.equal(false);
	});

	it("too little text does not", () => {
		expect(isEligible(msg({text: "ok danke"}), {since, nicks})).to.equal(false);
		expect(
			isEligible(msg({text: "https://example.test/a :tada: ada:"}), {since, nicks})
		).to.equal(false);
		expect(isEligible(msg({text: "`nur code hier drin`"}), {since, nicks})).to.equal(false);
		expect(isEligible(msg({text: undefined}), {since, nicks})).to.equal(false);
	});
});
