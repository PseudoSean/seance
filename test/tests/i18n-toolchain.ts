import {expect} from "chai";
import {after, before, describe, it} from "mocha";
import sinon from "sinon";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {parsePo} from "../../tools/i18n/po";
import {addToPot} from "../../tools/i18n/add";
import {ALLOWED_UNREFERENCED, ALLOWED_DYNAMIC, checkPot} from "../../tools/i18n/check";
import {POT_PATH} from "../../tools/i18n/paths";
import {categoryIndexMap, compileLocales, Catalog, CompileResult} from "../../tools/i18n/compile";
import {parseTargets, TARGETS_SOURCE} from "../../tools/i18n/targets";
import {PLURAL_RULES, planPluralSlots, pluralEval} from "../../tools/i18n/plural";
import {isRTL} from "../../client/js/i18n/core";
import {pseudo} from "../../tools/i18n/pseudo";
import {mergePo} from "../../tools/i18n/merge";
import {scaffoldTag} from "../../tools/i18n/scaffold";
import {sweepEntries} from "../../tools/i18n/sweep";
import {isSuspectCatalogEntry} from "../../tools/i18n/quality";
import instrument from "../../tools/i18n/instrument-loader.mjs";

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
		it("maps a CLDR category to the gettext slot of the count CLDR samples it with", () => {
			// The probe is what CLDR's categories expect, not what gettext's
			// expression hits first: CLDR puts pt's 0 in "one" while the
			// expression (n != 1) puts it in slot 1, so scanning from n = 0
			// used to send "one" to the plural slot and leave the singular
			// slot unreadable (pt lost condensed.away entirely).
			expect(categoryIndexMap("pt", "n != 1")).to.deep.equal({one: 0, other: 1});
			// tr's (n > 1) is 0 at n = 0, where CLDR says "other" — the
			// singular slot would swallow the plural.
			expect(categoryIndexMap("tr", "(n > 1)")).to.deep.equal({one: 0, other: 1});
			// A five-slot rule, every category reached by an integer.
			expect(
				categoryIndexMap("ga", "(n==1) ? 0 : (n==2) ? 1 : (n<7) ? 2 : (n<11) ? 3 : 4")
			).to.deep.equal({one: 0, two: 1, few: 2, many: 3, other: 4});
			// ru has no integer in CLDR "other" (it is the fractions'
			// category), so "other" takes the expression's catch-all slot.
			expect(
				categoryIndexMap(
					"ru",
					"(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)"
				)
			).to.deep.equal({one: 0, few: 1, many: 2, other: 2});
			// fa is not a shipped target, but its rule is in the table and
			// "n > 0 ? 1 : 0" sent both categories to slot 1 — the singular
			// for every count, invisibly (the slot is filled, so the
			// all-or-nothing gate is happy).
			expect(categoryIndexMap("fa", PLURAL_RULES.fa.expr)).to.deep.equal({
				one: 0,
				other: 1,
			});
		});

		it("omits a plural entry that has not filled every mapped slot", () => {
			// "partial.plural" carries msgstr[0] only. A half-translated
			// plural rendered every count as the singular; the key is left
			// out instead, so the runtime serves the whole entry from en.
			const warn = sinon.stub(console, "warn");

			try {
				const result = compileFixture("compile/fuzzy");
				expect(result.catalogs.fr).to.not.have.property("partial.plural");
			} finally {
				warn.restore();
			}
		});

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

		it("prunes a compiled catalog whose tag is no longer a target", () => {
			// A dropped language leaves its .po behind (sync.ts archives it)
			// but its compiled catalog used to sit in client/locales until
			// someone deleted it by hand — and the build copies whatever is
			// there into public/.
			const outDir = join(tmp, "compile-plural");
			compileFixture("compile/plural");
			writeFileSync(join(outDir, "zz.json"), "{}\n");
			compileFixture("compile/plural");
			expect(existsSync(join(outDir, "zz.json")), "stray zz.json pruned").to.equal(false);
			// The catalogs of this run, and the generated tag list, stay.
			expect(existsSync(join(outDir, "de.json"))).to.equal(true);
			expect(existsSync(join(outDir, "en.json"))).to.equal(true);
			expect(existsSync(join(outDir, "tags.json"))).to.equal(true);
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

	describe("the committed catalogs", () => {
		// The REAL shipped files, not fixtures: qqx is regenerated from en on
		// every compile, so these two pins fail the moment the generator and
		// the compile rulings drift apart (committed en.json is the source of
		// truth for both).
		const en = JSON.parse(readFileSync(resolve("client/locales/en.json"), "utf8")) as Catalog;
		const qqx = JSON.parse(readFileSync(resolve("client/locales/qqx.json"), "utf8")) as Catalog;

		/** An en value with nothing in it: the intentional-empty copy the
		 * compile ruling keeps out of qqx (en serves the key at runtime). */
		const isEmptyEn = (value: string | Record<string, string>): boolean =>
			value === "" || Object.keys(value).length === 0;

		it("covers every en key whose en value is non-empty, and nothing else", () => {
			const expected = Object.keys(en).filter((key) => !isEmptyEn(en[key]));
			expect(expected.length, "en keys the runtime can serve").to.be.greaterThan(0);
			expect(
				expected.filter((key) => !(key in qqx)),
				"non-empty en keys missing from qqx"
			).to.deep.equal([]);
			expect(
				Object.keys(qqx).filter((key) => !(key in en) || isEmptyEn(en[key])),
				"keys qqx carries without a translatable en value"
			).to.deep.equal([]);
			expect(Object.keys(qqx).length).to.equal(expected.length);
		});

		it("carries every plural category the en entry has, with the same doubled text", () => {
			const pluralKeys = Object.keys(en).filter(
				(key) => typeof en[key] !== "string" && !isEmptyEn(en[key])
			);
			expect(pluralKeys.length, "en plural entries").to.be.greaterThan(0);

			for (const key of pluralKeys) {
				const enCats = Object.keys(en[key] as Record<string, string>);
				const forms = qqx[key];

				expect(forms, `${key} is plural under qqx too`).to.be.an("object");
				// Same categories, none missing, none invented.
				expect(
					Object.keys(forms as Record<string, string>).sort(),
					`${key} categories`
				).to.deep.equal([...enCats].sort());
				// The rig's shape: one text in every category, RLE-wrapped,
				// so every plural form renders right-to-left.
				const texts = new Set(Object.values(forms as Record<string, string>));
				expect(texts.size, `${key} carries one text across its categories`).to.equal(1);
				const text = (forms as Record<string, string>)[enCats[0]];
				expect(text.startsWith("\u202B"), `${key} is RLE-wrapped`).to.equal(true);
			}
		});

		it("compiles a real key to exactly what pseudo() makes of its en value", () => {
			// The generator now lives in tools/i18n/pseudo.ts; this rider pins
			// the moved code to the committed output: one real singular key,
			// end to end from en.json through pseudo() to qqx.json.
			const key = "connect.submit";
			const enValue = en[key];
			expect(enValue, "a singular en copy to pin").to.be.a("string");
			expect(qqx[key]).to.equal(pseudo(enValue as string));
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

		it("omits qqx from available.ts and tags.json under NODE_ENV=production", () => {
			// The rig never ships: a production compile lists no qqx anywhere —
			// not in the selector's list, not in the pre-paint tag list — so a
			// stored qqx pick cannot survive a deploy. qqx.json itself is still
			// generated (the rig's artifact; the dev build copies it).
			const saved = process.env.NODE_ENV;
			process.env.NODE_ENV = "production";

			try {
				compileFixture("compile/plural");
			} finally {
				process.env.NODE_ENV = saved;
			}

			const text = readFileSync(join(tmp, "compile-plural", "available.ts"), "utf8");
			expect(text).to.contain("export const DEV = false;");
			expect(text).to.not.contain("qqx");
			expect(
				JSON.parse(readFileSync(join(tmp, "compile-plural", "tags.json"), "utf8"))
			).to.deep.equal(["en", "de"]);
		});
	});

	describe("scaffold", () => {
		it("writes one empty msgstr slot per nplurals, not always two", () => {
			// ru's rule has three forms. Two slots meant the fill could never
			// write the third, and the compile then dropped every plural key.
			const dir = join(tmp, "scaffold");
			mkdirSync(dir, {recursive: true});
			copyFileSync(join(FIXTURES, "compile/plural/messages.pot"), join(dir, "messages.pot"));
			expect(scaffoldTag("ru", dir)).to.equal(true);

			const {headers, entries} = parsePo(readFileSync(join(dir, "ru.po"), "utf8"));
			expect(headers["plural-forms"]).to.contain("nplurals=3;");

			const plural = entries.find((entry) => entry.msgctxt === "condensed.join");
			expect(plural?.msgstr).to.deep.equal(["", "", ""]);
			const singular = entries.find((entry) => entry.msgctxt === "connect.submit");
			expect(singular?.msgstr).to.deep.equal([""]);
		});
	});

	describe("the plural slot planner", () => {
		// What fill.ts translates into each gettext slot. The singular form
		// belongs to the slot the expression yields for n = 1 — slot 0 for
		// (n != 1), but slot 1 where the rule orders them the other way —
		// and every other slot
		// translates msgid_plural. The fill used to write one slot and leave
		// the rest empty, which the compile then dropped (or, worse, served
		// as the singular for every count).
		const entry = {msgid: "marked away once", msgidPlural: "marked away {count} times"};

		it("sends msgid to the n = 1 slot and msgid_plural to every other one", () => {
			expect(planPluralSlots(entry, 2, "n != 1")).to.deep.equal([
				{index: 0, source: "msgid"},
				{index: 1, source: "msgidPlural"},
			]);
			// A rule that does not put the singular first: slot 1 is the one
			// n = 1 reads, so that is where msgid goes. (No target ships this
			// shape — fa's rule was one and is now "n > 1" — but the planner
			// must not assume slot 0.)
			expect(planPluralSlots(entry, 2, "n > 0 ? 1 : 0")).to.deep.equal([
				{index: 0, source: "msgidPlural"},
				{index: 1, source: "msgid"},
			]);
			expect(
				planPluralSlots(
					entry,
					3,
					"(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)"
				)
			).to.deep.equal([
				{index: 0, source: "msgid"},
				{index: 1, source: "msgidPlural"},
				{index: 2, source: "msgidPlural"},
			]);
			// One slot (ja, zh, ko, th, vi): the only form has to serve every
			// count, so it translates the plural text — the one carrying
			// {count}. The n = 1 rule is for languages that HAVE a singular.
			expect(planPluralSlots(entry, 1, "0")).to.deep.equal([
				{index: 0, source: "msgidPlural"},
			]);
		});

		it("maps a target's categories onto distinct slots — all nplurals of them", () => {
			// Two categories sharing one slot is the bug that made fa's
			// "n > 0 ? 1 : 0" render the singular for every count: both
			// categories read slot 1, which the fill writes msgid into, and
			// the all-or-nothing gate cannot see it (the slot IS filled).
			// Scoped to the shipped targets: cy's four-form rule genuinely
			// collapses categories onto slots and is not a target.
			const targets = parseTargets(readFileSync(TARGETS_SOURCE, "utf8"));
			expect(targets.length, "target languages").to.be.greaterThan(0);

			for (const {tag} of targets) {
				const rule = PLURAL_RULES[tag];
				expect(rule, `${tag} has a plural rule`).to.not.equal(undefined);

				const slots = Object.values(categoryIndexMap(tag, rule.expr));
				expect(new Set(slots).size, `${tag} distinct slots`).to.equal(rule.nplurals);
			}
		});

		it("gives every rule in the table as many slots as its expression yields", () => {
			// The invariant compileEntry now depends on: too few slots and the
			// map asks for an index the fill never writes, so the key is
			// dropped however well it is translated; too many (ru said 4 for a
			// three-branch rule) and the fill translates a slot nothing reads.
			for (const [tag, rule] of Object.entries(PLURAL_RULES)) {
				let highest = 0;

				for (let n = 0; n <= 999; n++) {
					highest = Math.max(highest, pluralEval(rule.expr, n));
				}

				expect(rule.nplurals, `${tag} nplurals`).to.equal(highest + 1);
			}
		});

		it("plans nothing for a singular entry", () => {
			expect(planPluralSlots({msgid: "Connect"}, 2, "n != 1")).to.deep.equal([]);
		});
	});

	describe("sweep", () => {
		/** Parse a sweep fixture and empty what its placeholders no longer match. */
		function sweepFixture(tag: string) {
			const {entries} = parsePo(readFileSync(join(FIXTURES, "sweep", `${tag}.po`), "utf8"));
			const outcome = sweepEntries(entries, PLURAL_RULES[tag], tag);
			return {entries, ...outcome};
		}

		it("checks a one-form locale's only slot against the plural text it holds", () => {
			// ja, zh, ko, th and vi have one form and it translates
			// msgid_plural, so it carries {count} while the msgid does not.
			// Checked against msgid, every such slot is emptied — and the next
			// fill writes it again: a silent fill/sweep loop.
			const {entries} = sweepFixture("ja");
			const kept = entries.find((entry) => entry.msgctxt === "condensed.away");
			expect(kept?.msgstr[0], "the plural text survives").to.equal("{count}回離席しました");

			const lost = entries.find((entry) => entry.msgctxt === "condensed.back");
			expect(lost?.msgstr[0], "the slot that lost {count} is emptied").to.equal("");

			const singular = entries.find((entry) => entry.msgctxt === "connect.submit");
			expect(singular?.msgstr[0]).to.equal("接続");
		});

		it("checks every slot of a three-form locale, not just the first two", () => {
			// Slots >= 2 (ru, pl, uk, cs, sk, ro — and ar's six) were never
			// brace-checked at all, so a form that ate {count} reached the
			// compile, which then refuses the whole catalog.
			const {entries} = sweepFixture("ru");
			const entry = entries.find((item) => item.msgctxt === "condensed.away");
			expect(entry?.msgstr).to.deep.equal(["помечено однажды", "помечено {count} раза", ""]);
		});

		it("empties a machine answer that loops, runs away or leaves the script", () => {
			const {entries, reports} = sweepFixture("de");
			const text = (key: string, slot = 0) =>
				entries.find((entry) => entry.msgctxt === key)?.msgstr[slot];

			expect(text("channel.close"), "the loop").to.equal("");
			expect(text("connect.username"), "six times the English").to.equal("");
			expect(text("connect.password"), "Devanagari in a Latin locale").to.equal("");
			// An ordinary translation is left where it is.
			expect(text("connect.submit")).to.equal("Verbinden");
			// Per slot: each is judged against the English text IT holds, so
			// the German singular survives its Cyrillic plural.
			expect(text("condensed.away", 0)).to.equal("einmal abwesend gemeldet");
			expect(text("condensed.away", 1)).to.equal("");

			expect(reports).to.deep.equal([
				{key: "channel.close", reason: "degenerate"},
				{key: "connect.username", reason: "runaway-length"},
				{key: "connect.password", reason: "foreign-script"},
				{key: "condensed.away", reason: "foreign-script"},
			]);
		});

		describe("isSuspectCatalogEntry", () => {
			it("allows Latin everywhere and each target its own writing system", () => {
				expect(isSuspectCatalogEntry("ru", "Connect", "Подключиться")).to.equal(null);
				expect(isSuspectCatalogEntry("th", "Connect", "เชื่อมต่อ")).to.equal(null);
				expect(isSuspectCatalogEntry("ko", "Connect", "연결")).to.equal(null);
				expect(isSuspectCatalogEntry("zh", "Connect", "连接")).to.equal(null);
				// Brand names and untranslatable terms stay Latin.
				expect(isSuspectCatalogEntry("ja", "Connect to IRC", "IRC に接続")).to.equal(null);
				// The marks that carry no script of their own: a Japanese long
				// vowel and an Arabic tatweel are letters whose Script is
				// Common, so a bare \p{Script=…} table would empty both.
				expect(isSuspectCatalogEntry("ja", "Computer", "コンピューター")).to.equal(null);
				expect(isSuspectCatalogEntry("ar", "Connect", "اتصـــال")).to.equal(null);
				// A {placeholder}'s name belongs to the deploy, not to the
				// translator, so nothing inside the braces is judged.
				expect(
					isSuspectCatalogEntry("de", "Network {ネット}", "Netzwerk {ネット}")
				).to.equal(null);
			});

			it("names the reason, judging the loop first", () => {
				expect(isSuspectCatalogEntry("fi" as string, "Close", "ไม่")).to.equal(null);
				expect(isSuspectCatalogEntry("de", "Close", "Sluit ~~~~~~")).to.equal("degenerate");
				expect(isSuspectCatalogEntry("de", "Close", "x".repeat(41))).to.equal(
					"runaway-length"
				);
				expect(isSuspectCatalogEntry("de", "Close", "x".repeat(40))).to.equal(null);
				expect(isSuspectCatalogEntry("fr", "Password", "パスワード")).to.equal(
					"foreign-script"
				);
				// Cyrillic is not Ukrainian's mistake, and is not German's answer.
				expect(isSuspectCatalogEntry("uk", "Password", "Пароль")).to.equal(null);
				expect(isSuspectCatalogEntry("de", "Password", "Пароль")).to.equal(
					"foreign-script"
				);
			});
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
			// The drift mark is ADDED to the flags the entry carried; a
			// fuzzy entry that drifts again does not collect two marks.
			expect(entries[0].flags).to.deep.equal(["c-format", "fuzzy"]);
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

		it("flags every assembled call site, naming file, line and kind", () => {
			// The dynamic fixture carries every assembly shape: a variable
			// key, a template-literal key, a literal glued to code, a
			// translated fragment concatenated with a literal and with
			// another call. The two lookalikes (obj.t(, function t() {) must
			// not appear. DOLLAR keeps the expected source text out of a
			// ${…} string (the lint rule reads that as an interpolation).
			const DOLLAR = "$";
			const templateKeySite = `t(\`prefix.${DOLLAR}{key}\`);`;
			const problems = checkPot(join(FIXTURES, "dynamic/messages.pot"), [
				join(FIXTURES, "dynamic/client"),
			]);
			expect(problems.dynamic).to.deep.equal([
				{file: "js/dynamic.ts", line: 3, kind: "key", code: "t(key);"},
				{file: "js/dynamic.ts", line: 4, kind: "key", code: templateKeySite},
				{
					file: "js/dynamic.ts",
					line: 5,
					kind: "combined",
					code: 't("glued." + key);',
				},
				{
					file: "js/dynamic.ts",
					line: 6,
					kind: "combined",
					code: 'const joined = t("clean.key") + " more";',
				},
				{
					file: "js/dynamic.ts",
					line: 7,
					kind: "combined",
					code: 'const gluedCall = "see " + t("clean.key");',
				},
			]);
		});

		it("honours the assembled-site ledger and reports stale entries", () => {
			const options = {
				allowedDynamic: new Set(["js/dynamic.ts", "js/clean.ts"]),
			};
			const problems = checkPot(
				join(FIXTURES, "dynamic/messages.pot"),
				[join(FIXTURES, "dynamic/client")],
				options
			);
			// The whole file is ledgered: its sites are excused, clean.ts's
			// zero hits visible for the staleness check.
			expect(problems.dynamic).to.deep.equal([]);
			expect(problems.dynamicHits["js/dynamic.ts"]).to.equal(5);
			expect(problems.dynamicHits["js/clean.ts"]).to.equal(undefined);
		});
	});

	describe("translation targets", () => {
		// The generated selector list vs its source of truth, the curated
		// translation-languages.txt, and the direction facts the selector
		// derives from it.
		const committed = JSON.parse(
			readFileSync(resolve("client/js/i18n/targets.ts"), "utf8")
				.replace(/^[\s\S]*?export const TRANSLATION_TARGETS = /, "")
				.replace(/ as const;[\s\S]*$/, "")
		) as {tag: string; en: string}[];

		it("targets.ts is exactly translation-languages.txt, in order", () => {
			const parsed = parseTargets(readFileSync(TARGETS_SOURCE, "utf8"));
			expect(parsed.length, "target languages").to.be.greaterThan(0);
			expect(committed).to.deep.equal(parsed);
		});

		it("maps every name to a unique lowercase primary tag", () => {
			const tags = committed.map((target) => target.tag);
			expect(new Set(tags).size).to.equal(tags.length);

			for (const tag of tags) {
				expect(tag, `${tag} is a primary subtag`).to.match(/^[a-z]{2,3}$/);
			}
		});

		it("marks the right-to-left targets, and only those", () => {
			// core's RTL_TAGS decides direction at runtime; the target list
			// must agree with it for every tag it offers.
			const rtl = committed.filter((target) => isRTL(target.tag)).map((t) => t.tag);
			expect(new Set(rtl)).to.deep.equal(new Set(["ar"]));
		});

		it("writes each language's own name for the one RTL target", () => {
			// The selector's label is Intl.DisplayNames of the tag itself —
			// the native name, never the English one. Pinned for the RTL
			// target (where a wrong name would hide the language from its
			// own readers) and German as an LTR spot check; Node's CLDR and
			// browsers agree on these mainstream tags.
			const native = (tag: string) =>
				new Intl.DisplayNames([tag], {type: "language"}).of(tag);
			expect(native("ar")).to.equal("العربية");
			expect(native("de")).to.equal("Deutsch");
			expect(native("en")).to.equal("English");
		});
	});

	describe("the instrument loader", () => {
		const ctx = {resourcePath: "/repo/client/components/Foo.vue"};

		it("renames non-literal t()/tCount() calls to the dynamic globals", () => {
			const out = instrument.call(
				ctx,
				[
					"const a = t(foo);",
					"const b = tCount(bar, n);",
					'const c = t("static.key");',
					'const d = tCount("static.k", n);',
					"const e = obj.t(x);",
					"// t(commented)",
					'const s = "call t(str) later";',
				].join("\n")
			) as string;
			expect(out).to.contain("__tDyn(foo)");
			expect(out).to.contain("__tDynC(bar, n)");
			expect(out).to.contain('t("static.key")');
			expect(out).to.contain('tCount("static.k", n)');
			expect(out).to.contain("obj.t(x)");
			expect(out).to.not.contain("__tDyn(commented");
			expect(out).to.contain("call t(str) later");
		});

		it("stands down for the implementation's own files", () => {
			const src = "const a = t(foo);";
			expect(instrument.call({resourcePath: "/repo/client/js/i18n/core.ts"}, src)).to.equal(
				src
			);
			expect(instrument.call({resourcePath: "/repo/client/js/branding.ts"}, src)).to.equal(
				src
			);
		});
	});

	describe("the live tree", () => {
		it("messages.pot and the real client/ call sites agree", () => {
			// The gate Task 6 Step 1 mandates: from this task on, yarn test
			// fails when a t()/tCount() key is missing from the pot or a pot
			// key is referenced by no call site. Runs against the real tree,
			// not the fixtures.
			const problems = checkPot(POT_PATH, [resolve("client")]);
			expect(problems.missing).to.deep.equal([]);
			expect(problems.unreferenced).to.deep.equal([]);
			expect(problems.missingContext).to.deep.equal([]);
			// No assembled call sites outside the ledger: every t() key is a
			// literal and no translated fragment is glued into a sentence
			// (the runtime warnings' build-time half — the ledger in
			// ALLOWED_DYNAMIC is the only way out, and every entry must
			// still be earning its place).
			expect(problems.dynamic).to.deep.equal([]);

			for (const file of ALLOWED_DYNAMIC) {
				expect(
					problems.dynamicHits[file],
					`${file} is on the assembled-site ledger but has no site left — remove the entry`
				).to.be.greaterThan(0);
			}
		});

		it("keeps every allowlisted key pinned to the source that resolves it", () => {
			// ALLOWED_UNREFERENCED keys are referenced from places the
			// .ts/.vue scanner cannot see, and each group has one file that
			// resolves it: the splash keys live in the splash id/key table in
			// client/js/i18n/index.ts (a data table, not t() call sites, fed
			// by client/index.html's static copy), and the dates.* labels are
			// resolved inside client/js/i18n/dates.ts (formatRelativeDay
			// takes the caller's t(), so DateMarker.vue — their UI owner —
			// never names the keys). Pin each group's keys as quoted literals
			// in its resolver's source text, so a key that leaves it cannot
			// linger on the allowlist.
			const groups: ReadonlyArray<{file: string; keys: readonly string[]}> = [
				{
					file: "client/js/i18n/index.ts",
					keys: ["loading.reload", "loading.requiresJs", "loading.slow"],
				},
				{file: "client/js/i18n/dates.ts", keys: ["dates.today", "dates.yesterday"]},
				{
					file: "client/js/loading-error-handlers.js",
					keys: [
						"loading.starting",
						"loading.error",
						"loading.errorDetails",
						"loading.errorDevtools",
					],
				},
			];

			const allowlisted = [...ALLOWED_UNREFERENCED].sort();
			const pinned = groups.flatMap((group) => group.keys).sort();
			expect(allowlisted).to.deep.equal(pinned);

			for (const group of groups) {
				const source = readFileSync(resolve(group.file), "utf8");

				for (const key of group.keys) {
					expect(
						source,
						`${key} is allowlisted in check.ts but no longer appears in ${group.file}`
					).to.contain(`"${key}"`);
				}
			}
		});
	});
});
