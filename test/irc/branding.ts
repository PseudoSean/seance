import {expect} from "chai";
import sinon from "ts-sinon";
import {
	BRANDING_STRINGS,
	DEFAULT_BRANDING,
	brandingFeatures,
	brandingString,
	expandNick,
	getBranding,
	loadBranding,
	normalizeBranding,
	resetBranding,
} from "../../client/js/branding";

/** Minimal stand-in for a `fetch` returning the given body. */
function fakeFetch(body: string | object, status = 200): typeof fetch {
	const text = typeof body === "string" ? body : JSON.stringify(body);

	const response = {
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(JSON.parse(text) as unknown),
	} as Response;

	return (() => Promise.resolve(response)) as unknown as typeof fetch;
}

describe("branding", function () {
	afterEach(function () {
		sinon.restore();
		resetBranding();
	});

	describe("normalizeBranding", function () {
		it("returns the defaults for an empty or non-object input", function () {
			expect(normalizeBranding({})).to.deep.equal(normalizeBranding(DEFAULT_BRANDING));
			expect(normalizeBranding(null).appName).to.equal("Seance");
			expect(normalizeBranding("nope").appName).to.equal("Seance");
			expect(normalizeBranding([]).defaultNetwork).to.equal(undefined);
		});

		it("merges a partial config over the defaults", function () {
			const config = normalizeBranding({
				appName: "TestNet IRC",
				links: {privacy: "https://x.example/p"},
			});

			expect(config.appName).to.equal("TestNet IRC");
			expect(config.links).to.deep.equal({
				website: "https://github.com/evilnet/seance",
				help: "https://github.com/evilnet/seance/tree/develop/docs",
				privacy: "https://x.example/p",
			});
			expect(config.features).to.deep.equal({
				multiNetwork: true,
				saveNetworks: true,
				allowCustomServer: true,
			});
		});

		it("drops malformed fields instead of failing", function () {
			const config = normalizeBranding({
				appName: "   ",
				themeColor: "red",
				theme: 42,
				links: {help: "javascript:alert(1)", website: 7},
				features: {multiNetwork: "no", saveNetworks: false},
				strings: {"connect.title": 1, "not.a.key": "x", "connect.submit": "Go"},
			});

			expect(config.appName).to.equal("Seance");
			expect(config.themeColor).to.equal(undefined);
			expect(config.theme).to.equal(undefined);
			expect(config.links?.help).to.equal(
				"https://github.com/evilnet/seance/tree/develop/docs"
			);
			expect(config.links?.website).to.equal("https://github.com/evilnet/seance");
			expect(config.features).to.deep.equal({
				multiNetwork: true,
				saveNetworks: false,
				allowCustomServer: true,
			});
			expect(config.strings).to.deep.equal({"connect.submit": "Go"});
		});

		it("validates the default network and normalises its channels", function () {
			const config = normalizeBranding({
				defaultNetwork: {
					name: "TestNet",
					host: "irc.testnet.example",
					port: "8443",
					tls: true,
					channels: ["lobby", " #help ", "", 3],
					nick: "guest????",
					lockHost: true,
				},
			});

			expect(config.defaultNetwork).to.deep.equal({
				name: "TestNet",
				host: "irc.testnet.example",
				port: 8443,
				tls: true,
				channels: ["#lobby", "#help"],
				nick: "guest????",
				lockHost: true,
			});

			expect(normalizeBranding({defaultNetwork: {port: 1}}).defaultNetwork).to.equal(
				undefined
			);
			expect(
				normalizeBranding({defaultNetwork: {host: "h", port: 70000, channels: "a, b"}})
					.defaultNetwork
			).to.deep.equal({host: "h", channels: ["#a", "#b"]});
		});

		it("keeps shortName, description, theme and a valid themeColor", function () {
			const config = normalizeBranding({
				shortName: "TN",
				description: "TestNet's chat",
				theme: "morning",
				themeColor: "#123ABC",
			});

			expect(config).to.include({
				shortName: "TN",
				description: "TestNet's chat",
				theme: "morning",
				themeColor: "#123ABC",
			});
		});
	});

	describe("expandNick", function () {
		it("replaces every ? and % with a random digit", function () {
			const digits = [0.05, 0.15, 0.25, 0.35];
			let i = 0;
			const random = () => digits[i++ % digits.length];

			expect(expandNick("guest????", random)).to.equal("guest0123");
			expect(expandNick("lounge%", random)).to.equal("lounge0");
			expect(expandNick("plain", random)).to.equal("plain");
			expect(expandNick("g?")).to.match(/^g\d$/);
		});
	});

	describe("brandingString / brandingFeatures", function () {
		it("falls back to the default copy and treats missing flags as true", function () {
			const config = normalizeBranding({
				strings: {"connect.title": "Join TestNet"},
				features: {allowCustomServer: false},
			});

			expect(brandingString("connect.title", config)).to.equal("Join TestNet");
			expect(brandingString("connect.submit", config)).to.equal(
				BRANDING_STRINGS["connect.submit"]
			);
			expect(brandingString("unknown.key", config)).to.equal("unknown.key");
			expect(brandingFeatures(config)).to.deep.equal({
				multiNetwork: true,
				saveNetworks: true,
				allowCustomServer: false,
			});
			expect(brandingFeatures({appName: "x"}).allowCustomServer).to.equal(true);
		});
	});

	describe("loadBranding", function () {
		it("fetches config.json with cache: no-cache and applies it", async function () {
			const fetchStub = sinon.stub().callsFake(fakeFetch({appName: "TestNet IRC"}));

			const config = await loadBranding({fetch: fetchStub, url: "config.json"});

			expect(fetchStub.calledOnce).to.be.true;
			expect(fetchStub.firstCall.args[0]).to.equal("config.json");
			expect(fetchStub.firstCall.args[1]).to.include({cache: "no-cache"});
			expect(config.appName).to.equal("TestNet IRC");
			expect(getBranding()).to.equal(config);
		});

		it("falls back to the defaults on HTTP errors and warns once", async function () {
			const warn = sinon.stub(console, "warn");
			const notFound = fakeFetch("Not found", 404);

			const first = await loadBranding({fetch: notFound, url: "config.json"});
			const second = await loadBranding({fetch: notFound, url: "config.json"});

			expect(first.appName).to.equal("Seance");
			expect(first.defaultNetwork).to.equal(undefined);
			expect(second).to.deep.equal(first);
			expect(warn.calledOnce).to.be.true;
			expect(String(warn.firstCall.args[0])).to.include("404");
		});

		it("falls back to the defaults on invalid JSON or a rejected fetch", async function () {
			sinon.stub(console, "warn");

			const invalid = await loadBranding({fetch: fakeFetch("{not json"), url: "x"});
			expect(invalid.appName).to.equal("Seance");

			const list = await loadBranding({fetch: fakeFetch([1, 2]), url: "x"});
			expect(list.appName).to.equal("Seance");

			const rejecting = (() =>
				Promise.reject(new Error("offline"))) as unknown as typeof fetch;
			const offline = await loadBranding({fetch: rejecting, url: "x"});
			expect(offline).to.deep.equal(normalizeBranding({}));
		});

		it("uses the defaults until loaded", function () {
			expect(getBranding()).to.equal(DEFAULT_BRANDING);
		});
	});

	describe("uploads", function () {
		it("keeps a valid uploader config, filling nothing in", function () {
			const config = normalizeBranding({
				uploads: {
					endpoint: "https://files.example.test/upload",
					maxSizeBytes: "2048",
					fieldName: "attachment",
					responseUrlKey: "link",
					withCredentials: true,
					headers: {"X-Api-Key": "k", " ": "dropped", bad: 1},
				},
			});

			expect(config.uploads).to.deep.equal({
				endpoint: "https://files.example.test/upload",
				maxSizeBytes: 2048,
				fieldName: "attachment",
				responseUrlKey: "link",
				withCredentials: true,
				headers: {"X-Api-Key": "k"},
			});

			expect(
				normalizeBranding({uploads: {endpoint: "https://x.test/up", maxSizeBytes: -1}})
					.uploads
			).to.deep.equal({endpoint: "https://x.test/up"});
		});

		it("drops uploads unless the endpoint is an https URL", function () {
			expect(normalizeBranding({})).to.not.have.property("uploads");
			expect(normalizeBranding({uploads: {}})).to.not.have.property("uploads");
			expect(normalizeBranding({uploads: "https://x.test/up"})).to.not.have.property(
				"uploads"
			);
			expect(
				normalizeBranding({uploads: {endpoint: "http://x.test/up"}})
			).to.not.have.property("uploads");
			expect(
				normalizeBranding({uploads: {endpoint: "ftp://x.test/up"}})
			).to.not.have.property("uploads");
			expect(normalizeBranding({uploads: {endpoint: "https://"}})).to.not.have.property(
				"uploads"
			);
		});
	});
});
