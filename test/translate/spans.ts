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
			text: "https://x.test und `c` dann",
			missing: [],
		});
	});

	it("reports placeholders the model dropped and appends them", () => {
		const {spans} = protect("a https://x.test b `c`");
		const result = restore("nur text", spans);

		expect(result).to.deep.equal({text: "nur text", missing: [1, 2]});
		expect(appendMissing(result.text, spans, result.missing)).to.equal(
			"nur text `c` https://x.test"
		);
	});

	it("leaves an unknown placeholder number as it is", () => {
		expect(restore(`x ${placeholder(9)}`, ["a"])).to.deep.equal({
			text: `x ${placeholder(9)}`,
			missing: [1],
		});
	});

	it("a URL containing www. is one span (later patterns don't match inside protected text)", () => {
		const {text, spans} = protect("see https://www.example.test now");

		expect(spans).to.deep.equal(["https://www.example.test"]);
		expect(text).to.equal(`see ${placeholder(1)} now`);
	});

	it("a URL containing a shortcode-shaped substring is one span", () => {
		const {text, spans} = protect("see http://x.test:80:something end");

		expect(spans).to.deep.equal(["http://x.test:80:something"]);
		expect(text).to.equal(`see ${placeholder(1)} end`);
	});

	it("span numbering follows pattern order, not text position", () => {
		const {text, spans} = protect(":tada: see https://example.test/a");

		expect(spans).to.deep.equal(["https://example.test/a", ":tada:"]);
		expect(text).to.equal(`${placeholder(2)} see ${placeholder(1)}`);
	});

	it("a time is not a shortcode", () => {
		expect(protect("um 10:30:45 Uhr :+1:")).to.deep.equal({
			text: `um 10:30:45 Uhr ${placeholder(1)}`,
			spans: [":+1:"],
		});
	});
});
