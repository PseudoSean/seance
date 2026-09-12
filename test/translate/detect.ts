import {expect} from "chai";
import {
	DETECT_CANDIDATES,
	DETECT_MIN_GAP,
	DETECT_MIN_LENGTH,
	ISO3_OF,
	LanguagePrior,
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
