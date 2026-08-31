import {expect} from "chai";
import {
	COLLAPSE_EXCERPT,
	COLLAPSE_THRESHOLD,
	excerptRange,
} from "../../client/js/helpers/ircmessageparser/codeLines";

// `splitLines` and `MIN_GUESS_LINES` are covered through the highlighter's
// re-export in `test/helpers/highlighter.ts`; what lives here is the collapse
// decision, which the block has to make before — and without — Prism.
describe("codeLines — excerptRange", () => {
	it("leaves a block at or under the threshold whole", () => {
		expect(excerptRange(0)).to.equal(undefined);
		expect(excerptRange(1)).to.equal(undefined);
		expect(excerptRange(COLLAPSE_THRESHOLD)).to.equal(undefined);
	});

	it("cuts a block over the threshold to the excerpt", () => {
		expect(excerptRange(COLLAPSE_THRESHOLD + 1)).to.equal(COLLAPSE_EXCERPT);
		expect(excerptRange(100)).to.equal(COLLAPSE_EXCERPT);
	});

	it("is the numbers the plan named", () => {
		expect(COLLAPSE_THRESHOLD).to.equal(12);
		expect(COLLAPSE_EXCERPT).to.equal(8);
		// The excerpt has to be shorter than the block it stands for, or the
		// toggle would offer to show what is already there
		expect(COLLAPSE_EXCERPT).to.be.lessThan(COLLAPSE_THRESHOLD);
	});
});
