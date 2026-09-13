import {expect} from "chai";
import {after, before, describe, it} from "mocha";
import sinon from "sinon";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {parsePo} from "../../tools/i18n/po";
import {addToPot} from "../../tools/i18n/add";
import {checkPot} from "../../tools/i18n/check";
import {compileLocales, CompileResult, pseudo} from "../../tools/i18n/compile";
import {mergePo} from "../../tools/i18n/merge";

const FIXTURES = resolve("tools/i18n/fixtures");

interface AvailableEntry {
	tag: string;
	devOnly?: boolean;
}

describe("i18n toolchain", () => {
	let tmp: string;

	before(() => {
		tmp = mkdtempSync(join(tmpdir(), "seance-i18n-"));
	});

	after(() => {
		rmSync(tmp, {recursive: true, force: true});
	});

	/** Compile one fixture tree into its own scratch directory. */
	function compileFixture(name: string): CompileResult {
		const outDir = join(tmp, name.split("/").join("-"));
		return compileLocales({
			localesDir: join(FIXTURES, name),
			outDir,
			availablePath: join(outDir, "available.ts"),
			tagsPath: join(outDir, "tags.json"),
		});
	}

	describe("compile", () => {
		it("maps a de.po plural entry through nplurals=2 onto the CLDR categories", () => {
			expect(new Intl.PluralRules("de").select(1)).to.equal("one");
			expect(new Intl.PluralRules("de").select(3)).to.equal("other");

			const result = compileFixture("compile/plural");
			expect(result.catalogs.de).to.deep.equal({
				"condensed.join": {
					one: "{count} Benutzer ist beigetreten",
					other: "{count} Benutzer sind beigetreten",
				},
				"connect.submit": "Verbinden",
			});
			// The written file parses back to the same catalog.
			const written = JSON.parse(
				readFileSync(join(tmp, "compile-plural", "de.json"), "utf8")
			);
			expect(written).to.deep.equal(result.catalogs.de);
		});

		it("compiles en from the pot itself: the msgids are the English copy", () => {
			const result = compileFixture("compile/plural");
			expect(result.catalogs.en).to.deep.equal({
				"condensed.join": {
					one: "{count} user has joined",
					other: "{count} users have joined",
				},
				"connect.submit": "Connect",
			});
		});

		it("skips #, fuzzy entries and warns about them on stderr", () => {
			const warn = sinon.stub(console, "warn");

			try {
				const result = compileFixture("compile/fuzzy");
				// The fuzzy entry is left out entirely so the runtime falls back
				// to en for its key.
				expect(result.catalogs.fr).to.deep.equal({"good.key": "Bon"});
				expect(result.warnings.join("\n")).to.match(/fuzzy\.target/);
				expect(warn.calledWithMatch(/fuzzy\.target/)).to.equal(true);
				expect(result.warnings.join("\n")).to.not.contain("untranslated.key");
			} finally {
				warn.restore();
			}
		});

		it("fails on a {placeholder} the translation lost, naming the key", () => {
			expect(() => compileFixture("compile/placeholder")).to.throw(/activity\.join/);
		});

		it("omits untranslated entries so the runtime falls back to en", () => {
			// "untranslated.key" (singular) and "untranslated.plural" (no filled
			// category) carry no translation in the fixture. The runtime falls
			// back to en on key ABSENCE, so a present-but-empty value would
			// shadow en: compile leaves the key out entirely — without
			// inventing a translation and without failing.
			const warn = sinon.stub(console, "warn");

			try {
				const result = compileFixture("compile/fuzzy");
				expect(result.catalogs.fr).to.deep.equal({"good.key": "Bon"});
				expect(result.warnings.join("\n")).to.not.contain("untranslated.key");
				expect(result.warnings.join("\n")).to.not.contain("untranslated.plural");
			} finally {
				warn.restore();
			}
		});

		it("keeps the intentional empty copy in en.json and omits it from qqx", () => {
			// "intentional.empty" is English copy that happens to be empty
			// (like connect.signInIntro): en.json keeps it verbatim, while the
			// qqx overlay leaves it out — en serves the key at runtime.
			const warn = sinon.stub(console, "warn");

			try {
				const result = compileFixture("compile/fuzzy");
				expect(result.catalogs.en["intentional.empty"]).to.equal("");
				expect(result.catalogs.qqx).to.not.have.property("intentional.empty");
			} finally {
				warn.restore();
			}
		});
	});

	describe("pseudo locale", () => {
		it("qqx mirrors en: same keys, same text in every plural category", () => {
			const result = compileFixture("compile/plural");
			const en = result.catalogs.en;
			const qqx = result.catalogs.qqx;
			expect(Object.keys(qqx).sort()).to.deep.equal(Object.keys(en).sort());
			const forms = qqx["condensed.join"] as Record<string, string>;
			expect(forms.one).to.equal(forms.other);
			expect(forms.one).to.contain("{count}");
			// Written next to the real catalogs.
			const written = JSON.parse(
				readFileSync(join(tmp, "compile-plural", "qqx.json"), "utf8")
			);
			expect(written).to.deep.equal(qqx);
		});

		it("pseudo() wraps in RLE/PDF, doubles the text, keeps {name} tokens", () => {
			const out = pseudo("{count} users have joined");
			expect(out.startsWith("\u202B")).to.equal(true);
			expect(out.endsWith("\u202C")).to.equal(true);
			const inner = out.slice(1, -1);
			expect(inner.length % 2).to.equal(0);
			expect(inner.slice(inner.length / 2)).to.equal(inner.slice(0, inner.length / 2));
			expect(out).to.contain("{count}");
			// Brackets mirror, letters turn into accented lookalikes.
			expect(pseudo("(a)")).to.equal("\u202B)à()à(\u202C");
		});
	});

	describe("generated available.ts and tags.json", () => {
		it("parses and lists en, the fixture's tag and the dev-only pseudo locale", () => {
			compileFixture("compile/plural");
			const text = readFileSync(join(tmp, "compile-plural", "available.ts"), "utf8");
			const literal = /export const AVAILABLE = ([\s\S]*?) as const;/.exec(text);
			expect(literal).to.not.equal(null);
			// The generated literal is TS (bare keys, trailing comma); read it
			// back as JSON by quoting the keys and dropping the comma.
			const json = literal![1]
				.replace(/([{,]\s*)(\w+):/g, '$1"$2":')
				.replace(/,(\s*\])$/, "$1");
			const available = JSON.parse(json) as AvailableEntry[];
			expect(available).to.deep.equal([
				{tag: "en"},
				{tag: "de"},
				{tag: "qqx", devOnly: true},
			]);
			expect(text).to.contain("export type AvailableLocale = ");
			expect(text).to.match(/^export const DEV = (?:true|false);\n$/m);
			expect(
				JSON.parse(readFileSync(join(tmp, "compile-plural", "tags.json"), "utf8"))
			).to.deep.equal(["en", "de", "qqx"]);
		});
	});

	describe("merge", () => {
		const options = {
			potPath: join(FIXTURES, "merge/messages.pot"),
			poPath: join(FIXTURES, "merge/de.po"),
			tag: "de",
		};

		it("keeps msgstr on exact match, fuzzies drift, appends new keys empty, drops orphans", () => {
			const outcome = mergePo(options);
			expect(outcome.added).to.deep.equal(["condensed.join"]);
			expect(outcome.fuzzied).to.deep.equal(["connect.title"]);
			expect(outcome.dropped).to.deep.equal(["old.key"]);

			const {headers, entries} = parsePo(outcome.text);
			expect(entries.map((entry) => entry.msgctxt)).to.deep.equal([
				"connect.title",
				"help.about",
				"condensed.join",
			]);
			// Drifted: the pot's msgid is adopted, the translation survives, the
			// entry is marked for review.
			expect(entries[0].msgid).to.equal("Connect to IRC");
			expect(entries[0].msgstr).to.deep.equal(["Mit IRC verbinden"]);
			expect(entries[0].flags).to.deep.equal(["fuzzy"]);
			expect(entries[0].context).to.deep.equal([
				"Heading of the connect form (features.signIn off).",
			]);
			expect(entries[0].loc).to.deep.equal(["client/components/Windows/Connect.vue:107"]);
			// Exact match: translation kept, no fuzzy.
			expect(entries[1].msgstr).to.deep.equal(["Über"]);
			expect(entries[1].flags).to.deep.equal([]);
			// New from the pot: plural shape, empty slots.
			expect(entries[2].msgid).to.equal("{count} user has joined");
			expect(entries[2].msgidPlural).to.equal("{count} users have joined");
			expect(entries[2].msgstr).to.deep.equal(["", ""]);
			expect(entries[2].flags).to.deep.equal([]);
			// And it round-trips.
			expect(parsePo(outcome.text).entries).to.deep.equal(entries);
		});

		it("rewrites the Language and Plural-Forms headers from plural-rules.json", () => {
			const {headers} = parsePo(mergePo(options).text);
			expect(headers.language).to.equal("de");
			expect(headers["plural-forms"]).to.equal("nplurals=2; plural=(n != 1);");
		});
	});

	describe("add", () => {
		const args = {
			key: "connect.title",
			msgid: "Connect to IRC",
			context: ["Heading of the connect form."],
			loc: ["client/js/branding.ts"],
		};

		it("creates the pot on first use, then upserts idempotently", () => {
			const potPath = join(tmp, "add", "messages.pot");
			const first = addToPot(potPath, args);
			expect(first.created).to.equal(true);
			expect(first.drifted).to.equal(false);
			const {headers, entries} = parsePo(first.text);
			expect(headers.language).to.equal("");
			expect(headers["plural-forms"]).to.equal("nplurals=2; plural=(n != 1);");
			expect(entries).to.deep.equal([
				{
					loc: ["client/js/branding.ts"],
					context: ["Heading of the connect form."],
					flags: [],
					msgctxt: "connect.title",
					msgid: "Connect to IRC",
					// serializePo writes `msgstr ""`; parsing it back yields [""].
					msgstr: [""],
				},
			]);

			// The same call again: no new entry, no drift, same bytes.
			const again = addToPot(potPath, args);
			expect(again.created).to.equal(false);
			expect(again.drifted).to.equal(false);
			expect(parsePo(again.text).entries).to.deep.equal(entries);
		});

		it("replaces context, unions loc, sorts by key and flags msgid drift", () => {
			const potPath = join(tmp, "add-drift", "messages.pot");
			addToPot(potPath, {key: "b.key", msgid: "B", context: ["One."], loc: ["a.ts:1"]});
			addToPot(potPath, {key: "a.key", msgid: "A", context: ["Two.", "Three."], loc: []});

			const outcome = addToPot(potPath, {
				key: "b.key",
				msgid: "B2",
				context: ["Replaced."],
				loc: ["b.ts:2"],
			});
			expect(outcome.created).to.equal(false);
			expect(outcome.drifted).to.equal(true);

			const {entries} = parsePo(readFileSync(potPath, "utf8"));
			expect(entries.map((entry) => entry.msgctxt)).to.deep.equal(["a.key", "b.key"]);
			expect(entries[1].context).to.deep.equal(["Replaced."]);
			expect(entries[1].loc).to.deep.equal(["a.ts:1", "b.ts:2"]);
			expect(entries[1].msgid).to.equal("B2");
		});

		it("adds plural entries with empty msgstr slots", () => {
			const potPath = join(tmp, "add-plural", "messages.pot");
			addToPot(potPath, {
				key: "condensed.join",
				msgid: "{count} user has joined",
				plural: "{count} users have joined",
				context: ["Condensed."],
				loc: [],
			});
			const {entries} = parsePo(readFileSync(potPath, "utf8"));
			expect(entries[0].msgidPlural).to.equal("{count} users have joined");
			expect(entries[0].msgstr).to.deep.equal(["", ""]);
		});
	});

	describe("check", () => {
		const potPath = join(FIXTURES, "check/messages.pot");
		const tree = join(FIXTURES, "check/client");

		it("fails a call-site key that is missing from the pot", () => {
			const problems = checkPot(potPath, [tree]);
			expect(problems.missing).to.deep.equal(["widget.missing"]);
		});

		it("fails a pot key that no call site references", () => {
			const problems = checkPot(potPath, [tree]);
			expect(problems.unreferenced).to.deep.equal(["orphan.key"]);
		});

		it("fails a pot entry without a #. context line", () => {
			const problems = checkPot(potPath, [tree]);
			expect(problems.missingContext).to.deep.equal(["nocontext.key"]);
		});

		it("ignores commented-out call sites and the i18n implementation itself", () => {
			const problems = checkPot(potPath, [tree]);
			// "widget.gone" appears only in a comment and "i18n.internal" only
			// in the i18n implementation directory: neither is a call site, so
			// the missing list stays at the one genuinely missing key.
			expect(problems.missing).to.deep.equal(["widget.missing"]);
		});
	});
});
