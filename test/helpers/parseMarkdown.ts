import {expect} from "chai";
import {applyMarkdown} from "../../client/js/helpers/ircmessageparser/parseMarkdown";
import parseStyle, {ParsedStyle} from "../../client/js/helpers/ircmessageparser/parseStyle";

// The Markdown flags a rendered fragment can carry.
const FLAGS: (keyof ParsedStyle)[] = [
	"bold",
	"italic",
	"underline",
	"strikethrough",
	"monospace",
	"codeBlock",
	"quote",
	"spoiler",
	"href",
];

type Rendered = Record<string, unknown>;

// What the Markdown stage makes of `input`: the text with the markers removed,
// split into fragments, each carrying only the flags that are set. Reads like
// the spec's syntax table, and says nothing about offsets — where the tokenizer
// happens to put a fragment boundary is not behaviour.
function md(input: string): Rendered[] {
	const {fragments} = applyMarkdown(parseStyle(input));

	return fragments.map((fragment) => {
		const rendered: Rendered = {text: fragment.text};

		for (const flag of FLAGS) {
			if (fragment[flag]) {
				rendered[flag] = fragment[flag];
			}
		}

		return rendered;
	});
}

// The message as the user sees it, markers gone.
function plain(input: string): string {
	return applyMarkdown(parseStyle(input))
		.fragments.map((fragment) => fragment.text)
		.join("");
}

// The stretches nothing is interpreted inside, as text rather than as offsets.
function verbatimText(input: string): string[] {
	const {fragments, verbatim} = applyMarkdown(parseStyle(input));
	const text = fragments.map((fragment) => fragment.text).join("");

	return verbatim.map((range) => text.slice(range.start, range.end));
}

describe("markdown — bold", () => {
	it("renders **text** bold", () => {
		expect(md("a **b** c")).to.deep.equal([
			{text: "a "},
			{text: "b", bold: true},
			{text: " c"},
		]);
	});

	it("leaves an unmatched ** literal", () => {
		expect(md("**a")).to.deep.equal([{text: "**a"}]);
		expect(md("a**")).to.deep.equal([{text: "a**"}]);
	});
});

describe("markdown — italic", () => {
	it("renders *text* and _text_ italic", () => {
		expect(md("*a*")).to.deep.equal([{text: "a", italic: true}]);
		expect(md("_a_")).to.deep.equal([{text: "a", italic: true}]);
	});

	it("italicises asterisks inside words", () => {
		expect(md("un*believ*able")).to.deep.equal([
			{text: "un"},
			{text: "believ", italic: true},
			{text: "able"},
		]);
	});

	it("leaves underscores inside words alone", () => {
		expect(md("snake_case_name")).to.deep.equal([{text: "snake_case_name"}]);
		expect(md("foo__bar__baz")).to.deep.equal([{text: "foo__bar__baz"}]);
	});
});

describe("markdown — underline and strikethrough", () => {
	it("renders __text__ underlined", () => {
		expect(md("__a__")).to.deep.equal([{text: "a", underline: true}]);
	});

	it("renders ~~text~~ struck through", () => {
		expect(md("~~a~~")).to.deep.equal([{text: "a", strikethrough: true}]);
	});

	it("needs both tildes", () => {
		expect(md("~a~")).to.deep.equal([{text: "~a~"}]);
	});
});

describe("markdown — spoiler", () => {
	it("renders ||text|| as a spoiler", () => {
		expect(md("||a||")).to.deep.equal([{text: "a", spoiler: true}]);
	});

	it("needs both bars", () => {
		expect(md("|a|")).to.deep.equal([{text: "|a|"}]);
	});
});

describe("markdown — inline code", () => {
	it("renders `text` monospace and interprets nothing inside it", () => {
		expect(md("`a`")).to.deep.equal([{text: "a", monospace: true}]);
		expect(md("`**x**`")).to.deep.equal([{text: "**x**", monospace: true}]);
	});

	it("reports the code as verbatim, so the finders skip it", () => {
		expect(verbatimText("a `#chan` b")).to.deep.equal(["#chan"]);
		expect(verbatimText("a #chan b")).to.deep.equal([]);
	});

	it("leaves empty or unmatched backticks literal", () => {
		expect(md("``")).to.deep.equal([{text: "``"}]);
		expect(md("a ` b")).to.deep.equal([{text: "a ` b"}]);
	});
});

describe("markdown — code block", () => {
	it("renders a single-line ```block```", () => {
		expect(md("```code```")).to.deep.equal([{text: "code", codeBlock: true}]);
	});

	it("drops the language tag and the newlines around the fences", () => {
		expect(md("before\n```js\nlet x = 1;\n```\nafter")).to.deep.equal([
			{text: "before"},
			{text: "let x = 1;", codeBlock: true},
			{text: "after"},
		]);
	});

	it("reports the block as verbatim", () => {
		expect(verbatimText("```code```")).to.deep.equal(["code"]);
	});

	it("leaves an unclosed fence literal", () => {
		expect(md("```nope")).to.deep.equal([{text: "```nope"}]);
	});
});

describe("markdown — quote", () => {
	it("renders a `> ` line as a quote without its marker", () => {
		expect(md("> hi *there*")).to.deep.equal([
			{text: "hi ", quote: true},
			{text: "there", italic: true, quote: true},
		]);
	});

	it("merges consecutive quote lines and ends the block at the blank line", () => {
		expect(md("> a\n> b\nc")).to.deep.equal([{text: "a\nb", quote: true}, {text: "c"}]);
	});

	it("merges consecutive quote lines when the first one holds inline markup", () => {
		// Regression: the newline joining the lines used to escape the block
		expect(md("> a *b*\n> c")).to.deep.equal([
			{text: "a ", quote: true},
			{text: "b", italic: true, quote: true},
			{text: "\nc", quote: true},
		]);
	});

	it("only quotes a `> ` at the start of a line", () => {
		expect(md("a > b")).to.deep.equal([{text: "a > b"}]);
		expect(md(">b")).to.deep.equal([{text: ">b"}]);
	});
});

