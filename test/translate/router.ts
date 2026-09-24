import {expect} from "chai";
import type {ModelRef} from "../../client/js/translate/engine";
import {buildCatalog} from "../../client/js/translate/models";
import {
	candidatesFor,
	classesOf,
	mergeRoutes,
	resolveRoute,
	type RouteInput,
	type RouteTable,
} from "../../client/js/translate/router";
import {
	DEFAULT_ROUTES,
	LIMITED_LANGUAGES,
	NLLB_FIRST,
	NLLB_TIED,
	isLimitedLanguage,
} from "../../client/js/translate/routes.default";
import {nllbCode} from "../../client/js/translate/languages";

const catalog = buildCatalog();
const table: RouteTable = {
	"*": {"*": ["llm", "nllb"], sw: ["nllb", "llm"]},
	en: {
		"*": ["llm", "nllb"],
		// The LLM and the OPUS pair are one class, NLLB the next.
		de: [["llm", "opus:de-en"], "nllb"],
		// A strict order: NLLB, then the LLM.
		sw: ["nllb", "llm"],
	},
};

function input(overrides: Partial<RouteInput> = {}): RouteInput {
	return {
		from: "de",
		hint: null,
		to: "en",
		tier: "gpu",
		allowLlm: true,
		allowCpu: true,
		down: new Set(),
		...overrides,
	};
}

const isCached = (id: string) => (ref: ModelRef) => ref.id === id;

