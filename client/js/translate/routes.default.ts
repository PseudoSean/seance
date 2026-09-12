// The shipped route table, placed by measurement: the share of an English
// line's content words that came back after a round trip through each
// engine (tools/translate-eval/results/2026-09-12-languages.md). Small
// samples, so a difference under ~10 points is a tie. Each language is
// placed in both directions, since the measurement is a round trip.
//
// - NLLB first, the LLM as a fallback class, where NLLB came back ahead by
//   more than the tie band.
// - The LLM and NLLB in one class where they tie: a downloaded NLLB is
//   preferred, the LLM otherwise (router.ts).
// - The OPUS-MT pairs: in one class with the LLM for de, nl and ru (OPUS
//   ahead on three cases, and under a second a line on the CPU), the class
//   after the LLM for fr, es and it (the LLM ahead).
// - Every other language: the LLM first, NLLB next.

import {Candidate, DEFAULT_OPUS_PAIRS} from "./models";
import {RouteEntry, RouteTable} from "./router";

/** NLLB came back ahead of the LLM by more than the tie band. */
export const NLLB_FIRST: readonly string[] = [
	"sr",
	"hr",
	"sl",
	"bg",
	"el",
	"he",
	"fa",
	"bn",
	"ta",
	"et",
	"lv",
	"lt",
	"eu",
	"ga",
	"cy",
	"is",
	"sw",
	"af",
	"tl",
	"ur",
	"fi",
	"ca",
	"nb",
	"ar",
	"id",
];

/** The LLM and NLLB within the tie band: one class. */
export const NLLB_TIED: readonly string[] = ["sk", "ms", "gl", "hi", "hu", "th", "cs", "pl"];

/** OPUS-MT pair languages whose pairs tie with or beat the LLM: one class with it. */
export const OPUS_TIED: readonly string[] = ["de", "nl", "ru"];

/**
 * Languages whose best measured engine brought back under 55% of a line's
 * content words: translations into and out of them are often wrong
 * whichever engine takes them, and the language pickers say so.
 */
export const LIMITED_LANGUAGES: readonly string[] = ["is", "lv", "et", "hi", "lt", "bn", "hu"];

export function isLimitedLanguage(code: string | null | undefined): boolean {
	return !!code && LIMITED_LANGUAGES.includes(code);
}

/** The entry for a pair without an OPUS-MT model; `"*"` stands for any language. */
function entryFor(from: string, to: string): RouteEntry {
	const sides = [from, to];

	if (sides.some((code) => NLLB_FIRST.includes(code))) {
		return ["nllb", "llm"];
	}

	if (sides.some((code) => NLLB_TIED.includes(code))) {
		return [["llm", "nllb"]];
	}

	return ["llm", "nllb"];
}

function opusEntry(pairKey: string): RouteEntry {
	const [from, to] = pairKey.split("-");
	const candidate: Candidate = `opus:${pairKey}`;

	if (OPUS_TIED.includes(from) || OPUS_TIED.includes(to)) {
		return [["llm", candidate], "nllb"];
	}

	return ["llm", candidate, "nllb"];
}

function buildDefault(): RouteTable {
	const placed = [...NLLB_FIRST, ...NLLB_TIED];
	const table: RouteTable = {"*": {"*": ["llm", "nllb"]}};

	// A placed language as the source, into a target with no row of its own.
	for (const from of placed) {
		table["*"][from] = entryFor(from, "*");
	}

	// A placed language as the target, from anything.
	for (const to of placed) {
		table[to] = {"*": entryFor("*", to)};
	}

	for (const pairKey of Object.keys(DEFAULT_OPUS_PAIRS)) {
		const [from, to] = pairKey.split("-");

		(table[to] ??= {})[from] = opusEntry(pairKey);
	}

	// Every target with a row gets a row for every placed source, so a
	// target's own wildcard never hides a weak source.
	for (const to of Object.keys(table)) {
		if (to === "*") {
			continue;
		}

		for (const from of placed) {
			if (from !== to && !table[to][from]) {
				table[to][from] = entryFor(from, to);
			}
		}
	}

	return table;
}

export const DEFAULT_ROUTES: RouteTable = buildDefault();