describe("markdown — masked links", () => {
	it("renders [text](url) with the url behind the text", () => {
		expect(md("[site](https://example.com/a)")).to.deep.equal([
			{text: "site", href: "https://example.com/a"},
		]);
	});

	it("accepts web+irc: links", () => {
		expect(md("[c](web+irc://irc.example.org/#chan)")).to.deep.equal([
			{text: "c", href: "web+irc://irc.example.org/#chan"},
		]);
	});

	it("allows one level of balanced parentheses in the url", () => {
		expect(md("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))")).to.deep.equal([
			{text: "wiki", href: "https://en.wikipedia.org/wiki/Foo_(bar)"},
		]);
	});

	it("matches the scheme case-insensitively", () => {
		expect(md("[x](HTTPS://e.test)")).to.deep.equal([{text: "x", href: "HTTPS://e.test"}]);
	});

	it("interprets markup in the link text", () => {
		expect(md("[**b**](https://e.com)")).to.deep.equal([
			{text: "b", bold: true, href: "https://e.com"},
		]);
	});

	it("rejects other schemes and malformed syntax", () => {
		expect(md("[x](javascript:alert(1))")).to.deep.equal([{text: "[x](javascript:alert(1))"}]);
		expect(md("[x](ftp://e.com)")).to.deep.equal([{text: "[x](ftp://e.com)"}]);
		expect(md("[x] (https://e.com)")).to.deep.equal([{text: "[x] (https://e.com)"}]);
	});
});

describe("markdown — escapes", () => {
	it("takes a backslash-escaped marker literally", () => {
		expect(md("\\*not italic\\*")).to.deep.equal([{text: "*not italic*"}]);
		expect(md("\\\\")).to.deep.equal([{text: "\\"}]);
	});

	it("leaves a backslash before an ordinary character alone", () => {
		expect(md("a\\b")).to.deep.equal([{text: "a\\b"}]);
	});

	it("keeps a backslash at the end of the text", () => {
		// Regression: the trailing backslash used to swallow itself
		expect(md("a\\")).to.deep.equal([{text: "a\\"}]);
		expect(md("C:\\")).to.deep.equal([{text: "C:\\"}]);
	});
});

describe("markdown — nesting and malformed markers", () => {
	it("nests ***bold italic***", () => {
		expect(md("***a***")).to.deep.equal([{text: "a", bold: true, italic: true}]);
	});

	it("nests italic inside bold", () => {
		expect(md("**bold *and italic* text**")).to.deep.equal([
			{text: "bold ", bold: true},
			{text: "and italic", bold: true, italic: true},
			{text: " text", bold: true},
		]);
	});

	it("needs a non-space next to the markers", () => {
		expect(md("** a **")).to.deep.equal([{text: "** a **"}]);
		expect(md("2 * 3 * 4")).to.deep.equal([{text: "2 * 3 * 4"}]);
	});

	it("merges neighbouring spans that end up identical", () => {
		expect(md("**a****b**")).to.deep.equal([{text: "ab", bold: true}]);
	});
});

describe("markdown — urls are opaque", () => {
	it("never reads markers inside a url", () => {
		expect(md("see https://example.com/a_b_c_d ok")).to.deep.equal([
			{text: "see https://example.com/a_b_c_d ok"},
		]);
	});

	it("still styles markup wrapped around a url", () => {
		// linkify-it swallows the trailing "**" into the url; the tokenizer
		// trims it back off so the bold span closes
		expect(md("**https://example.com/x**")).to.deep.equal([
			{text: "https://example.com/x", bold: true},
		]);
	});
});

describe("markdown — composition", () => {
	it("composes with IRC control codes", () => {
		expect(md("\x02x *y*\x02 z")).to.deep.equal([
			{text: "x ", bold: true},
			{text: "y", bold: true, italic: true},
			{text: " z"},
		]);
	});

	it("splits a styled fragment around a marker", () => {
		expect(md("\x1dab `c` d\x1d")).to.deep.equal([
			{text: "ab ", italic: true},
			{text: "c", italic: true, monospace: true},
			{text: " d", italic: true},
		]);
	});

	// `verbatim` is not a style key, so an IRC monospace run and the inline code
	// next to it are one fragment and render as one `.irc-monospace` pill.
	it("merges an IRC monospace run into the inline code beside it", () => {
		expect(md("\x11a\x11`b`")).to.deep.equal([{text: "ab", monospace: true}]);
	});

	it("carries every wrap flag at once", () => {
		expect(md("[t](https://e.com) ||s||")).to.deep.equal([
			{text: "t", href: "https://e.com"},
			{text: " "},
			{text: "s", spoiler: true},
		]);
		expect(md("> q\n```c```")).to.deep.equal([
			{text: "q", quote: true},
			{text: "c", codeBlock: true},
		]);
	});

	it("leaves plain text and its fragments untouched", () => {
		const input = parseStyle("plain");

		expect(applyMarkdown(input).fragments).to.equal(input);
		expect(applyMarkdown(input).verbatim).to.deep.equal([]);
	});

	it("handles empty input", () => {
		expect(applyMarkdown([]).fragments).to.deep.equal([]);
	});
});
