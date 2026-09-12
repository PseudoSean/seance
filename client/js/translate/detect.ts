// Language identification for the reading pipeline (spec § detect.ts).
// `franc` (trigram profiles) runs on the main thread on every eligible
// message, in its own lazily loaded chunk; the queue and the LLM never see
// a message the detector places in the target language. Confidence is the
// gap between the best and the runner-up; a near tie goes to the channel's
// prior (its dominant language over the last messages). Above the prior sits
// the channel's *declared* languages (channelStore.ts `languages`): what the
// reader says people write here beats a close guess at something else,
// rescues a verdict franc could not place, and places a line too short to
// guess at when only one of them is not what the reader already reads.
// Vue-free.
//
// franc does not carry every language we support: Estonian, Basque, Irish,
// Welsh and Icelandic have no trigram or script data in it at all, so
// `detectWith` never proposes them — those five are only translated on a
// forced/manual request, never auto-detected. Malay is a near miss: franc
// knows the code `zlm`, not NLLB's `zsm`, so `ISO3_OF`/`ISO1_OF` carry an
// override for it (the same shape as the existing `cmn`/`zho` override for
// Chinese).

import {NLLB_CODES, SUPPORTED_LANGUAGES, isSupported} from "./languages";

export interface Detection {
	lang: string | null;
	confidence: number;
	/**
	 * The known languages franc ranked highest, best first (at most
	 * `DETECT_CANDIDATES`), whatever the verdict: the chip's menu offers them
	 * as one-click corrections when detection got the source wrong. `lang`
	 * may be null while these still name the contenders.
	 */
	candidates: string[];
}

/** `francAll`'s shape: `[iso639-3, weight]`, best first, best weight 1. */
export type Scores = [string, number][];
export type Detector = (text: string, options: {only: string[]}) => Scores;

export const DETECT_MIN_GAP = 0.1;
export const DETECT_MIN_LENGTH = 10;
/**
 * How far behind franc's best a declared language may rank and still win it:
 * the channel's own languages are a stronger claim than a trigram lead this
 * small, and a wrong source is a wrong translation.
 */
export const DECLARED_MARGIN = 0.25;
export const PRIOR_WINDOW = 200;
/** How many of franc's known contenders a `Detection` carries. */
export const DETECT_CANDIDATES = 3;

/** Where franc's code differs from the NLLB/FLORES code's first three letters. */
const FRANC_OVERRIDES: Record<string, string> = {zh: "cmn", ms: "zlm"};

/** ISO 639-1 → the 639-3 code franc reports; NLLB's FLORES codes carry it. */
export const ISO3_OF: Record<string, string> = Object.fromEntries(
	SUPPORTED_LANGUAGES.map((code) => [code, FRANC_OVERRIDES[code] ?? NLLB_CODES[code].slice(0, 3)])
);

const ISO1_OF: Record<string, string> = {
	...Object.fromEntries(Object.entries(ISO3_OF).map(([iso1, iso3]) => [iso3, iso1])),
	// The NLLB code for each override language still maps back to it.
	zho: "zh",
	zsm: "ms",
};

export function iso3ToIso1(code: string): string | null {
	return ISO1_OF[code] ?? null;
}

const ONLY = Object.values(ISO3_OF);

