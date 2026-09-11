// The model catalog (spec § router.ts, § Settings): which models exist, from
// the shipped defaults plus the deploy's `config.json` `translation` block,
// and the cache API the worker answers "is it downloaded" / "delete it"
// with. A router candidate names a catalog entry, never a URL.

import {ModelRef} from "./engine";
import {languageName} from "./languages";

/** What the route table lists: the LLM, NLLB, or an OPUS-MT pair. */
export type Candidate = "llm" | "nllb" | `opus:${string}`;

/** The shape `BrandingTranslation` (branding.ts) is assignable to. */
export interface CatalogOptions {
	modelBase?: string;
	llm?: {model?: string; lib?: string};
	cpu?: {nllb?: string; opus?: Record<string, string>};
}

export interface ModelCatalog {
	llm: ModelRef;
	/** WebLLM's compiled model library for a non-prebuilt or mirrored LLM. */
	llmLib?: string;
	nllb: ModelRef;
	/** Keyed "from-to". */
	opus: Record<string, ModelRef>;
	/** Mirror base URL without a trailing slash; undefined = Hugging Face. */
	modelBase?: string;
}

export const DEFAULT_LLM_ID = "Qwen3-1.7B-q4f16_1-MLC";
export const DEFAULT_NLLB_ID = "Xenova/nllb-200-distilled-600M";
export const DEFAULT_OPUS_PAIRS: Record<string, string> = {
	"de-en": "Xenova/opus-mt-de-en",
	"en-de": "Xenova/opus-mt-en-de",
	"fr-en": "Xenova/opus-mt-fr-en",
	"en-fr": "Xenova/opus-mt-en-fr",
	"es-en": "Xenova/opus-mt-es-en",
	"en-es": "Xenova/opus-mt-en-es",
	"it-en": "Xenova/opus-mt-it-en",
	"en-it": "Xenova/opus-mt-en-it",
	"nl-en": "Xenova/opus-mt-nl-en",
	"en-nl": "Xenova/opus-mt-en-nl",
	"ru-en": "Xenova/opus-mt-ru-en",
	"en-ru": "Xenova/opus-mt-en-ru",
};

const LLM_SIZE_BYTES = 1_100_000_000;
const NLLB_SIZE_BYTES = 620_000_000;
const OPUS_SIZE_BYTES = 75_000_000;

function opusRef(pairKey: string, id: string): ModelRef {
	const [from, to] = pairKey.split("-");

	return {
		engine: "seq2seq",
		family: "opus",
		id,
		label: `OPUS-MT ${languageName(from)} → ${languageName(to)} (CPU)`,
		sizeBytes: OPUS_SIZE_BYTES,
		pair: [from, to],
	};
}

export function buildCatalog(options: CatalogOptions = {}): ModelCatalog {
	const llmId = options.llm?.model ?? DEFAULT_LLM_ID;
	const nllbId = options.cpu?.nllb ?? DEFAULT_NLLB_ID;
	const pairs = {...DEFAULT_OPUS_PAIRS, ...(options.cpu?.opus ?? {})};
	const opus: Record<string, ModelRef> = {};

	for (const [pairKey, id] of Object.entries(pairs)) {
		if (/^[a-z]{2,3}-[a-z]{2,3}$/.test(pairKey)) {
			opus[pairKey] = opusRef(pairKey, id);
		}
	}

	const catalog: ModelCatalog = {
		llm: {
			engine: "llm",
			family: "llm",
			id: llmId,
			label: `${llmId.replace(/-q4f16_1-MLC$/, "").replace(/-/g, " ")} (GPU, all languages)`,
			sizeBytes: LLM_SIZE_BYTES,
		},
		nllb: {
			engine: "seq2seq",
			family: "nllb",
			id: nllbId,
			label: "NLLB-200 600M (CPU, 200 languages)",
			sizeBytes: NLLB_SIZE_BYTES,
		},
		opus,
	};

	if (options.llm?.lib) {
		catalog.llmLib = options.llm.lib;
	}

	if (options.modelBase) {
		catalog.modelBase = options.modelBase.replace(/\/+$/, "");
	}

	return catalog;
}

export function catalogModels(catalog: ModelCatalog): ModelRef[] {
	return [catalog.llm, catalog.nllb, ...Object.values(catalog.opus)];
}

export function refFor(catalog: ModelCatalog, candidate: Candidate): ModelRef | null {
	if (candidate === "llm") {
		return catalog.llm;
	}

	if (candidate === "nllb") {
		return catalog.nllb;
	}

	return catalog.opus[candidate.slice("opus:".length)] ?? null;
}

/** The other direction: which route candidate a model answers for. */
export function candidateOf(ref: ModelRef): Candidate {
	if (ref.family === "llm") {
		return "llm";
	}

	if (ref.family === "nllb") {
		return "nllb";
	}

	const [from, to] = ref.pair ?? ["", ""];

	return `opus:${from}-${to}`;
}

/** Answered by the worker, where Cache Storage and the libraries' cache helpers live. */
export interface CacheApi {
	has(ref: ModelRef): Promise<boolean>;
	delete(ref: ModelRef): Promise<void>;
}

export interface ModelCacheState {
	ref: ModelRef;
	cached: boolean;
}

// One entry that cannot answer is that entry's problem — it counts as not
// downloaded and Settings still lists every other model (an LLM id the
// library does not know throws in `webllm.real.ts`'s `has`). A cache api
// that throws synchronously is the whole of Cache Storage being unusable,
// and that still rejects: Settings says so instead of offering every model
// as a fresh download.
export async function cacheStates(
	catalog: ModelCatalog,
	api: CacheApi
): Promise<ModelCacheState[]> {
	return Promise.all(
		catalogModels(catalog).map(async (ref) => ({
			ref,
			cached: await api.has(ref).catch(() => false),
		}))
	);
}
