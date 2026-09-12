import {expect} from "chai";
import {
	DECLARED_MARGIN,
	DETECT_CANDIDATES,
	DETECT_MIN_GAP,
	DETECT_MIN_LENGTH,
	ISO3_OF,
	LanguagePrior,
	type Scores,
	detectLanguage,
	detectWith,
	iso3ToIso1,
	setDetector,
} from "../../client/js/translate/detect";
import {SUPPORTED_LANGUAGES} from "../../client/js/translate/languages";

describe("translate/detect", () => {
	afterEach(() => setDetector(null));

	it("maps every supported language to a three-letter code and back", () => {
		for (const code of SUPPORTED_LANGUAGES) {
			expect(ISO3_OF[code], code).to.match(/^[a-z]{3}$/);
			expect(iso3ToIso1(ISO3_OF[code]), code).to.equal(code);
		}

		expect(ISO3_OF.zh).to.equal("cmn");
		expect(iso3ToIso1("zho")).to.equal("zh");
		expect(iso3ToIso1("und")).to.equal(null);
		expect(ISO3_OF.ms).to.equal("zlm");
		expect(iso3ToIso1("zsm")).to.equal("ms");
	});

	it("names the best language with the gap to the runner-up as confidence", () => {
		expect(
			detectWith(
				[
					["deu", 1],
					["nld", 0.6],
					["eng", 0.5],
				],
				null
			)
		).to.deep.equal({lang: "de", confidence: 0.4, candidates: ["de", "nl", "en"]});
	});

	it("names nothing when franc cannot tell or the gap is too small", () => {
		expect(detectWith([["und", 1]], null)).to.deep.equal({
			lang: null,
			confidence: 0,
			candidates: [],
		});
		expect(detectWith([], null)).to.deep.equal({lang: null, confidence: 0, candidates: []});
		expect(
			detectWith(
				[
					["nob", 1],
					["dan", 0.97],
				],
				null
			)
		).to.deep.equal({lang: null, confidence: 0.03, candidates: ["nb", "da"]});
	});

	it("lets the channel's prior settle a near tie", () => {
		expect(
			detectWith(
				[
					["nob", 1],
					["dan", 0.97],
				],
				"da"
			)
		).to.deep.equal({lang: "da", confidence: DETECT_MIN_GAP, candidates: ["nb", "da"]});
		// not a tie: the prior does not override a clear winner
		expect(
			detectWith(
				[
					["deu", 1],
					["dan", 0.5],
				],
				"da"
			).lang
		).to.equal("de");
	});

	it("an unknown best language is undetermined; an unknown runner-up is ignored", () => {
		expect(
			detectWith(
				[
					["xxx", 1],
					["fra", 0.8],
				],
				null
			)
		).to.deep.equal({lang: null, confidence: 0, candidates: ["fr"]});
		expect(
			detectWith(
				[
					["deu", 1],
					["xxx", 0.9],
					["fra", 0.5],
				],
				null
			)
		).to.deep.equal({lang: "de", confidence: 0.5, candidates: ["de", "fr"]});
	});

	it("carries at most DETECT_CANDIDATES known contenders, deduplicated, in franc's order", () => {
		expect(DETECT_CANDIDATES).to.equal(3);
		expect(
			detectWith(
				[
					["deu", 1],
					["nld", 0.9],
					["xxx", 0.8],
					["fra", 0.7],
					["spa", 0.6],
				],
				null
			).candidates
		).to.deep.equal(["de", "nl", "fr"]);
		// Two franc codes, one language: `cmn` and `zho` are both Chinese.
		expect(
			detectWith(
				[
					["cmn", 1],
					["zho", 0.99],
					["jpn", 0.4],
				],
				null
			).candidates
		).to.deep.equal(["zh", "ja"]);
	});

	// The channel's declared languages (channelStore.ts `languages`): what
	// the reader says people write here, weighed above franc's own lead.
	it("a declared language wins over a close undeclared best", () => {
		expect(DECLARED_MARGIN).to.equal(0.25);
		expect(
			detectWith(
				[
					["nld", 1],
					["deu", 0.8],
				],
				null,
				["de"]
			)
		).to.deep.equal({lang: "de", confidence: DETECT_MIN_GAP, candidates: ["de", "nl"]});
		// The margin is the edge, and it is inclusive.
		expect(
			detectWith(
				[
					["nld", 1],
					["deu", 0.75],
				],
				null,
				["de"]
			).lang
		).to.equal("de");
		// Further behind than the margin: franc's best stands.
		expect(
			detectWith(
				[
					["nld", 1],
					["deu", 0.7],
				],
				null,
				["de"]
			).lang
		).to.equal("nl");
		// Franc's best is itself declared and clear: unchanged, real gap.
		expect(
			detectWith(
				[
					["deu", 1],
					["nld", 0.3],
				],
				null,
				["de"]
			)
		).to.deep.equal({lang: "de", confidence: 0.7, candidates: ["de", "nl"]});
	});

	it("two declared contenders resolve by their own gap, then the prior", () => {
		const close: Scores = [
			["deu", 1],
			["nld", 0.95],
			["eng", 0.9],
		];

		// Neither can be separated and no prior names one: the line is left
		// alone rather than translated from a coin toss.
		expect(detectWith(close, null, ["de", "nl"])).to.deep.equal({
			lang: null,
			confidence: 0.05,
			candidates: ["de", "nl", "en"],
		});
		// The prior breaks the tie between the two declared languages.
		expect(detectWith(close, "nl", ["de", "nl"]).lang).to.equal("nl");
		// A prior naming neither of them decides nothing.
		expect(detectWith(close, "en", ["de", "nl"]).lang).to.equal(null);
		// Their own gap is enough: the better declared one wins, and the
		// undeclared language between them does not enter the gap.
		expect(
			detectWith(
				[
					["deu", 1],
					["eng", 0.99],
					["nld", 0.8],
				],
				null,
				["de", "nl"]
			)
		).to.deep.equal({lang: "de", confidence: 0.2, candidates: ["de", "nl", "en"]});
	});

	it("a best franc cannot place is rescued by a declared contender", () => {
		expect(
			detectWith(
				[
					["xxx", 1],
					["deu", 0.6],
				],
				null,
				["de"]
			)
		).to.deep.equal({lang: "de", confidence: DETECT_MIN_GAP, candidates: ["de"]});
		// None of the contenders is declared: undetermined as before.
		expect(
			detectWith(
				[
					["xxx", 1],
					["deu", 0.6],
				],
				null,
				["fr"]
			).lang
		).to.equal(null);
	});

	it("declared contenders lead the candidate list", () => {
		expect(
			detectWith(
				[
					["deu", 1],
					["nld", 0.9],
					["fra", 0.8],
					["spa", 0.7],
				],
				null,
				["es"]
			).candidates
		).to.deep.equal(["es", "de", "nl"]);
	});

	it("declaring nothing, or nothing routable, changes nothing", () => {
		const tie: Scores = [
			["nob", 1],
			["dan", 0.97],
		];

		expect(detectWith(tie, null, [])).to.deep.equal(detectWith(tie, null));
		expect(detectWith(tie, "da", [])).to.deep.equal(detectWith(tie, "da"));
		expect(detectWith(tie, null, ["xx"])).to.deep.equal(detectWith(tie, null));
	});

	it("a short line is placed when one declared language is not the target", async () => {
		setDetector(() => {
			throw new Error("the detector must not run on a line this short");
		});

		// Nine characters: too short for trigrams, but the channel writes
		// German and English and this reader reads English.
		expect(
			await detectLanguage("So ist es", null, ["de", "en"], {exclude: "en"})
		).to.deep.equal({lang: "de", confidence: 0, candidates: ["de"]});
		// Two candidates besides the target: nothing to choose between them.
		expect(
			(await detectLanguage("So ist es", null, ["de", "nl", "en"], {exclude: "en"})).lang
		).to.equal(null);
		// Declared but unroutable, or nothing declared at all: undetermined.
		expect((await detectLanguage("So ist es", null, ["xx"], {exclude: "en"})).lang).to.equal(
			null
		);
		expect(await detectLanguage("So ist es", null)).to.deep.equal({
			lang: null,
			confidence: 0,
			candidates: [],
		});
	});

	it("the prior is the most frequent language of the recent window", () => {
		const prior = new LanguagePrior(3);

		expect(prior.top()).to.equal(null);
		prior.note("de");
		prior.note("de");
		prior.note("en");
		expect(prior.top()).to.equal("de");
		prior.note("en");
		prior.note("en");
		expect(prior.top()).to.equal("en");
	});

	it("detectLanguage runs the detector on long enough text, with the prior", async () => {
		const calls: string[] = [];

		setDetector((text) => {
			calls.push(text);
			return [
				["deu", 1],
				["eng", 0.3],
			];
		});
		expect(await detectLanguage("kurz", null)).to.deep.equal({
			lang: null,
			confidence: 0,
			candidates: [],
		});
		expect(calls).to.deep.equal([]);

		const prior = new LanguagePrior();

		expect(
			await detectLanguage("Ja, gestern, der Batch-Cooldown greift jetzt.", prior)
		).to.deep.equal({
			lang: "de",
			confidence: 0.7,
			candidates: ["de", "en"],
		});
		expect(calls.length).to.equal(1);
		expect(prior.top()).to.equal("de");
	});

	it("the real detector recognises German", async function () {
		this.timeout(10000);
		const result = await detectLanguage("Guten Tag zusammen, wie geht es euch heute?", null);

		expect(result.lang).to.equal("de");
		expect(DETECT_MIN_LENGTH).to.equal(10);
		// The runners-up the chip's menu offers as one-click corrections:
		// German leads, and there is more than one contender to correct to.
		expect(result.candidates[0]).to.equal("de");
		expect(result.candidates.length).to.equal(DETECT_CANDIDATES);
	});
});
