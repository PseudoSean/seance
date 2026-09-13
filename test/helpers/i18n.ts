import {expect} from "chai";
import {after, describe, it} from "mocha";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import enCatalog from "../../client/locales/en.json";
import {
	RTL_TAGS,
	bestLocale,
	interpolate,
	isRTL,
	resolvableTags,
	setCatalog,
	t,
	tCount,
} from "../../client/js/i18n/core";
import {activate} from "../../client/js/i18n";
import {formatDayHeading, formatRelativeDay, formatTime} from "../../client/js/i18n/dates";

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

	it("the pre-paint script applies a stored tag this build ships (qqx included)", () => {
		// tags.json is the real baked list: qqx is a tag like any other, so
		// the dev-forced-qqx contract needs no special case.
		expect(runPrePaint({locale: "qqx"}, [])).to.deep.equal({lang: "qqx", dir: "rtl"});
	});

	it("the pre-paint script still resolves auto: exact tag, then base", () => {
		expect(runPrePaint({}, ["zz-Bork", "qqx-XP"])).to.deep.equal({lang: "qqx", dir: "rtl"});
		expect(runPrePaint({locale: "auto"}, ["en-GB"])).to.deep.equal({lang: "en", dir: "ltr"});
	});

	it("the pre-paint script leaves lang/dir untouched for an unavailable stored tag", () => {
		// A stale tag (a locale the deploy dropped, a blob restored from a
		// backup) must not pin a direction no catalog backs — and must not
		// fall through to auto-resolution either: boot's activate() lands on
		// en, and the pre-paint claim has to agree.
		expect(runPrePaint({locale: "de"}, [])).to.deep.equal({lang: "", dir: ""});
		expect(runPrePaint({locale: "de"}, ["de"])).to.deep.equal({lang: "", dir: ""});
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
