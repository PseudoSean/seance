import {expect} from "chai";
import {tokenize} from "../../client/js/helpers/ircmessageparser/parseMarkdown";

describe("parseMarkdown tokenize — emphasis", () => {
	it("returns nothing for plain text", () => {
		expect(tokenize("hello world")).to.deep.equal({removals: [], ranges: []});
	});

	it("parses **bold**", () => {
		expect(tokenize("a **b** c")).to.deep.equal({
			removals: [
				{start: 2, end: 4},
				{start: 5, end: 7},
			],
			ranges: [{start: 4, end: 5, flag: "bold"}],
		});
	});

	it("parses *italic* and _italic_", () => {
		expect(tokenize("*a*").ranges).to.deep.equal([{start: 1, end: 2, flag: "italic"}]);
		expect(tokenize("_a_").ranges).to.deep.equal([{start: 1, end: 2, flag: "italic"}]);
	});

	it("parses __underline__, ~~strike~~ and ||spoiler||", () => {
		expect(tokenize("__a__").ranges).to.deep.equal([{start: 2, end: 3, flag: "underline"}]);
		expect(tokenize("~~a~~").ranges).to.deep.equal([{start: 2, end: 3, flag: "strikethrough"}]);
		expect(tokenize("||a||").ranges).to.deep.equal([{start: 2, end: 3, flag: "spoiler"}]);
	});

	it("nests ***bold italic***", () => {
		const {ranges, removals} = tokenize("***a***");
		expect(ranges).to.have.deep.members([
			{start: 3, end: 4, flag: "italic"},
			{start: 2, end: 5, flag: "bold"},
		]);
		expect(removals).to.have.deep.members([
			{start: 0, end: 2},
			{start: 2, end: 3},
			{start: 4, end: 5},
			{start: 5, end: 7},
		]);
	});

	it("nests **bold *and italic* text**", () => {
		const {ranges} = tokenize("**bold *and italic* text**");
		expect(ranges).to.have.deep.members([
			{start: 8, end: 18, flag: "italic"},
			{start: 2, end: 24, flag: "bold"},
		]);
	});

	it("leaves unmatched and malformed markers literal", () => {
		expect(tokenize("**a")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("a**")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("** a **")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("~a~")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("|a|")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("2 * 3 * 4")).to.deep.equal({removals: [], ranges: []});
	});

	it("does not italicise underscores inside words", () => {
		expect(tokenize("snake_case_name")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("foo__bar__baz")).to.deep.equal({removals: [], ranges: []});
	});

	it("does italicise asterisks inside words", () => {
		expect(tokenize("un*believ*able").ranges).to.deep.equal([
			{start: 3, end: 9, flag: "italic"},
		]);
	});

	it("honours backslash escapes", () => {
		expect(tokenize("\\*not italic\\*")).to.deep.equal({
			removals: [
				{start: 0, end: 1},
				{start: 12, end: 13},
			],
			ranges: [],
		});
		expect(tokenize("\\\\")).to.deep.equal({removals: [{start: 0, end: 1}], ranges: []});
		expect(tokenize("a\\b")).to.deep.equal({removals: [], ranges: []});
	});

	it("treats URLs as opaque", () => {
		expect(tokenize("see https://example.com/a_b_c_d ok")).to.deep.equal({
			removals: [],
			ranges: [],
		});
		expect(tokenize("**https://example.com/x**").ranges).to.deep.equal([
			{start: 2, end: 23, flag: "bold"},
		]);
	});

	it("accepts explicit opaque ranges", () => {
		expect(tokenize("*a* *b*", [{start: 0, end: 3}]).ranges).to.deep.equal([
			{start: 5, end: 6, flag: "italic"},
		]);
	});
});
