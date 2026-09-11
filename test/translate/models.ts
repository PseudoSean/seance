import {expect} from "chai";
import {
	DEFAULT_LLM_ID,
	DEFAULT_NLLB_ID,
	buildCatalog,
	cacheStates,
	candidateOf,
	catalogModels,
	refFor,
	type CacheApi,
} from "../../client/js/translate/models";

describe("translate/models", () => {
	it("builds the default catalog", () => {
		const catalog = buildCatalog();

		expect(catalog.llm).to.include({engine: "llm", family: "llm", id: DEFAULT_LLM_ID});
		expect(catalog.llm.sizeBytes).to.be.greaterThan(0);
		expect(catalog.nllb).to.include({engine: "seq2seq", family: "nllb", id: DEFAULT_NLLB_ID});
		expect(catalog.opus["de-en"]).to.deep.include({
			engine: "seq2seq",
			family: "opus",
			id: "Xenova/opus-mt-de-en",
			pair: ["de", "en"],
		});
		expect(catalog.opus["de-en"].label).to.equal("OPUS-MT German → English (CPU)");
		expect(catalog.modelBase).to.equal(undefined);
	});

	it("applies config.json overrides", () => {
		const catalog = buildCatalog({
			modelBase: "https://models.example.test/",
			llm: {
				model: "gemma-3-1b-it-q4f16_1-MLC",
				lib: "https://models.example.test/gemma.wasm",
			},
			cpu: {nllb: "mirror/nllb-small", opus: {"fi-en": "mirror/opus-fi-en"}},
		});

		expect(catalog.modelBase).to.equal("https://models.example.test");
		expect(catalog.llm.id).to.equal("gemma-3-1b-it-q4f16_1-MLC");
		expect(catalog.llmLib).to.equal("https://models.example.test/gemma.wasm");
		expect(catalog.nllb.id).to.equal("mirror/nllb-small");
		expect(catalog.opus["fi-en"].id).to.equal("mirror/opus-fi-en");
		expect(catalog.opus["fi-en"].pair).to.deep.equal(["fi", "en"]);
		expect(catalog.opus["de-en"].id).to.equal("Xenova/opus-mt-de-en");
	});

	it("resolves a candidate to its model", () => {
		const catalog = buildCatalog();

		expect(refFor(catalog, "llm")).to.equal(catalog.llm);
		expect(refFor(catalog, "nllb")).to.equal(catalog.nllb);
		expect(refFor(catalog, "opus:de-en")).to.equal(catalog.opus["de-en"]);
		expect(refFor(catalog, "opus:xx-yy")).to.equal(null);
	});

	it("lists every model once, LLM first", () => {
		const models = catalogModels(buildCatalog());

		expect(models[0].id).to.equal(DEFAULT_LLM_ID);
		expect(models[1].id).to.equal(DEFAULT_NLLB_ID);
		expect(new Set(models.map((m) => m.id)).size).to.equal(models.length);
	});

	it("names the candidate a model answers for", () => {
		const catalog = buildCatalog();

		expect(candidateOf(catalog.llm)).to.equal("llm");
		expect(candidateOf(catalog.nllb)).to.equal("nllb");
		expect(candidateOf(catalog.opus["de-en"])).to.equal("opus:de-en");
	});

	it("one model the cache cannot answer for does not empty the list", async () => {
		const api: CacheApi = {
			has(ref) {
				return ref.id === DEFAULT_LLM_ID
					? Promise.reject(new Error(`unknown WebLLM model ${ref.id}`))
					: Promise.resolve(true);
			},
			delete() {
				return Promise.resolve();
			},
		};
		const states = await cacheStates(buildCatalog(), api);

		expect(states.length).to.equal(catalogModels(buildCatalog()).length);
		expect(states.find((s) => s.ref.id === DEFAULT_LLM_ID)?.cached).to.equal(false);
		expect(states.filter((s) => s.ref.id !== DEFAULT_LLM_ID).every((s) => s.cached)).to.equal(
			true
		);
	});

	it("asks the cache api about every model", async () => {
		const asked: string[] = [];
		const api: CacheApi = {
			has(ref) {
				asked.push(ref.id);
				return Promise.resolve(ref.id === DEFAULT_NLLB_ID);
			},
			delete() {
				return Promise.resolve();
			},
		};
		const states = await cacheStates(buildCatalog(), api);

		expect(asked.length).to.equal(states.length);
		expect(states.find((s) => s.ref.id === DEFAULT_NLLB_ID)?.cached).to.equal(true);
		expect(states.find((s) => s.ref.id === DEFAULT_LLM_ID)?.cached).to.equal(false);
	});
});
