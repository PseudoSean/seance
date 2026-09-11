import {expect} from "chai";
import {buildCatalog} from "../../client/js/translate/models";
import {
	candidatesFor,
	mergeRoutes,
	resolveRoute,
	type RouteInput,
	type RouteTable,
} from "../../client/js/translate/router";
import {DEFAULT_ROUTES} from "../../client/js/translate/routes.default";

const catalog = buildCatalog();
const table: RouteTable = {
	"*": {"*": ["llm", "nllb"]},
	en: {"*": ["llm", "nllb"], de: ["llm", "opus:de-en", "nllb"], sw: ["nllb", "llm"]},
};

function input(overrides: Partial<RouteInput> = {}): RouteInput {
	return {
		from: "de",
		to: "en",
		tier: "gpu",
		allowLlm: true,
		allowCpu: true,
		down: new Set(),
		...overrides,
	};
}

describe("translate/router", () => {
	it("looks up the exact pair, then the target's wildcard, then the global one", () => {
		expect(candidatesFor(table, "de", "en")).to.deep.equal(["llm", "opus:de-en", "nllb"]);
		expect(candidatesFor(table, "fr", "en")).to.deep.equal(["llm", "nllb"]);
		expect(candidatesFor(table, "en", "de")).to.deep.equal(["llm", "nllb"]);
		expect(candidatesFor({}, "en", "de")).to.deep.equal([]);
	});

	it("takes the first candidate the device, the settings and the session allow", () => {
		expect(resolveRoute(table, catalog, input())?.candidate).to.equal("llm");
		expect(resolveRoute(table, catalog, input({tier: "cpu"}))?.candidate).to.equal(
			"opus:de-en"
		);
		expect(resolveRoute(table, catalog, input({allowLlm: false}))?.candidate).to.equal(
			"opus:de-en"
		);
		expect(
			resolveRoute(table, catalog, input({tier: "cpu", down: new Set(["opus:de-en"])}))
				?.candidate
		).to.equal("nllb");
		expect(resolveRoute(table, catalog, input({tier: "cpu", allowCpu: false}))).to.equal(null);
		expect(resolveRoute(table, catalog, input({tier: "none"}))).to.equal(null);
	});

	it("skips the seq2seq candidates when the source language is unknown", () => {
		expect(resolveRoute(table, catalog, input({from: null, tier: "cpu"}))).to.equal(null);
		expect(resolveRoute(table, catalog, input({from: null}))?.candidate).to.equal("llm");
	});

	it("skips a candidate the catalog has no model for", () => {
		const t: RouteTable = {en: {de: ["opus:xx-yy", "nllb"]}};

		expect(resolveRoute(t, catalog, input({tier: "cpu"}))?.candidate).to.equal("nllb");
	});

	it("returns the model with the candidate", () => {
		expect(resolveRoute(table, catalog, input({tier: "cpu"}))?.ref).to.equal(
			catalog.opus["de-en"]
		);
	});

	it("merges an override per entry, keeping the rest of the base", () => {
		const merged = mergeRoutes(table, {en: {de: ["nllb"]}, pt: {"*": ["nllb", "llm"]}});

		expect(merged.en.de).to.deep.equal(["nllb"]);
		expect(merged.en.sw).to.deep.equal(["nllb", "llm"]);
		expect(merged.pt["*"]).to.deep.equal(["nllb", "llm"]);
		expect(merged["*"]["*"]).to.deep.equal(["llm", "nllb"]);
		expect(table.en.de).to.deep.equal(["llm", "opus:de-en", "nllb"]);
	});

	it("the default table prefers the LLM for major languages and NLLB for the tail", () => {
		expect(candidatesFor(DEFAULT_ROUTES, "de", "en")).to.deep.equal([
			"llm",
			"opus:de-en",
			"nllb",
		]);
		expect(candidatesFor(DEFAULT_ROUTES, "sw", "en")[0]).to.equal("nllb");
		expect(candidatesFor(DEFAULT_ROUTES, "en", "sw")[0]).to.equal("nllb");
		expect(candidatesFor(DEFAULT_ROUTES, "ja", "fr")).to.deep.equal(["llm", "nllb"]);
	});
});
