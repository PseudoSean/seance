import {expect} from "chai";
import {after, afterEach, beforeEach, describe, it} from "mocha";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import sinon from "sinon";
import enCatalog from "../../client/locales/en.json";
import {
	missingKeys,
	RTL_TAGS,
	bestLocale,
	interpolate,
	isRTL,
	resolvableTags,
	setCatalog,
	setWarnMissing,
	t,
	tCount,
	untranslatedKeys,
} from "../../client/js/i18n/core";
import {activate} from "../../client/js/i18n";
import {formatDayHeading, formatRelativeDay, formatTime} from "../../client/js/i18n/dates";

before(() => {
	// The dynamic-key/coverage diagnostics are forced on per-test below; a
	// quiet default keeps fixture-key calls in other tests from printing.
	setWarnMissing(false);
});

describe("i18n core", () => {
	const en = {
		"connect.title": "Connect to IRC",
		"condensed.join": {one: "{count} user has joined", other: "{count} users have joined"},
		greeting: "Hello {nick}",
	};

	it("resolves plain keys and interpolates {vars}", () => {
		setCatalog("en", en, undefined);
		expect(t("connect.title")).to.equal("Connect to IRC");
		expect(t("greeting", {nick: "alice"})).to.equal("Hello alice");
		expect(t("greeting")).to.equal("Hello {nick}"); // unknown var stays visible
	});

	it("overlays the locale over en and falls back per key", () => {
		setCatalog("de", en, {"connect.title": "Verbinde mit IRC"});
		expect(t("connect.title")).to.equal("Verbinde mit IRC");
		expect(t("greeting", {nick: "x"})).to.equal("Hello x"); // missing key → en
	});

	it("selects plural categories with the ACTIVE locale's rules", () => {
		setCatalog("en", en, undefined);
		expect(tCount("condensed.join", 1)).to.equal("1 user has joined");
		expect(tCount("condensed.join", 3)).to.equal("3 users have joined");
		setCatalog("de", en, {
			"condensed.join": {one: "{count} Benutzer", other: "{count} Benutzer"},
		});
		expect(tCount("condensed.join", 3)).to.equal("3 Benutzer");
	});

	it("knows right-to-left tags", () => {
		expect(isRTL("ar")).to.equal(true);
		expect(isRTL("de")).to.equal(false);
		expect(isRTL("qqx")).to.equal(true);
	});

	it("matches navigator.languages best-effort: exact tag, then base", () => {
		expect(bestLocale(["de-AT"], ["en", "de"])).to.equal("de");
		expect(bestLocale(["en-GB"], ["en", "de"])).to.equal("en");
		expect(bestLocale(["fr-CA"], ["en", "de"])).to.equal("en");
		expect(bestLocale(["xx-YY", "de-DE"], ["en", "de"])).to.equal("de"); // a later preference wins when an earlier has no match
	});

	it("auto-resolution may pick a dev-only locale in development, never in production", () => {
		// The generated available.ts carries DEV as a baked const, so the
		// filter is a pure helper over (entries, DEV) — both outcomes pinned.
		const available: ReadonlyArray<{tag: string; devOnly?: boolean}> = [
			{tag: "en"},
			{tag: "qqx", devOnly: true},
		];
		expect(resolvableTags(available, false)).to.deep.equal(["en"]);
		expect(resolvableTags(available, true)).to.deep.equal(["en", "qqx"]);
	});

	it("the pre-paint script and the core agree on RTL tags", () => {
		const html = readFileSync("client/index.html", "utf8");
		const inline = /\/\^\(([^)]*)\)\\b\//.exec(html)?.[1] ?? "";
		const fromHtml = new Set(inline.split("|"));
		expect([...fromHtml].sort()).to.deep.equal([...RTL_TAGS].sort());
	});

	/** Execute the pre-paint script as the build would ship it: the first
	 * inline `<script>` of client/index.html, with `__AVAILABLE_LOCALES__`
	 * substituted from client/locales/tags.json (webpack bakes a
	 * comma-joined tag list at the same spot). The sandbox stubs the three
	 * globals the script touches; lang/dir start empty, so "still empty"
	 * means the script left them untouched. */
	function runPrePaint(stored: object, languages: string[]): {lang: string; dir: string} {
		const html = readFileSync("client/index.html", "utf8");
		const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
		const tags = JSON.parse(readFileSync("client/locales/tags.json", "utf8")) as string[];
		const root = {lang: "", dir: ""};

		expect(source, "the pre-paint script is index.html's first inline script").to.exist;
		vm.runInNewContext(source!.replace("__AVAILABLE_LOCALES__", tags.join(",")), {
			localStorage: {getItem: () => JSON.stringify(stored)},
			navigator: {languages},
			document: {documentElement: root},
		});

		return root;
	}

	it("the pre-paint script applies a stored tag this build ships", () => {
		// tags.json is the real baked list, whatever flavor this checkout
		// carries (a development compile adds qqx to it, a production one
		// does not — test/tests/i18n-toolchain.ts pins both): a stored tag in
		// the list activates, with the direction its writing system takes.
		const [tag] = JSON.parse(readFileSync("client/locales/tags.json", "utf8")) as string[];
		expect(runPrePaint({locale: tag}, [])).to.deep.equal({
			lang: tag,
			dir: isRTL(tag) ? "rtl" : "ltr",
		});
	});

	it("the pre-paint script still resolves auto: exact tag, then base", () => {
		const [tag] = JSON.parse(readFileSync("client/locales/tags.json", "utf8")) as string[];
		expect(runPrePaint({}, ["zz-Bork", `${tag}-XP`])).to.deep.equal({
			lang: tag,
			dir: isRTL(tag) ? "rtl" : "ltr",
		});
		expect(runPrePaint({locale: "auto"}, ["en-GB"])).to.deep.equal({lang: "en", dir: "ltr"});
	});

	it("the pre-paint script leaves lang/dir untouched for an unavailable stored tag", () => {
		// A stale tag (a locale the deploy dropped, a blob restored from a
		// backup) must not pin a direction no catalog backs — and must not
		// fall through to auto-resolution either: boot's activate() lands on
		// en, and the pre-paint claim has to agree. A tag this build's baked
		// list does not carry, whatever flavor it is.
		const tags = new Set(
			JSON.parse(readFileSync("client/locales/tags.json", "utf8")) as string[]
		);
		const stale = ["zz", "de", "qqx"].find((candidate) => !tags.has(candidate));
		expect(stale, "a tag outside the baked list").to.exist;
		expect(runPrePaint({locale: stale!}, [])).to.deep.equal({lang: "", dir: ""});
		expect(runPrePaint({locale: stale!}, [stale!])).to.deep.equal({lang: "", dir: ""});
	});

	it("activate() falls back to en for a tag with no catalog, never rejecting", async function () {
		// mocha has no DOM: the stub documentElement is everything activate()
		// writes to (settingsBackup can restore an arbitrary stored locale,
		// and boot calls activate() with `void` — a rejection would cascade).
		const root = {lang: "before", dir: "before"};
		(globalThis as {document?: unknown}).document = {
			documentElement: root,
			getElementById: () => null,
		};

		try {
			await activate("nonexistent"); // must not reject
			expect(t("connect.title")).to.equal("Connect to IRC"); // the catalog is en again
			expect(root).to.deep.equal({lang: "en", dir: "ltr"}); // best-effort html update still ran
		} finally {
			delete (globalThis as {document?: unknown}).document;
			setCatalog("en", enCatalog, undefined);
		}
	});
});

