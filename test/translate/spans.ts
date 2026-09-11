import {expect} from "chai";
import {appendMissing, placeholder, protect, restore} from "../../client/js/translate/spans";

describe("translate/spans", () => {
	it("replaces URLs, code spans, shortcodes and formatting codes with numbered placeholders", () => {
		const {text, spans} = protect(
			"see `git rebase -i` at https://example.test/a?b=1 :tada: \x02bold\x02 \x0304red\x03 ok"
		);

		expect(spans).to.deep.equal([
			"`git rebase -i`",
			"https://example.test/a?b=1",
			":tada:",
			"\x02",
			"\x02",
			"\x0304",
			"\x03",
		]);
		expect(text).to.equal(
			`see ${placeholder(1)} at ${placeholder(2)} ${placeholder(3)} ${placeholder(
				4
			)}bold${placeholder(5)} ${placeholder(6)}red${placeholder(7)} ok`
		);
	});

	it("a code span containing a URL is one span", () => {
		const {spans} = protect("run `curl https://x.test` now");

		expect(spans).to.deep.equal(["`curl https://x.test`"]);
	});

	it("leaves plain text alone", () => {
		expect(protect("Ja, gestern.")).to.deep.equal({text: "Ja, gestern.", spans: []});
	});

	it("restores placeholders in any order and tolerates spaces inside them", () => {
		const {text, spans} = protect("a https://x.test b `c`");
		const translated = `${placeholder(2)} und ⟦ 1 ⟧ dann`;

		expect(restore(translated, spans)).to.deep.equal({
			text: "`c` und https://x.test dann",
			missing: [],
		});
	});

	it("reports placeholders the model dropped and appends them", () => {
		const {spans} = protect("a https://x.test b `c`");
		const result = restore("nur text", spans);

		expect(result).to.deep.equal({text: "nur text", missing: [1, 2]});
		expect(appendMissing(result.text, spans, result.missing)).to.equal(
			"nur text https://x.test `c`"
		);
	});

	it("leaves an unknown placeholder number as it is", () => {
		expect(restore(`x ${placeholder(9)}`, ["a"])).to.deep.equal({
			text: `x ${placeholder(9)}`,
			missing: [1],
		});
	});
});
