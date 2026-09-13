import {expect} from "chai";
import {QWEN3_1_7B_ID, QWEN3_4B_ID} from "../../client/js/translate/models";
import {
	DEFAULT_ROUTES,
	LIMITED_LANGUAGES,
	NLLB_FIRST,
	NLLB_TIED,
	OPUS_TIED,
	QWEN3_1_7B,
	QWEN3_4B,
	QWEN3_4B_LIMITED_LANGUAGES,
	QWEN3_4B_NLLB_FIRST,
	QWEN3_4B_NLLB_TIED,
	QWEN3_4B_OPUS_TIED,
	buildRoutes,
	isLimitedLanguage,
	limitedLanguagesFor,
	placementFor,
	routesFor,
} from "../../client/js/translate/routes.default";

describe("translate/routes.default", () => {
	it("routesFor gives each GPU model its table, 1.7B's for any other id", () => {
		expect(routesFor(QWEN3_1_7B_ID)).to.equal(DEFAULT_ROUTES);
		expect(routesFor("gemma-3-1b-it-q4f16_1-MLC")).to.equal(DEFAULT_ROUTES);
		expect(routesFor(null)).to.equal(DEFAULT_ROUTES);
		expect(routesFor(QWEN3_4B_ID)).to.not.equal(DEFAULT_ROUTES);
		expect(routesFor(QWEN3_4B_ID)).to.equal(routesFor(QWEN3_4B_ID));
	});

	it("1.7B's placements are the exported lists", () => {
		expect(placementFor(QWEN3_1_7B_ID)).to.equal(QWEN3_1_7B);
		expect(QWEN3_1_7B.nllbFirst).to.equal(NLLB_FIRST);
		expect(QWEN3_1_7B.nllbTied).to.equal(NLLB_TIED);
		expect(QWEN3_1_7B.opusTied).to.equal(OPUS_TIED);
		expect(QWEN3_1_7B.limited).to.equal(LIMITED_LANGUAGES);
	});

	it("4B has lists of its own", () => {
		expect(placementFor(QWEN3_4B_ID)).to.equal(QWEN3_4B);
		expect(QWEN3_4B.nllbFirst).to.equal(QWEN3_4B_NLLB_FIRST).and.not.equal(NLLB_FIRST);
		expect(QWEN3_4B.nllbTied).to.equal(QWEN3_4B_NLLB_TIED).and.not.equal(NLLB_TIED);
		expect(QWEN3_4B.opusTied).to.equal(QWEN3_4B_OPUS_TIED).and.not.equal(OPUS_TIED);
		expect(QWEN3_4B.limited)
			.to.equal(QWEN3_4B_LIMITED_LANGUAGES)
			.and.not.equal(LIMITED_LANGUAGES);
	});

	// Until the 4B measurement re-places languages: this is the test that
	// change is meant to break.
	it("the 4B table is 1.7B's today", () => {
		expect(routesFor(QWEN3_4B_ID)).to.deep.equal(DEFAULT_ROUTES);
		expect([...QWEN3_4B_LIMITED_LANGUAGES]).to.deep.equal([...LIMITED_LANGUAGES]);
	});

	it("a table follows its placement lists", () => {
		const table = buildRoutes({
			nllbFirst: ["fi"],
			nllbTied: [],
			opusTied: [],
			limited: [],
		});

		expect(table["*"].fi).to.deep.equal(["nllb", "llm"]);
		expect(table["*"].sr).to.equal(undefined);
		// de-en is an OPUS pair not tied in this placement: the LLM, then OPUS.
		expect(table.en.de).to.deep.equal(["llm", "opus:de-en", "nllb"]);
	});

	it("the limited languages are per model", () => {
		expect(limitedLanguagesFor(QWEN3_1_7B_ID)).to.equal(LIMITED_LANGUAGES);
		expect(limitedLanguagesFor(QWEN3_4B_ID)).to.equal(QWEN3_4B_LIMITED_LANGUAGES);
		expect(limitedLanguagesFor("gemma-3-1b-it-q4f16_1-MLC")).to.equal(LIMITED_LANGUAGES);
		expect(isLimitedLanguage("hu", QWEN3_4B_ID)).to.equal(true);
		expect(isLimitedLanguage("fi", QWEN3_4B_ID)).to.equal(false);
		expect(isLimitedLanguage("hu")).to.equal(true);
		expect(isLimitedLanguage(null, QWEN3_4B_ID)).to.equal(false);
	});
});