describe("i18n date formatters", () => {
	after(() => {
		// The catalog is module state: hand the real English copy back, so the
		// suites loaded after this file resolve the live keys again.
		setCatalog("en", enCatalog, undefined);
	});

	it("writes the day heading in the active language", () => {
		// 4 February 2026 at local midnight: the heading is built from the
		// wall-clock date, so the assertion holds in every timezone.
		setCatalog("de", enCatalog, undefined);
		expect(formatDayHeading(new Date(2026, 1, 4).getTime())).to.contain("Februar");
	});

	it("resolves Today through the t() the caller passes", () => {
		setCatalog("en", enCatalog, undefined);
		const stubT = (key: string) => (key === "dates.today" ? "Today" : key);
		expect(formatRelativeDay(Date.now(), stubT)).to.equal("Today");
	});

	it("writes a timestamp on the 24-hour clock when hour12: false", () => {
		// 22 May 2014, 15:04 local: hour12: false must win over en's own
		// 12-hour preference (Task 8 Step 1 pins "15:04").
		setCatalog("en", enCatalog, undefined);
		expect(formatTime(new Date(2014, 4, 22, 15, 4).getTime(), false, false)).to.equal("15:04");
	});
});

describe("i18n number interpolation", () => {
	const en = {"port.msg": "Port {port}", "new.msg": "{count} new"};

	after(() => {
		// The catalog is module state: hand the real English copy back.
		setCatalog("en", enCatalog, undefined);
	});

	it("writes number vars with the active locale's digits and decimal separator", () => {
		setCatalog("en", en, undefined);
		expect(t("port.msg", {port: 6667})).to.equal("Port 6667");
		setCatalog("de", en, undefined);
		expect(t("port.msg", {port: 1.5})).to.equal("Port 1,5"); // de decimal comma
		setCatalog("ar-EG", en, undefined);
		expect(t("port.msg", {port: 6667})).to.equal("Port ٦٦٦٧"); // Arabic-Indic digits
	});

	it("interpolates {vars} without grouping — a port is 6667 everywhere", () => {
		// en's own grouping writes 1,500; the frames say {port}/{count}, and
		// neither reads well grouped. Grouping lives in numbers.ts's
		// formatNumber() for call sites that render a standalone number.
		setCatalog("en", en, undefined);
		expect(t("new.msg", {count: 1500})).to.equal("1500 new");
		setCatalog("de", en, undefined);
		expect(t("new.msg", {count: 1500})).to.equal("1500 new");
	});

	it("localizes {count}/{n} through the plural path too", () => {
		setCatalog("de", enCatalog, undefined);
		expect(tCount("condensed.join", 1500)).to.equal("1500 users have joined"); // en plural, de digits
	});
});

