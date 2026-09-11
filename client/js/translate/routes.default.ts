// The shipped route table. Provisional: plan 4's evaluation script rewrites
// it from measured chrF per pair per engine (spec § Testing and evaluation).
// Until then: the LLM first wherever it is allowed, an OPUS-MT pair model
// next where one exists, NLLB otherwise; the tail languages NLLB first.

import {Candidate, DEFAULT_OPUS_PAIRS} from "./models";
import {RouteTable} from "./router";

/** Languages a 1-2 GB LLM handles worse than NLLB in the literature. */
export const TAIL_LANGUAGES: readonly string[] = [
	"sw",
	"ta",
	"bn",
	"ur",
	"fa",
	"he",
	"ga",
	"cy",
	"is",
	"eu",
	"gl",
	"af",
	"tl",
	"et",
	"lv",
	"lt",
	"sl",
	"sk",
	"hr",
	"sr",
	"bg",
	"ms",
];

function buildDefault(): RouteTable {
	const table: RouteTable = {"*": {"*": ["llm", "nllb"]}};

	for (const tail of TAIL_LANGUAGES) {
		table[tail] = {"*": ["nllb", "llm"]};
	}

	for (const pairKey of Object.keys(DEFAULT_OPUS_PAIRS)) {
		const [from, to] = pairKey.split("-");
		const candidate: Candidate = `opus:${pairKey}`;
		const forTarget = (table[to] ??= {});
		forTarget[from] = TAIL_LANGUAGES.includes(from)
			? ["nllb", candidate, "llm"]
			: ["llm", candidate, "nllb"];
	}

	for (const tail of TAIL_LANGUAGES) {
		for (const to of Object.keys(table)) {
			if (to !== "*" && !table[to][tail]) {
				table[to][tail] = ["nllb", "llm"];
			}
		}
	}

	return table;
}

export const DEFAULT_ROUTES: RouteTable = buildDefault();