/** The declared codes this build can route, deduplicated, order kept. */
export function declaredLanguages(declared: readonly string[]): string[] {
	const out: string[] = [];

	for (const code of declared) {
		if (isSupported(code) && !out.includes(code)) {
			out.push(code);
		}
	}

	return out;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function detectWith(
	scores: Scores,
	prior: string | null,
	declared: string[] = []
): Detection {
	// The languages we could translate from, in franc's order. An unknown
	// code ranked *below* a known best is simply not a contender and is
	// dropped from the gap.
	const known = scores
		.map(([code, weight]) => ({lang: iso3ToIso1(code), weight}))
		.filter((entry): entry is {lang: string; weight: number} => entry.lang !== null);
	const wanted = new Set(declaredLanguages(declared));

	// The contenders the reader is offered whatever the verdict below —
	// including one franc rated above a language it does not know. The
	// channel's own languages lead (the correction a reader is likeliest to
	// want), each group in franc's order. Two franc codes can map to the
	// same language (`cmn`/`zho`), so dedupe.
	const candidates: string[] = [];

	for (const entry of [
		...known.filter((e) => wanted.has(e.lang)),
		...known.filter((e) => !wanted.has(e.lang)),
	]) {
		if (!candidates.includes(entry.lang) && candidates.length < DETECT_CANDIDATES) {
			candidates.push(entry.lang);
		}
	}

	// franc's raw best is the language it is actually most sure of. When
	// that language is not one we support, the detection is undetermined:
	// guessing a lower-ranked known language would translate from the wrong
	// source. (A forced/manual translation request still lets the LLM
	// detect on its own, and the chip's menu offers the runners-up above.)
	// Unless the channel declared one of the contenders: the reader has said
	// people write it here, which is worth more than franc's verdict on a
	// language we could not have translated from anyway.
	if (scores.length === 0 || iso3ToIso1(scores[0][0]) === null) {
		const rescued = known.find((entry) => wanted.has(entry.lang));

		if (rescued) {
			return {lang: rescued.lang, confidence: DETECT_MIN_GAP, candidates};
		}

		return {lang: null, confidence: 0, candidates};
	}

	const best = known[0];
	const second = known[1];
	const gap = second ? best.weight - second.weight : best.weight;
	const confidence = round(gap);

	// The channel's own languages, in franc's order, as close to the best as
	// DECLARED_MARGIN allows. One of them wins over an undeclared best: a
	// trigram lead that small is a weaker claim than the reader's.
	const ours = known.filter(
		(entry) => wanted.has(entry.lang) && best.weight - entry.weight <= DECLARED_MARGIN
	);

	if (ours.length > 0) {
		const top = ours[0];
		const next = ours[1];

		if (!next) {
			return {
				lang: top.lang,
				// The declaration decided it, not the measurement — except
				// where it is franc's own best, whose lead is real.
				confidence: top === best ? confidence : DETECT_MIN_GAP,
				candidates,
			};
		}

		const own = top.weight - next.weight;

		if (own >= DETECT_MIN_GAP) {
			return {lang: top.lang, confidence: round(own), candidates};
		}

		// Two of the channel's own languages, too close to separate: the
		// prior settles it, and where it cannot the line is left alone rather
		// than translated from a coin toss.
		if (prior && ours.some((entry) => entry.lang === prior)) {
			return {lang: prior, confidence: DETECT_MIN_GAP, candidates};
		}

		return {lang: null, confidence: round(own), candidates};
	}

	if (gap >= DETECT_MIN_GAP) {
		return {lang: best.lang, confidence, candidates};
	}

	// A near tie: the prior wins when it is one of the contenders.
	if (
		prior &&
		known.some((entry) => entry.lang === prior && best.weight - entry.weight < DETECT_MIN_GAP)
	) {
		return {lang: prior, confidence: DETECT_MIN_GAP, candidates};
	}

	return {lang: null, confidence, candidates};
}

/** The dominant language of a channel's recent messages. */
export class LanguagePrior {
	private recent: string[] = [];
	private window: number;

	constructor(window: number = PRIOR_WINDOW) {
		this.window = window;
	}

	note(lang: string): void {
		this.recent.push(lang);

		if (this.recent.length > this.window) {
			this.recent.shift();
		}
	}

	top(): string | null {
		const counts = new Map<string, number>();

		for (const lang of this.recent) {
			counts.set(lang, (counts.get(lang) ?? 0) + 1);
		}

		let top: string | null = null;
		let topCount = 0;

		for (const [lang, count] of counts) {
			if (count > topCount) {
				top = lang;
				topCount = count;
			}
		}

		return top;
	}
}

let detector: Detector | null = null;
let loading: Promise<Detector> | null = null;

/** Tests: a scripted detector; `null` restores the real one. */
export function setDetector(next: Detector | null): void {
	detector = next;
	loading = null;
}

export function loadDetector(): Promise<Detector> {
	if (detector) {
		return Promise.resolve(detector);
	}

	if (!loading) {
		loading = import(/* webpackChunkName: "franc" */ "franc")
			.then((module) => {
				const fn: Detector = (text, options) => module.francAll(text, options) as Scores;

				detector = fn;
				return fn;
			})
			.catch((error) => {
				loading = null;
				throw error;
			});
	}

	return loading;
}

/**
 * `declared` is the channel's own languages (channelStore.ts `languages`);
 * `options.exclude` is the language the reader already reads, so a channel
 * that declares exactly one language besides it can place a line too short
 * for franc. The writer passes neither: a draft is the user's own language,
 * not a channel matter.
 */
export async function detectLanguage(
	text: string,
	prior: LanguagePrior | null,
	declared: string[] = [],
	options: {exclude?: string} = {}
): Promise<Detection> {
	if (text.length < DETECT_MIN_LENGTH) {
		// Too short for trigrams — but a channel where German and English are
		// written, read in English, leaves one answer. Confidence 0 says
		// where it came from, and nothing is noted into the prior: a line the
		// detector never saw is no evidence about the channel.
		const only = declaredLanguages(declared).filter((code) => code !== options.exclude);

		if (only.length === 1) {
			return {lang: only[0], confidence: 0, candidates: only};
		}

		return {lang: null, confidence: 0, candidates: []};
	}

	const detect = await loadDetector();
	const result = detectWith(detect(text, {only: ONLY}), prior?.top() ?? null, declared);

	if (result.lang && prior && isSupported(result.lang)) {
		prior.note(result.lang);
	}

	return result;
}
