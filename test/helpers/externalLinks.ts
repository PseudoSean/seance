import {expect} from "chai";
import {
	androidIntentUrl,
	iosVersion,
	isWebLink,
	linkPlatform,
	safariUrl,
	wayOut,
	windowFeatures,
} from "../../client/js/helpers/externalLinks";

const ANDROID =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE_17 =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_16 =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const IPADOS =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const WINDOWS =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const LINUX =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

describe("external links from an installed app (helpers/externalLinks.ts)", function () {
	it("tells Android, iOS (iPadOS included) and desktops apart", function () {
		expect(linkPlatform(ANDROID)).to.equal("android");
		expect(linkPlatform(IPHONE_17)).to.equal("ios");
		expect(linkPlatform(IPADOS, 5)).to.equal("ios");
		expect(linkPlatform(IPADOS, 0)).to.equal("desktop"); // a Mac
		expect(linkPlatform(WINDOWS)).to.equal("desktop");
		expect(linkPlatform(LINUX)).to.equal("desktop");
	});

	it("reads the iOS version", function () {
		expect(iosVersion(IPHONE_17)).to.equal(17);
		expect(iosVersion(IPHONE_16)).to.equal(16);
		expect(iosVersion(IPADOS)).to.equal(18);
		expect(iosVersion(WINDOWS)).to.equal(0);
	});

	it("takes only web links", function () {
		expect(isWebLink("https://example.org/")).to.equal(true);
		expect(isWebLink("HTTP://example.org/")).to.equal(true);
		expect(isWebLink("web+irc://irc.example.org/#chan")).to.equal(false);
		expect(isWebLink("mailto:a@b.c")).to.equal(false);
		expect(isWebLink("#/settings")).to.equal(false);
	});

	it("builds an Android intent that views the link, fragment and query kept", function () {
		expect(androidIntentUrl("https://example.org/a/b?x=1&y=2#L10")).to.equal(
			"intent://example.org/a/b?x=1&y=2#L10#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end"
		);
		expect(androidIntentUrl("http://example.org:8080/")).to.match(
			/^intent:\/\/example\.org:8080\/#Intent;scheme=http;/
		);
	});

	it("builds Safari's scheme for iOS", function () {
		expect(safariUrl("https://example.org/x")).to.equal("x-safari-https://example.org/x");
	});

	it("asks for a window of its own on a desktop, not a tab", function () {
		expect(windowFeatures(1920, 1080)).to.equal(
			"popup,noopener,noreferrer,width=1536,height=918"
		);
		expect(windowFeatures(300, 300)).to.equal("popup,noopener,noreferrer,width=480,height=480");
	});

	it("picks the way out by platform", function () {
		const href = "https://example.org/page";
		expect(wayOut(href, "android")).to.deep.equal({navigate: androidIntentUrl(href)});
		expect(wayOut(href, "ios", {iosVersion: 17})).to.deep.equal({navigate: safariUrl(href)});
		expect(wayOut(href, "ios", {iosVersion: 16})).to.equal(null);
		expect(wayOut(href, "desktop", {availWidth: 1000, availHeight: 1000})).to.deep.equal({
			open: href,
			features: windowFeatures(1000, 1000),
		});
		expect(wayOut("web+irc://irc.example.org", "android")).to.equal(null);
	});
});