describe("i18n dev warnings for dynamic strings", () => {
	let warns: sinon.SinonStub;

	beforeEach(() => {
		warns = sinon.stub(console, "warn");
		setWarnMissing(true); // mocha runs under NODE_ENV=test; force the dev stance
	});

	afterEach(() => {
		warns.restore();
		setWarnMissing(false);
	});

	after(() => {
		setCatalog("en", enCatalog, undefined);
	});

	it("warns once per missing key — the dynamically composed case", () => {
		setCatalog("en", {known: "Port {port}"}, undefined);
		expect(t(`dyn.${"x"}`)).to.equal("dyn.x"); // renders the key, as ever
		expect(t("dyn.x")).to.equal("dyn.x"); // ...but warns only once per kind
		const missing = warns
			.getCalls()
			.filter((call) => String(call.args[0]).includes("missing key"));
		expect(missing.length).to.equal(1);
		// An assembled key ALSO warns for being assembled — even before the
		// lookup fails.
		expect(
			warns.getCalls().filter((call) => String(call.args[0]).includes("assembled at runtime"))
				.length
		).to.be.greaterThan(0);
	});

	it("warns on an unknown {var} left visible", () => {
		setCatalog("en", {known: "Port {port}"}, undefined);
		expect(t("known", {})).to.equal("Port {port}"); // placeholder stays visible
		expect(
			warns.getCalls().filter((call) => String(call.args[0]).includes("unknown var")).length
		).to.equal(1);
	});

	it("tCount warns on a missing key, accepts a flat string entry", () => {
		setCatalog("en", {flat: "{count} things"}, undefined);
		expect(tCount("flat", 3)).to.equal("3 things"); // no plural entry, no warn
		tCount("dyn.count", 3);
		expect(
			warns.getCalls().filter((call) => String(call.args[0]).includes("missing key")).length
		).to.equal(1);
	});

	it("a locale change re-arms the dedupe", () => {
		setCatalog("en", {known: "x"}, undefined);
		t("dyn.armed");
		setCatalog("de", {known: "x"}, undefined);
		t("dyn.armed");
		expect(
			warns.getCalls().filter((call) => String(call.args[0]).includes("missing key")).length
		).to.equal(2);
	});

	it("warns for an assembled key THAT RESOLVES — the pure dynamic-label case", () => {
		// The exact pattern the warnings exist for: a key composed at
		// runtime that happens to hit a real catalog entry. The lookup
		// succeeds; the warning fires anyway, because a composed key cannot
		// be trusted to the translation dataset.
		// A key only the runtime knows: in the catalog, no static call site
		// anywhere resolves it.
		setCatalog("en", {["assembled." + "key"]: "Resolved copy"}, undefined);
		expect(t("assembled.key")).to.equal("Resolved copy"); // resolves fine
		const dynsite = warns
			.getCalls()
			.filter((call) => String(call.args[0]).includes("dynamic label"));
		expect(dynsite.length).to.equal(1);
		expect(String(dynsite[0].args[0])).to.contain('"assembled.key"');
		// And a plain static key never warns this way.
		t("connect.submit");
		expect(
			warns
				.getCalls()
				.filter(
					(call) =>
						String(call.args[0]).includes("dynamic label") &&
						String(call.args[0]).includes("connect.submit")
				).length
		).to.equal(0);
	});

	it("setWarnMissing(false) silences them — production's compiled-out stance", () => {
		setCatalog("en", {known: "x"}, undefined);
		setWarnMissing(false);
		t("dyn.silenced");
		expect(warns.callCount).to.equal(0);
		expect(missingKeys().length).to.equal(0);
	});
});

