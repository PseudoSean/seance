import {expect} from "chai";
import {describe, it} from "mocha";
import {readFileSync} from "node:fs";
import {
	RTL_TAGS,
	bestLocale,
	interpolate,
	isRTL,
	setCatalog,
	t,
	tCount,
} from "../../client/js/i18n/core";

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

	it("the pre-paint script and the core agree on RTL tags", () => {
		const html = readFileSync("client/index.html", "utf8");
		const inline = /\/\^\(([^)]*)\)\\b\//.exec(html)?.[1] ?? "";
		const fromHtml = new Set(inline.split("|"));
		expect([...fromHtml].sort()).to.deep.equal([...RTL_TAGS].sort());
	});
});
