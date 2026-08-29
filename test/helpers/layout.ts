import {expect} from "chai";
import {
	layout,
	LayoutNode,
	Style,
	toPlainText,
} from "../../client/js/helpers/ircmessageparser/layout";

// Builders, so the assertions read as the tree they describe.
const text = (value: string, style: Style = {}): LayoutNode => ({
	kind: "text",
	text: value,
	style,
});

const quote = (children: LayoutNode[]): LayoutNode => ({kind: "wrap", wrap: "quote", children});

const codeBlock = (children: LayoutNode[], lang?: string): LayoutNode =>
	lang === undefined
		? {kind: "wrap", wrap: "codeBlock", children}
		: {kind: "wrap", wrap: "codeBlock", lang, children};

const spoiler = (children: LayoutNode[]): LayoutNode => ({kind: "wrap", wrap: "spoiler", children});

const href = (url: string, children: LayoutNode[]): LayoutNode => ({
	kind: "wrap",
	wrap: "href",
	href: url,
	children,
});

const markdown = {markdown: true};

describe("layout — text and styles", () => {
	it("renders plain text as one text node", () => {
		expect(layout("hello")).to.deep.equal([text("hello")]);
	});

	it("carries IRC styling on the text nodes", () => {
		expect(layout("\x02bold\x02 plain")).to.deep.equal([
			text("bold", {bold: true}),
			text(" plain"),
		]);
	});

	it("leaves the markers alone when Markdown is off", () => {
		expect(layout("**a** ||b||")).to.deep.equal([text("**a** ||b||")]);
	});

	it("nests Markdown styles on one text node", () => {
		expect(layout("**bold *and italic***", markdown)).to.deep.equal([
			text("bold ", {bold: true}),
			text("and italic", {bold: true, italic: true}),
		]);
	});
});

describe("layout — wraps", () => {
	it("wraps a quote", () => {
		expect(layout("> hi", markdown)).to.deep.equal([quote([text("hi")])]);
	});

	it("wraps a code block", () => {
		expect(layout("```x```", markdown)).to.deep.equal([codeBlock([text("x")])]);
	});

	it("carries the fence's language tag on the code block wrap", () => {
		expect(layout("```js\nlet x\n```", markdown)).to.deep.equal([
			codeBlock([text("let x")], "js"),
		]);
	});

	it("keeps two code blocks with different tags apart", () => {
		expect(layout("```js\na\n```\n```python\nb\n```", markdown)).to.deep.equal([
			codeBlock([text("a")], "js"),
			codeBlock([text("b")], "python"),
		]);
	});

	it("says nothing extra in the plain text of a tagged block", () => {
		expect(toPlainText(layout("```js\nlet x\n```", markdown))).to.equal("let x");
	});

	it("wraps a spoiler", () => {
		expect(layout("||s||", markdown)).to.deep.equal([spoiler([text("s")])]);
	});

	it("wraps a masked link around its children", () => {
		expect(layout("[c](https://example.com/)", markdown)).to.deep.equal([
			href("https://example.com/", [text("c")]),
		]);
	});

	it("splits a run of text that crosses a wrap boundary", () => {
		expect(layout("> a\nb", markdown)).to.deep.equal([quote([text("a")]), text("b")]);
	});

	it("keeps consecutive quote lines in one wrap", () => {
		// Regression: the newline joining the lines used to escape the wrap
		expect(layout("> a *b*\n> c", markdown)).to.deep.equal([
			quote([text("a "), text("b", {italic: true}), text("\nc")]),
		]);
	});
});

describe("layout — parts", () => {
	it("finds channels", () => {
		expect(layout("see #chan", {channelPrefixes: ["#"], userModes: ["@"]})).to.deep.equal([
			text("see "),
			{kind: "channel", channel: "#chan", children: [text("#chan")]},
		]);
	});

	it("finds nicks it was given", () => {
		expect(layout("hi alice", {users: ["alice"]})).to.deep.equal([
			text("hi "),
			{kind: "nick", nick: "alice", children: [text("alice")]},
		]);
	});

	it("finds emoji", () => {
		expect(layout("hi 😀")).to.deep.equal([
			text("hi "),
			{kind: "emoji", emoji: "😀", children: [text("😀")]},
		]);
	});

	it("finds links, keeping the styling of the text they cover", () => {
		expect(layout("**https://example.com/x**", markdown)).to.deep.equal([
			{
				kind: "link",
				link: "https://example.com/x",
				children: [text("https://example.com/x", {bold: true})],
			},
		]);
	});

	it("suppresses the finders inside verbatim text", () => {
		const options = {markdown: true, channelPrefixes: ["#"], userModes: ["@"]};

		expect(layout("`#chan`", options)).to.deep.equal([text("#chan", {monospace: true})]);
		expect(layout("#chan", options)).to.deep.equal([
			{kind: "channel", channel: "#chan", children: [text("#chan")]},
		]);
	});
});

describe("layout — monospace blocks", () => {
	const motd = "_____\n|  x  |\n \\_ _/";

	it("leaves a monospace block exactly as it came off the wire", () => {
		// Regression: the MOTD banner lost its `\_` when Markdown ran on it,
		// which is why monospace_block.vue renders with Markdown off
		expect(layout(motd)).to.deep.equal([text(motd)]);
	});

	it("still splits it per style run", () => {
		expect(layout("a\x02b\x02c")).to.deep.equal([
			text("a"),
			text("b", {bold: true}),
			text("c"),
		]);
	});
});

describe("toPlainText", () => {
	it("concatenates the text of every node, markers gone", () => {
		expect(toPlainText(layout("**a** `b` [c](https://example.com/)", markdown))).to.equal(
			"a b c"
		);
	});

	it("keeps what is not a marker", () => {
		expect(toPlainText(layout("> quoted\n> lines", markdown))).to.equal("quoted\nlines");
		expect(toPlainText(layout("**a** ||b||"))).to.equal("**a** ||b||");
	});

	it("reads through parts", () => {
		expect(
			toPlainText(layout("see #chan", {channelPrefixes: ["#"], userModes: ["@"]}))
		).to.equal("see #chan");
	});
});
