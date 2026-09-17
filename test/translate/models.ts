import {expect} from "chai";
import {
	DEFAULT_LLM_ID,
	DEFAULT_NLLB_ID,
	LLM_CHOICES,
	QWEN3_1_7B_ID,
	QWEN3_4B_ID,
	buildCatalog,
	defaultLlmForAdapter,
	cacheStates,
	candidateOf,
	catalogModels,
	llmChoice,
	llmName,
	refFor,
	selectLlm,
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
		// The label is data, not copy: helpers/modelLabel.ts renders it.
		expect(catalog.opus["de-en"].label).to.deep.equal({kind: "opus", from: "de", to: "en"});
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

	it("lists every model once, the GPU choices first", () => {
		const models = catalogModels(buildCatalog());

		expect(models[0].id).to.equal(DEFAULT_LLM_ID);
		expect(models[1].id).to.equal(QWEN3_4B_ID);
		expect(models[2].id).to.equal(DEFAULT_NLLB_ID);
		expect(new Set(models.map((m) => m.id)).size).to.equal(models.length);
	});

	it("knows both GPU models, 1.7B selected by default", () => {
		const catalog = buildCatalog();

		expect(DEFAULT_LLM_ID).to.equal(QWEN3_1_7B_ID);
		expect(catalog.llmChoices.map((ref) => ref.id)).to.deep.equal([QWEN3_1_7B_ID, QWEN3_4B_ID]);
		expect(catalog.llmChoices.map((ref) => ref.id)).to.deep.equal(LLM_CHOICES.map((r) => r.id));
		expect(catalog.llmDefault).to.equal(QWEN3_1_7B_ID);
		expect(catalog.llm.id).to.equal(QWEN3_1_7B_ID);

		const [small, large] = catalog.llmChoices;

		expect(small).to.include({engine: "llm", family: "llm", sizeBytes: 1_100_000_000});
		expect(large).to.include({engine: "llm", family: "llm", sizeBytes: 2_300_000_000});
		expect(llmName(small)).to.equal("Qwen3 1.7B");
		expect(llmName(large)).to.equal("Qwen3 4B");
		expect(small.label).to.deep.equal({kind: "llm", name: "Qwen3 1.7B"});
		expect(small.lib).to.equal(undefined);
	});

	it("defaults to the 4B when the adapter fits it, else the 1.7B", () => {
		// A desktop-class adapter (the 4060-class machine this deploy runs
		// on) fits the 4B's ~3.4 GB of graphics memory with room to spare.
		expect(defaultLlmForAdapter(4 * 1024 * 1024 * 1024)).to.equal(QWEN3_4B_ID);
		expect(defaultLlmForAdapter(3_400_000_000)).to.equal(QWEN3_4B_ID);
		// Under the 4B's requirement the 1.7B is the best that fits.
		expect(defaultLlmForAdapter(3_399_999_999)).to.equal(QWEN3_1_7B_ID);
		expect(defaultLlmForAdapter(2 * 1024 * 1024 * 1024)).to.equal(QWEN3_1_7B_ID);
		// Even the smallest gpu-tier adapter (the 1 GiB floor) gets an answer.
		expect(defaultLlmForAdapter(1024 * 1024 * 1024)).to.equal(QWEN3_1_7B_ID);
	});

	it("the GPU choices carry their graphics-memory requirement", () => {
		const byId = new Map(LLM_CHOICES.map((ref) => [ref.id, ref]));

		expect(byId.get(QWEN3_4B_ID)?.vramBytes).to.be.greaterThan(
			byId.get(QWEN3_1_7B_ID)?.vramBytes ?? 0
		);
		// The 4B's check is the one the default decision makes: above 1 GiB
		// but below a 4 GiB adapter, or the default would never flip.
		expect(byId.get(QWEN3_4B_ID)?.vramBytes).to.be.greaterThan(1024 * 1024 * 1024);
		expect(byId.get(QWEN3_4B_ID)?.vramBytes).to.be.lessThan(4 * 1024 * 1024 * 1024);
	});

	it("selects the chosen GPU model; an id that is no choice selects the default", () => {
		expect(buildCatalog({}, QWEN3_4B_ID).llm.id).to.equal(QWEN3_4B_ID);
		expect(buildCatalog({}, "gone-model-q4f16_1-MLC").llm.id).to.equal(QWEN3_1_7B_ID);
		expect(buildCatalog({}, null).llm.id).to.equal(QWEN3_1_7B_ID);

		const catalog = buildCatalog();
		const large = selectLlm(catalog, QWEN3_4B_ID);

		expect(large.llm.id).to.equal(QWEN3_4B_ID);
		expect(large.llmChoices).to.equal(catalog.llmChoices);
		expect(catalogModels(large).map((m) => m.id)).to.deep.equal(
			catalogModels(catalog).map((m) => m.id)
		);
		expect(selectLlm(catalog, QWEN3_1_7B_ID)).to.equal(catalog);
		expect(llmChoice(large, "nope").id).to.equal(QWEN3_1_7B_ID);
		expect(refFor(large, "llm")?.id).to.equal(QWEN3_4B_ID);
	});

	it("a deploy's own model becomes the default and is added to the choices, with its lib", () => {
		const catalog = buildCatalog({
			llm: {model: "gemma-3-1b-it-q4f16_1-MLC", lib: "https://m.test/gemma.wasm"},
		});

		expect(catalog.llmChoices.map((ref) => ref.id)).to.deep.equal([
			QWEN3_1_7B_ID,
			QWEN3_4B_ID,
			"gemma-3-1b-it-q4f16_1-MLC",
		]);
		expect(catalog.llmDefault).to.equal("gemma-3-1b-it-q4f16_1-MLC");
		expect(catalog.llm.id).to.equal("gemma-3-1b-it-q4f16_1-MLC");
		expect(catalog.llm.lib).to.equal("https://m.test/gemma.wasm");
		// The library is the deploy model's alone.
		expect(catalog.llmChoices.slice(0, 2).every((ref) => ref.lib === undefined)).to.equal(true);
		expect(buildCatalog({llm: {model: "gemma-3-1b-it-q4f16_1-MLC"}}, "stale").llm.id).to.equal(
			"gemma-3-1b-it-q4f16_1-MLC"
		);
		expect(
			buildCatalog({llm: {model: "gemma-3-1b-it-q4f16_1-MLC"}}, QWEN3_4B_ID).llm.id
		).to.equal(QWEN3_4B_ID);
	});

	it("a deploy naming a shipped model makes it the default without a duplicate row", () => {
		const catalog = buildCatalog({llm: {model: QWEN3_4B_ID, lib: "https://m.test/4b.wasm"}});

		expect(catalog.llmChoices.map((ref) => ref.id)).to.deep.equal([QWEN3_1_7B_ID, QWEN3_4B_ID]);
		expect(catalog.llm.id).to.equal(QWEN3_4B_ID);
		expect(catalog.llm.lib).to.equal("https://m.test/4b.wasm");
		expect(catalog.llmChoices[0].lib).to.equal(undefined);
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