describe("i18n translation-coverage warnings", () => {
	let warns: sinon.SinonStub;

	beforeEach(() => {
		warns = sinon.stub(console, "warn");
		setWarnMissing(true);
	});

	afterEach(() => {
		warns.restore();
		setWarnMissing(false);
	});

	after(() => {
		// The catalog is module state: hand the real English copy back.
		setCatalog("en", enCatalog, undefined);
	});

	it("the en base catalog has no untranslated keys", () => {
		setCatalog("en", enCatalog, undefined);
		expect(untranslatedKeys()).to.deep.equal([]);
	});

	it("a partial overlay warns per rendered label — the English copy shows", () => {
		// The de.po seed shape: a handful of keys translated, the rest
		// falling through to en.
		setCatalog("de", enCatalog, {"connect.submit": "Verbinden"});
		expect(untranslatedKeys()).to.contain("sidebar.settings");
		expect(untranslatedKeys()).to.not.contain("connect.submit");

		t("sidebar.settings"); // untranslated → warns
		t("sidebar.settings"); // ...once
		t("connect.submit"); // translated → no coverage warn
		const coverage = warns
			.getCalls()
			.filter((call) => String(call.args[0]).includes('untranslated in "de"'));
		expect(coverage.length).to.equal(1);
		expect(String(coverage[0].args[0])).to.contain('"sidebar.settings"');

		// The rendered value is still the English copy.
		expect(t("sidebar.settings")).to.equal("Settings");
	});

	it("intentionally-empty en copy is not 'untranslated'", () => {
		setCatalog("de", {"a.key": "text", "empty.key": ""}, {"a.key": "Text"});
		expect(untranslatedKeys()).to.deep.equal([]);
	});

	it("tCount warns for untranslated plural entries too", () => {
		setCatalog("de", enCatalog, undefined); // nothing translated
		tCount("condensed.join", 3);
		const coverage = warns
			.getCalls()
			.filter((call) => String(call.args[0]).includes('untranslated in "de"'));
		expect(coverage.length).to.equal(1);
		// And the en plural still serves.
		expect(tCount("condensed.join", 3)).to.equal("3 users have joined");
	});

	it("a locale change re-derives the untranslated set", () => {
		setCatalog("de", enCatalog, {"connect.submit": "Verbinden"});
		expect(untranslatedKeys().length).to.be.greaterThan(0);
		setCatalog("en", enCatalog, undefined);
		expect(untranslatedKeys()).to.deep.equal([]);
	});
});
