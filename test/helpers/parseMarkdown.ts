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

describe("parseMarkdown tokenize — code, quotes, links", () => {
	it("parses inline code and suppresses markdown inside it", () => {
		expect(tokenize("`**x**`")).to.deep.equal({
			removals: [
				{start: 0, end: 1},
				{start: 6, end: 7},
			],
			ranges: [
				{start: 1, end: 6, flag: "monospace"},
				{start: 1, end: 6, flag: "code"},
			],
		});
	});

	it("leaves empty or unmatched backticks literal", () => {
		expect(tokenize("``")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("a ` b")).to.deep.equal({removals: [], ranges: []});
	});

	it("parses a single-line code block", () => {
		expect(tokenize("```code```")).to.deep.equal({
			removals: [
				{start: 0, end: 3},
				{start: 7, end: 10},
			],
			ranges: [
				{start: 3, end: 7, flag: "codeBlock"},
				{start: 3, end: 7, flag: "code"},
			],
		});
	});

	it("parses a fenced block with a language tag and drops surrounding newlines", () => {
		const text = "before\n```js\nlet x = 1;\n```\nafter";
		expect(tokenize(text)).to.deep.equal({
			removals: [
				{start: 6, end: 13},
				{start: 23, end: 28},
			],
			ranges: [
				{start: 13, end: 23, flag: "codeBlock"},
				{start: 13, end: 23, flag: "code"},
			],
		});
	});

	it("leaves an unclosed fence literal", () => {
		expect(tokenize("```nope")).to.deep.equal({removals: [], ranges: []});
	});

	it("parses a quote line", () => {
		expect(tokenize("> hi *there*")).to.deep.equal({
			removals: [
				{start: 0, end: 2},
				{start: 5, end: 6},
				{start: 11, end: 12},
			],
			ranges: [
				{start: 2, end: 12, flag: "quote"},
				{start: 6, end: 11, flag: "italic"},
			],
		});
	});

	it("merges consecutive quote lines and drops the newline after the block", () => {
		expect(tokenize("> a\n> b\nc")).to.deep.equal({
			removals: [
				{start: 0, end: 2},
				{start: 4, end: 6},
				{start: 7, end: 8},
			],
			ranges: [{start: 2, end: 7, flag: "quote"}],
		});
	});

	it("does not treat > mid-line or without a space as a quote", () => {
		expect(tokenize("a > b")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize(">b")).to.deep.equal({removals: [], ranges: []});
	});

	it("parses [text](url) links", () => {
		expect(tokenize("[site](https://example.com/a)")).to.deep.equal({
			removals: [
				{start: 0, end: 1},
				{start: 5, end: 29},
			],
			ranges: [{start: 1, end: 5, flag: "href", href: "https://example.com/a"}],
		});
		expect(tokenize("[c](web+irc://irc.example.org/#chan)").ranges).to.deep.equal([
			{start: 1, end: 2, flag: "href", href: "web+irc://irc.example.org/#chan"},
		]);
	});

	it("allows emphasis inside link text", () => {
		expect(tokenize("[**b**](https://e.com)").ranges).to.have.deep.members([
			{start: 1, end: 6, flag: "href", href: "https://e.com"},
			{start: 3, end: 4, flag: "bold"},
		]);
	});

	it("rejects links with other schemes or malformed syntax", () => {
		expect(tokenize("[x](javascript:alert(1))")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("[x](ftp://e.com)")).to.deep.equal({removals: [], ranges: []});
		expect(tokenize("[x] (https://e.com)").ranges).to.deep.equal([]);
	});
});
