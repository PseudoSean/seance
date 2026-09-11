// Language identification for the reading pipeline (spec § detect.ts).
// `franc` (trigram profiles) runs on the main thread on every eligible
// message, in its own lazily loaded chunk; the queue and the LLM never see
// a message the detector places in the target language. Confidence is the
// gap between the best and the runner-up; a near tie goes to the channel's
// prior (its dominant language over the last messages). Vue-free.

import {NLLB_CODES, SUPPORTED_LANGUAGES, isSupported} from "./languages";

export interface Detection {
	lang: string | null;
	confidence: number;
}

/** `francAll`'s shape: `[iso639-3, weight]`, best first, best weight 1. */
export type Scores = [string, number][];
export type Detector = (text: string, options: {only: string[]}) => Scores;

export const DETECT_MIN_GAP = 0.1;
export const DETECT_MIN_LENGTH = 10;
export const PRIOR_WINDOW = 200;

/** ISO 639-1 → the 639-3 code franc reports; NLLB's FLORES codes carry it. */
export const ISO3_OF: Record<string, string> = Object.fromEntries(
	SUPPORTED_LANGUAGES.map((code) => [code, code === "zh" ? "cmn" : NLLB_CODES[code].slice(0, 3)])
);

const ISO1_OF: Record<string, string> = {
	...Object.fromEntries(Object.entries(ISO3_OF).map(([iso1, iso3]) => [iso3, iso1])),
	zho: "zh",
};

export function iso3ToIso1(code: string): string | null {
	return ISO1_OF[code] ?? null;
}

const ONLY = Object.values(ISO3_OF);

export function detectWith(scores: Scores, prior: string | null): Detection {
	const known = scores
		.map(([code, weight]) => ({lang: iso3ToIso1(code), weight}))
		.filter((entry): entry is {lang: string; weight: number} => entry.lang !== null);

	if (known.length === 0) {
		return {lang: null, confidence: 0};
	}

	const best = known[0];
	// The gap is against the runner-up in franc's raw ranking, not the
	// runner-up among known languages: a language we do not support but
	// franc ranked above `best` still makes `best` a less confident guess.
	const gap = scores.length > 1 ? scores[0][1] - scores[1][1] : scores[0][1];
	const confidence = Math.round(gap * 1000) / 1000;

	if (gap >= DETECT_MIN_GAP) {
		return {lang: best.lang, confidence};
	}

	// A near tie: the prior wins when it is one of the contenders.
	if (
		prior &&
		known.some((entry) => entry.lang === prior && best.weight - entry.weight < DETECT_MIN_GAP)
	) {
		return {lang: prior, confidence: DETECT_MIN_GAP};
	}

	return {lang: null, confidence};
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

export async function detectLanguage(
	text: string,
	prior: LanguagePrior | null
): Promise<Detection> {
	if (text.length < DETECT_MIN_LENGTH) {
		return {lang: null, confidence: 0};
	}

	const detect = await loadDetector();
	const result = detectWith(detect(text, {only: ONLY}), prior?.top() ?? null);

	if (result.lang && prior && isSupported(result.lang)) {
		prior.note(result.lang);
	}

	return result;
}