describe("translate/router", () => {
	it("reads a bare candidate as a class of one and a list as one class", () => {
		expect(classesOf(["llm", "nllb"])).to.deep.equal([["llm"], ["nllb"]]);
		expect(classesOf([["llm", "opus:de-en"], "nllb", []])).to.deep.equal([
			["llm", "opus:de-en"],
			["nllb"],
		]);
	});

	it("looks up the exact pair, the target's wildcard, the source's row, then the global one", () => {
		expect(candidatesFor(table, "de", "en")).to.deep.equal([["llm", "opus:de-en"], ["nllb"]]);
		expect(candidatesFor(table, "fr", "en")).to.deep.equal([["llm"], ["nllb"]]);
		expect(candidatesFor(table, "en", "de")).to.deep.equal([["llm"], ["nllb"]]);
		// No row for the target: the wildcard target's row for the source.
		expect(candidatesFor(table, "sw", "pt")).to.deep.equal([["nllb"], ["llm"]]);
		expect(candidatesFor({}, "en", "de")).to.deep.equal([]);
	});

	it("routes a same-language request to the LLM alone", () => {
		// The composer's cleanup pass: English corrected in English.
		expect(resolveRoute(table, catalog, input({from: "en", to: "en"}))?.candidate).to.equal(
			"llm"
		);
		expect(resolveRoute(table, catalog, input({from: "en", to: "en", tier: "cpu"}))).to.equal(
			null
		);
		expect(
			resolveRoute(table, catalog, input({from: "en", to: "en", allowLlm: false}))
		).to.equal(null);
		expect(
			resolveRoute(table, catalog, input({from: "en", to: "en", down: new Set(["llm"])}))
		).to.equal(null);
		// The hint counts as the source here too.
		expect(
			resolveRoute(table, catalog, input({from: null, hint: "en", to: "en"}))?.candidate
		).to.equal("llm");
	});

	it("takes the first class with a candidate the device, the settings and the session allow", () => {
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

	it("skips the seq2seq candidates when neither a source nor a hint is known", () => {
		expect(resolveRoute(table, catalog, input({from: null, tier: "cpu"}))).to.equal(null);
		expect(resolveRoute(table, catalog, input({from: null}))?.candidate).to.equal("llm");
	});

	it("takes the source hint for the table row and for a seq2seq candidate's source", () => {
		// A draft left to the model, the detector's weak verdict Swahili: the
		// Swahili row, whose best class is NLLB.
		expect(resolveRoute(table, catalog, input({from: null, hint: "sw"}))?.candidate).to.equal(
			"nllb"
		);
		// On a CPU-only device the hint is what lets the OPUS pair run at all.
		expect(
			resolveRoute(table, catalog, input({from: null, hint: "de", tier: "cpu"}))?.candidate
		).to.equal("opus:de-en");
		// A named source wins over the hint.
		expect(
			resolveRoute(table, catalog, input({from: "de", hint: "sw", tier: "cpu"}))?.candidate
		).to.equal("opus:de-en");
	});

	it("prefers a downloaded candidate inside its class", () => {
		// llm is first in the class and allowed, but the OPUS pair of the same
		// class is downloaded: taking llm would wait for a download for no
		// better a translation.
		expect(
			resolveRoute(table, catalog, input({cached: isCached(catalog.opus["de-en"].id)}))
				?.candidate
		).to.equal("opus:de-en");

		// Nothing cached, or nothing to ask: the class's order stands.
		expect(resolveRoute(table, catalog, input({cached: () => false}))?.candidate).to.equal(
			"llm"
		);
		expect(resolveRoute(table, catalog, input())?.candidate).to.equal("llm");
	});

	it("never skips a better class for a downloaded model in a worse one", () => {
		// Swahili: NLLB strictly first. A downloaded LLM does not take it.
		expect(
			resolveRoute(table, catalog, input({from: "sw", cached: isCached(catalog.llm.id)}))
				?.candidate
		).to.equal("nllb");
		// de→en: NLLB is a worse class than the LLM, downloaded or not.
		expect(
			resolveRoute(table, catalog, input({cached: isCached(catalog.nllb.id)}))?.candidate
		).to.equal("llm");
		// The better class unusable (the CPU tier switched off): the next class.
		expect(
			resolveRoute(
				table,
				catalog,
				input({from: "sw", allowCpu: false, cached: isCached(catalog.llm.id)})
			)?.candidate
		).to.equal("llm");
	});

	it("never picks a candidate that is down or disallowed, cached or not", () => {
		const cachedOpus = isCached(catalog.opus["de-en"].id);

		expect(
			resolveRoute(table, catalog, input({cached: cachedOpus, down: new Set(["opus:de-en"])}))
				?.candidate
		).to.equal("llm");
		// A downloaded LLM on a device that cannot run it stays unrouted.
		expect(
			resolveRoute(table, catalog, input({tier: "cpu", cached: isCached(catalog.llm.id)}))
				?.candidate
		).to.equal("opus:de-en");
		// A down best class falls to the next one.
		expect(
			resolveRoute(table, catalog, input({from: "sw", down: new Set(["nllb"])}))?.candidate
		).to.equal("llm");
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
		const merged = mergeRoutes(table, {en: {de: ["nllb"]}, pt: {"*": [["nllb", "llm"]]}});

		expect(merged.en.de).to.deep.equal(["nllb"]);
		expect(merged.en.sw).to.deep.equal(["nllb", "llm"]);
		expect(merged.pt["*"]).to.deep.equal([["nllb", "llm"]]);
		expect(merged["*"]["*"]).to.deep.equal(["llm", "nllb"]);
		expect(table.en.de).to.deep.equal([["llm", "opus:de-en"], "nllb"]);
	});

	it("a deploy's flat override is a strict order, one candidate per class", () => {
		// The shape config.json overrides have always had.
		const merged = mergeRoutes(table, {de: {"*": ["llm", "nllb"]}});

		expect(candidatesFor(merged, "en", "de")).to.deep.equal([["llm"], ["nllb"]]);
		expect(
			resolveRoute(
				merged,
				catalog,
				input({from: "en", to: "de", cached: isCached(catalog.nllb.id)})
			)?.candidate
		).to.equal("llm");
	});

	describe("the default table", () => {
		it("puts NLLB first where it measured ahead, in both directions", () => {
			// Arabic measured NLLB ahead too, but stays LLM-first for the
			// channel context the LLM reads (routes.default.ts): it routes like
			// any language the table has no opinion about.
			for (const pair of [
				["ar", "en"],
				["en", "ar"],
			] as const) {
				expect(
					candidatesFor(DEFAULT_ROUTES, pair[0], pair[1]),
					pair.join("→")
				).to.deep.equal(
					candidatesFor(
						DEFAULT_ROUTES,
						pair[0] === "ar" ? "pt" : "en",
						pair[1] === "ar" ? "pt" : "en"
					)
				);
			}

			// Placed from the web build's own weights (2026-09-13-web-weights.md).
			for (const code of ["tl", "el", "fi", "hu", "hi", "sw"]) {
				expect(candidatesFor(DEFAULT_ROUTES, code, "en"), `${code}→en`).to.deep.equal([
					["nllb"],
					["llm"],
				]);
				expect(candidatesFor(DEFAULT_ROUTES, "en", code), `en→${code}`).to.deep.equal([
					["nllb"],
					["llm"],
				]);
			}

			// A target with no row of its own still sends a weak source to NLLB.
			expect(candidatesFor(DEFAULT_ROUTES, "tl", "pt")).to.deep.equal([["nllb"], ["llm"]]);
			// Either side weak is enough.
			expect(candidatesFor(DEFAULT_ROUTES, "el", "sk")).to.deep.equal([["nllb"], ["llm"]]);
		});

		it("puts the LLM and NLLB in one class where they tied", () => {
			for (const code of ["sk", "ms", "gl", "th", "cs", "nb", "bg", "id"]) {
				expect(candidatesFor(DEFAULT_ROUTES, code, "en"), `${code}→en`).to.deep.equal([
					["llm", "nllb"],
				]);
				expect(candidatesFor(DEFAULT_ROUTES, "fr", code), `fr→${code}`).to.deep.equal([
					["llm", "nllb"],
				]);
			}
		});

		it("gives the OPUS-MT pairs the class they measured into", () => {
			expect(candidatesFor(DEFAULT_ROUTES, "de", "en")).to.deep.equal([
				["llm", "opus:de-en"],
				["nllb"],
			]);
			expect(candidatesFor(DEFAULT_ROUTES, "en", "ru")).to.deep.equal([
				["llm", "opus:en-ru"],
				["nllb"],
			]);
			// French tied with OPUS-MT on the web weights (Qwen +3).
			expect(candidatesFor(DEFAULT_ROUTES, "en", "fr")).to.deep.equal([
				["llm", "opus:en-fr"],
				["nllb"],
			]);
			expect(candidatesFor(DEFAULT_ROUTES, "en", "es")).to.deep.equal([
				["llm"],
				["opus:en-es"],
				["nllb"],
			]);
		});

		it("keeps the LLM first everywhere else", () => {
			expect(candidatesFor(DEFAULT_ROUTES, "ja", "fr")).to.deep.equal([["llm"], ["nllb"]]);
			expect(candidatesFor(DEFAULT_ROUTES, "en", "pt")).to.deep.equal([["llm"], ["nllb"]]);
			expect(candidatesFor(DEFAULT_ROUTES, "de", "fr")).to.deep.equal([["llm"], ["nllb"]]);

			// Qwen ahead of NLLB by more than the tie band on the web weights.
			for (const code of ["pl", "ca", "ga"]) {
				expect(candidatesFor(DEFAULT_ROUTES, "en", code), `en→${code}`).to.deep.equal([
					["llm"],
					["nllb"],
				]);
			}
		});

		it("Filipino with Qwen downloaded and NLLB not goes to NLLB", () => {
			expect(
				resolveRoute(
					DEFAULT_ROUTES,
					catalog,
					input({from: null, hint: "tl", to: "en", cached: isCached(catalog.llm.id)})
				)?.candidate
			).to.equal("nllb");
			expect(
				resolveRoute(
					DEFAULT_ROUTES,
					catalog,
					input({from: "en", to: "tl", cached: isCached(catalog.llm.id)})
				)?.candidate
			).to.equal("nllb");
		});

		it("every placed language has an NLLB code, and the limited ones are marked", () => {
			for (const code of [...NLLB_FIRST, ...NLLB_TIED]) {
				expect(nllbCode(code), code).to.not.equal(null);
			}

			expect([...LIMITED_LANGUAGES].sort()).to.deep.equal(["bn", "hi", "hu", "ko", "sk"]);
			expect(isLimitedLanguage("hu")).to.equal(true);
			expect(isLimitedLanguage("fi")).to.equal(false);
			expect(isLimitedLanguage(null)).to.equal(false);
		});
	});
});
