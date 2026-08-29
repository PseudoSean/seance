import {expect} from "chai";
import Prism from "prismjs/components/prism-core";
import {
	GUESS_MIN_CONFIDENCE,
	MIN_GUESS_LINES,
	ensureLanguage,
	guessLanguage,
	highlight,
	normalizeLang,
	splitLines,
} from "../../client/js/helpers/ircmessageparser/highlighter";

describe("highlighter — normalizeLang", () => {
	it("resolves Prism's aliases", () => {
		expect(normalizeLang("js")).to.equal("javascript");
		expect(normalizeLang("sh")).to.equal("bash");
		expect(normalizeLang("ts")).to.equal("typescript");
		expect(normalizeLang("yml")).to.equal("yaml");
	});

	it("takes the tag as written: case and surrounding space", () => {
		expect(normalizeLang("JS")).to.equal("javascript");
		expect(normalizeLang(" Python ")).to.equal("python");
	});

	it("knows the punctuation forms Prism's table has no alias for", () => {
		expect(normalizeLang("c++")).to.equal("cpp");
		expect(normalizeLang("c#")).to.equal("csharp");
	});

	it("says nothing for a tag Prism does not know", () => {
		expect(normalizeLang("nope")).to.equal(undefined);
		expect(normalizeLang("")).to.equal(undefined);
		expect(normalizeLang(undefined)).to.equal(undefined);
	});
});

describe("highlighter — splitLines", () => {
	it("splits on newlines", () => {
		expect(splitLines("a\nb\nc")).to.deep.equal(["a", "b", "c"]);
	});

	it("drops the empty line a trailing newline leaves", () => {
		expect(splitLines("a\nb\n")).to.deep.equal(["a", "b"]);
	});

	it("keeps a single line, empty or not", () => {
		expect(splitLines("a")).to.deep.equal(["a"]);
		expect(splitLines("")).to.deep.equal([""]);
	});
});

describe("highlighter — highlight", () => {
	before(() => {
		Prism.languages.stub = {kw: /\bfoo\b/};
	});

	after(() => {
		delete Prism.languages.stub;
	});

	it("names the token types and leaves the rest bare", () => {
		expect(highlight("foo bar", "stub")).to.deep.equal([
			[{text: "foo", type: "kw"}, {text: " bar"}],
		]);
	});

	it("breaks a token that spans a newline into one array per line", () => {
		expect(highlight("a foo\nfoo b", "stub")).to.deep.equal([
			[{text: "a "}, {text: "foo", type: "kw"}],
			[{text: "foo", type: "kw"}, {text: " b"}],
		]);
	});

	it("gives one array per line, empty lines included", () => {
		expect(highlight("foo\n\nfoo", "stub")).to.deep.equal([
			[{text: "foo", type: "kw"}],
			[],
			[{text: "foo", type: "kw"}],
		]);
	});

	it("says nothing when the grammar is not loaded", () => {
		expect(highlight("foo", "notloaded")).to.equal(undefined);
		expect(highlight("foo", undefined)).to.equal(undefined);
	});
});

describe("highlighter — ensureLanguage", () => {
	it("loads a grammar and its dependencies", async () => {
		expect(highlight("const x = 1;", "javascript")).to.equal(undefined);
		expect(await ensureLanguage("javascript")).to.be.true;
		// javascript extends clike, which has to be there first
		expect(Prism.languages.clike).to.not.equal(undefined);

		const lines = highlight("const x = 1;", "javascript");

		expect(lines).to.have.lengthOf(1);
		expect(lines![0][0]).to.deep.equal({text: "const", type: "keyword"});
	});

	it("takes an alias", async () => {
		expect(await ensureLanguage("js")).to.be.true;
	});

	it("says so when the language is not one of Prism's", async () => {
		expect(await ensureLanguage("nope")).to.be.false;
	});
});

describe("highlighter — guessLanguage", () => {
	it("does not guess a block shorter than MIN_GUESS_LINES", async () => {
		expect(MIN_GUESS_LINES).to.equal(2);
		expect(await guessLanguage("const x = 1;")).to.equal(undefined);
	});

	it("guesses a multi-line snippet and answers with a Prism id", async () => {
		const code = "def add(a, b):\n    return a + b\n\nprint(add(1, 2))";

		expect(await guessLanguage(code)).to.equal("python");
	});

	it("says nothing when nothing looks like code", async () => {
		expect(GUESS_MIN_CONFIDENCE).to.be.within(0, 1);
		expect(await guessLanguage("hello there\nnothing to see here\n")).to.equal(undefined);
	});
});
