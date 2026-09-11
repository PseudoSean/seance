import {expect} from "chai";
import {
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
		).to.deep.equal({lang: "de", confidence: 0.4});
	});

	it("names nothing when franc cannot tell or the gap is too small", () => {
		expect(detectWith([["und", 1]], null)).to.deep.equal({lang: null, confidence: 0});
		expect(detectWith([], null)).to.deep.equal({lang: null, confidence: 0});
		expect(
			detectWith(
				[
					["nob", 1],
					["dan", 0.97],
				],
				null
			)
		).to.deep.equal({lang: null, confidence: 0.03});
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
		).to.deep.equal({lang: "da", confidence: DETECT_MIN_GAP});
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

	it("skips codes it does not know", () => {
		expect(
			detectWith(
				[
					["xxx", 1],
					["fra", 0.8],
				],
				null
			)
		).to.deep.equal({lang: "fr", confidence: 0.2});
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
		expect(await detectLanguage("kurz", null)).to.deep.equal({lang: null, confidence: 0});
		expect(calls).to.deep.equal([]);

		const prior = new LanguagePrior();

		expect(
			await detectLanguage("Ja, gestern, der Batch-Cooldown greift jetzt.", prior)
		).to.deep.equal({
			lang: "de",
			confidence: 0.7,
		});
		expect(calls.length).to.equal(1);
		expect(prior.top()).to.equal("de");
	});

	it("the real detector recognises German", async function () {
		this.timeout(10000);
		const result = await detectLanguage("Guten Tag zusammen, wie geht es euch heute?", null);

		expect(result.lang).to.equal("de");
		expect(DETECT_MIN_LENGTH).to.equal(10);
	});
});
