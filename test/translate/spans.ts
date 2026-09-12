import {expect} from "chai";
import {
	appendMissing,
	placeholder,
	placeholdersIn,
	protect,
	restore,
	restoreAll,
	stripCopiedNickPrefix,
	stripNickPrefix,
} from "../../client/js/translate/spans";

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
		expect(protect("Ja, gestern.")).to.deep.equal({text: "Ja, gestern.", spans: [], meta: []});
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
			meta: [{kind: "verbatim"}],
		});
	});

	describe("markdown, prefixes and nicks", () => {
		/** What an engine does to a line it translates: the placeholders survive. */
		const translated = (text: string) => `[en] ${text}`;

		it("makes an emphasis pair two markers that know each other", () => {
			const info = protect("this is supposed to be in *German*.");

			expect(info.text).to.equal(
				`this is supposed to be in ${placeholder(1)}German${placeholder(2)}.`
			);
			expect(info.spans).to.deep.equal(["*", "*"]);
			expect(info.meta).to.deep.equal([
				{kind: "marker", partner: 2},
				{kind: "marker", partner: 1},
			]);
			expect(restoreAll(info.text, info)).to.equal("this is supposed to be in *German*.");
		});

		it("a lost closer takes the opener with it, rather than leaving a stray marker", () => {
			const info = protect("*German*");

			expect(restoreAll(`${placeholder(1)}German`, info)).to.equal("German");
			expect(restoreAll("German", info)).to.equal("German");
		});

		it("matches the longest marker first, so ** is bold and not two italics", () => {
			const source = "**laut** und __unterstrichen__ und ~~weg~~ und ||geheim|| und *kursiv*";
			const info = protect(source);

			expect(info.spans).to.deep.equal([
				"**",
				"**",
				"__",
				"__",
				"~~",
				"~~",
				"||",
				"||",
				"*",
				"*",
			]);
			expect(info.text).to.equal(
				`${placeholder(1)}laut${placeholder(2)} und ${placeholder(
					3
				)}unterstrichen${placeholder(4)} und ${placeholder(5)}weg${placeholder(
					6
				)} und ${placeholder(7)}geheim${placeholder(8)} und ${placeholder(
					9
				)}kursiv${placeholder(10)}`
			);
			expect(restoreAll(info.text, info)).to.equal(source);
		});

		it("leaves arithmetic alone: 2*3*4 is not emphasis", () => {
			expect(protect("2*3*4 und 5_6_7")).to.deep.equal({
				text: "2*3*4 und 5_6_7",
				spans: [],
				meta: [],
			});
		});

		it("a link's text is translated between two markers and the target is untouched", () => {
			const info = protect("see [the build log](https://example.test/log) please");

			expect(info.text).to.equal(
				`see ${placeholder(2)}the build log${placeholder(3)} please`
			);
			expect(info.spans).to.deep.equal([
				"https://example.test/log",
				"[",
				`](${placeholder(1)})`,
			]);
			expect(restoreAll(translated(info.text), info)).to.equal(
				"[en] see [the build log](https://example.test/log) please"
			);
		});

		it("a fenced block spanning three lines is one span and the line count is kept", () => {
			const source = "erste Zeile\n```\nx = 1\n```\nletzte Zeile";
			const info = protect(source);

			expect(info.spans).to.deep.equal(["```\nx = 1\n```"]);
			expect(info.meta).to.deep.equal([{kind: "verbatim"}]);
			expect(info.text).to.equal(`erste Zeile\n${placeholder(1)}\nletzte Zeile`);

			const out = restoreAll(info.text, info);

			expect(out).to.equal(source);
			expect(out.split("\n")).to.have.length(source.split("\n").length);
		});

		it("a line's leading syntax is one prefix span, put back on its line when lost", () => {
			const info = protect("# Überschrift\n- erster Punkt\n> zitiert");

			expect(info.spans).to.deep.equal(["# ", "- ", "> "]);
			expect(info.meta).to.deep.equal([
				{kind: "prefix", line: 0},
				{kind: "prefix", line: 1},
				{kind: "prefix", line: 2},
			]);
			expect(info.text).to.equal(
				`${placeholder(1)}Überschrift\n${placeholder(2)}erster Punkt\n${placeholder(
					3
				)}zitiert`
			);
			// The engine dropped every prefix but kept the line count.
			expect(restoreAll("Heading\nfirst item\nquoted", info)).to.equal(
				"# Heading\n- first item\n> quoted"
			);
		});

		it("a prefix lost from a single line goes back to the front of it", () => {
			const info = protect("## Kapitel zwei");

			expect(restoreAll("Chapter two", info, placeholdersIn(info.text))).to.equal(
				"## Chapter two"
			);
		});

		it("protects a nick only as a whole word, longest first", () => {
			const info = protect("hallo alice, aliceland kennt alice nicht", {
				nicks: ["alice", "al", "x"],
			});

			expect(info.spans).to.deep.equal(["alice", "alice"]);
			expect(info.text).to.equal(
				`hallo ${placeholder(1)}, aliceland kennt ${placeholder(2)} nicht`
			);
			expect(restoreAll(translated(info.text), info)).to.equal(
				"[en] hallo alice, aliceland kennt alice nicht"
			);
		});

		it("a nick is never found inside a placeholder an earlier stage left", () => {
			const info = protect("siehe https://example.test/12 und 12 dort", {nicks: ["12"]});

			expect(info.spans).to.deep.equal(["https://example.test/12", "12"]);
			expect(info.text).to.equal(`siehe ${placeholder(1)} und ${placeholder(2)} dort`);
		});

		it("round-trips a line carrying every kind of syntax at once", () => {
			const source =
				"# Notiz für alice: siehe `make test`, *wichtig*, [Log](https://example.test/l) :tada:";
			const info = protect(source, {nicks: ["alice"]});

			expect(restoreAll(info.text, info)).to.equal(source);
			expect(restoreAll(translated(info.text), info)).to.equal(`[en] ${source}`);
		});

		it("drops a placeholder number the engine invented", () => {
			const info = protect("*so*");

			expect(
				restoreAll(`${placeholder(1)}so${placeholder(2)} ${placeholder(9)}`, info)
			).to.equal("*so* ");
		});
	});

	describe("stripNickPrefix", () => {
		const nicks = ["alice", "bob-2", "de1a2b"];

		it("drops a channel member's name copied in front of the translation", () => {
			expect(stripNickPrefix("alice: hello there", nicks)).to.equal("hello there");
			expect(stripNickPrefix("Alice: hello there", nicks)).to.equal("hello there");
			expect(stripNickPrefix("alice - hello there", nicks)).to.equal("hello there");
			expect(stripNickPrefix("alice – hello there", nicks)).to.equal("hello there");
			expect(stripNickPrefix("  alice : hello there", nicks)).to.equal("hello there");
			// A nick may carry the separator character itself.
			expect(stripNickPrefix("bob-2: hello there", nicks)).to.equal("hello there");
		});

		it("keeps a prefix that is not a name in the channel", () => {
			expect(stripNickPrefix("Moment: bitte warten", nicks)).to.equal("Moment: bitte warten");
			expect(stripNickPrefix("hello there", nicks)).to.equal("hello there");
			expect(stripNickPrefix("alice: hello there", [])).to.equal("alice: hello there");
			// Not a single token before the separator.
			expect(stripNickPrefix("dear alice: hello", nicks)).to.equal("dear alice: hello");
			// No space after the separator: a time, a ratio, a URL.
			expect(stripNickPrefix("alice:hello", nicks)).to.equal("alice:hello");
		});

		it("never crosses into a later line", () => {
			expect(stripNickPrefix("alice: one\ntwo", nicks)).to.equal("one\ntwo");
			expect(stripNickPrefix("one\nalice: two", nicks)).to.equal("one\nalice: two");
			expect(stripNickPrefix("alice:\nhello", nicks)).to.equal("alice:\nhello");
		});

		it("keeps the prefix the source itself carried", () => {
			// Addressing somebody is the commonest shape on IRC, and nick
			// protection sees it through the engine intact: that prefix is
			// not the model's to lose.
			expect(
				stripCopiedNickPrefix(
					"alice: can you check this?",
					"alice: kannst du das prüfen?",
					nicks
				)
			).to.equal("alice: can you check this?");
			// A prefix nobody wrote is the model copying its context.
			expect(
				stripCopiedNickPrefix("alice: can you check this?", "kannst du das prüfen?", nicks)
			).to.equal("can you check this?");
			// A source addressed to one name, an answer addressed to another:
			// still the source's prefix, so it stays.
			expect(stripCopiedNickPrefix("bob-2: hallo", "alice: hello", nicks)).to.equal(
				"bob-2: hallo"
			);
			// Neither side has one: nothing to do.
			expect(stripCopiedNickPrefix("hello there", "hallo zusammen", nicks)).to.equal(
				"hello there"
			);
		});
	});
});
