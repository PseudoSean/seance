import {expect} from "chai";
import {
	codeBlocksOf,
	layout,
	LayoutNode,
	Style,
	toPlainText,
} from "../../client/js/helpers/ircmessageparser/layout";
import {HeaderLevel} from "../../client/js/helpers/ircmessageparser/parseStyle";

// Builders, so the assertions read as the tree they describe.
const text = (value: string, style: Style = {}): LayoutNode => ({
	kind: "text",
	text: value,
	style,
});

const quote = (children: LayoutNode[]): LayoutNode => ({kind: "wrap", wrap: "quote", children});

const header = (level: HeaderLevel, children: LayoutNode[]): LayoutNode => ({
	kind: "wrap",
	wrap: "header",
	level,
	children,
});

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

	// The Vue adapter renders a code block from `toPlainText` of its children,
	// so this link is flattened back into the code: the verbatim spans suppress
	// the channel/nick/emoji finders inside a block, but not `findLinks`.
	it("still finds a link inside a code block", () => {
		expect(layout("```see https://example.com/ ok```", markdown)).to.deep.equal([
			codeBlock([
				text("see "),
				{
					kind: "link",
					link: "https://example.com/",
					children: [text("https://example.com/")],
				},
				text(" ok"),
			]),
		]);
	});

	// The other half of the rule above, and the one that decides what is on
	// screen: `parse.ts` builds a code block from `toPlainText` of its
	// children, so the link node never becomes an anchor. A code block renders
	// its characters and nothing else — inline `` `code` `` keeps its link.
	it("renders a code block from its characters alone", () => {
		const nodes = layout("```see https://example.com/ ok```", markdown);
		const block = nodes[0];

		expect(nodes).to.have.lengthOf(1);
		expect(block.kind).to.equal("wrap");

		if (block.kind !== "wrap") {
			return;
		}

		expect(toPlainText(block.children)).to.equal("see https://example.com/ ok");
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

	it("wraps a header", () => {
		expect(layout("# Title", markdown)).to.deep.equal([header(1, [text("Title")])]);
	});

	it("styles the text inside a header", () => {
		expect(layout("# a **b**", markdown)).to.deep.equal([
			header(1, [text("a "), text("b", {bold: true})]),
		]);
	});

	it("wraps a header inside the quote it sits in", () => {
		expect(layout("> # q", markdown)).to.deep.equal([quote([header(1, [text("q")])])]);
	});

	it("finds a channel inside a header", () => {
		const options = {markdown: true, channelPrefixes: ["#"], userModes: ["@"]};

		expect(layout("# see #chan", options)).to.deep.equal([
			header(1, [
				text("see "),
				{kind: "channel", channel: "#chan", children: [text("#chan")]},
			]),
		]);
	});

	it("leaves no stray newline around a header line", () => {
		expect(layout("x\n# H\ny", markdown)).to.deep.equal([
			text("x"),
			header(1, [text("H")]),
			text("y"),
		]);
	});

	it("keeps two header levels in wraps of their own", () => {
		expect(layout("# A\n## B", markdown)).to.deep.equal([
			header(1, [text("A")]),
			header(2, [text("B")]),
		]);
	});

	it("leaves the hashes alone when Markdown is off", () => {
		expect(layout("# Title")).to.deep.equal([text("# Title")]);
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

	it("says a header as the line it is", () => {
		expect(toPlainText(layout("# Title", markdown))).to.equal("Title");
	});

	it("reads through parts", () => {
		expect(
			toPlainText(layout("see #chan", {channelPrefixes: ["#"], userModes: ["@"]}))
		).to.equal("see #chan");
	});
});

// What the message toolbar's "Copy code" action puts on the clipboard: the
// blocks a message renders, each as its own characters.
describe("codeBlocksOf", () => {
	it("finds nothing in a message without a block", () => {
		expect(codeBlocksOf(layout("plain `inline` text", markdown))).to.deep.equal([]);
	});

	it("finds nothing when Markdown is off", () => {
		expect(codeBlocksOf(layout("```let x = 1;```"))).to.deep.equal([]);
	});

	it("returns a block's characters, fence and tag gone", () => {
		expect(codeBlocksOf(layout("```js\nlet x = 1;\n```", markdown))).to.deep.equal([
			"let x = 1;",
		]);
	});

	it("keeps a URL inside a block as text", () => {
		expect(codeBlocksOf(layout("```see https://example.com/```", markdown))).to.deep.equal([
			"see https://example.com/",
		]);
	});

	it("returns several blocks in the order they render", () => {
		expect(codeBlocksOf(layout("```one``` between ```two```", markdown))).to.deep.equal([
			"one",
			"two",
		]);
	});

	it("reads a block out of the wrap it sits in", () => {
		expect(codeBlocksOf(layout("> quoted ```inside```", markdown))).to.deep.equal(["inside"]);
	});
});
