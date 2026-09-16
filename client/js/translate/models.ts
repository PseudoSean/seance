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
	/** The selected GPU model: what a route's `llm` candidate runs. */
	llm: ModelRef;
	/**
	 * Every GPU model the user can choose: the shipped ones, then the
	 * deploy's own model when it is neither. Settings lists them all, so
	 * either can be downloaded or deleted whichever is selected.
	 */
	llmChoices: ModelRef[];
	/** The id selected while the user has chosen none: the deploy's model, else 1.7B. */
	llmDefault: string;
	/**
	 * The deploy's `translation.llm.lib`, as given. The engines read it off
	 * the model's own ref (`ModelRef.lib`), which only the deploy's model
	 * (or the default it mirrors) carries.
	 */
	llmLib?: string;
	nllb: ModelRef;
	/** Keyed "from-to". */
	opus: Record<string, ModelRef>;
	/** Mirror base URL without a trailing slash; undefined = Hugging Face. */
	modelBase?: string;
}

export const QWEN3_1_7B_ID = "Qwen3-1.7B-q4f16_1-MLC";
export const QWEN3_4B_ID = "Qwen3-4B-q4f16_1-MLC";
export const DEFAULT_LLM_ID = QWEN3_1_7B_ID;
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

const LLM_LABEL_SUFFIX = " (GPU, all languages)";

/**
 * The GPU models Settings offers, both WebLLM prebuilt ids. `sizeBytes` is
 * the download; `vramBytes` is the graphics memory the model needs at
 * runtime (WebLLM's `vram_required_MB`, about 2.0 GB for 1.7B and 3.4 GB
 * for 4B) — what the capability probe's adapter limit is checked against
 * when the default is picked.
 */
export const LLM_CHOICES: readonly ModelRef[] = [
	{
		engine: "llm",
		family: "llm",
		id: QWEN3_1_7B_ID,
		label: `Qwen3 1.7B${LLM_LABEL_SUFFIX}`,
		sizeBytes: LLM_SIZE_BYTES,
		vramBytes: 2_000_000_000,
	},
	{
		engine: "llm",
		family: "llm",
		id: QWEN3_4B_ID,
		label: `Qwen3 4B${LLM_LABEL_SUFFIX}`,
		sizeBytes: 2_300_000_000,
		vramBytes: 3_400_000_000,
	},
];

/**
 * The default GPU model for an adapter with `maxBufferBytes` addressable:
 * the most capable choice whose memory requirement fits. The gpu tier's
 * own 1 GiB gate guarantees the last choice (1.7B) always fits, so this
 * never returns nothing for a gpu-tier device.
 */
export function defaultLlmForAdapter(maxBufferBytes: number): string {
	for (const ref of [...LLM_CHOICES].reverse()) {
		if ((ref.vramBytes ?? 0) <= maxBufferBytes) {
			return ref.id;
		}
	}

	return LLM_CHOICES[0].id;
}

/** A GPU model's name without its "(GPU, all languages)" note, for the model select. */
export function llmName(ref: ModelRef): string {
	return ref.label.endsWith(LLM_LABEL_SUFFIX)
		? ref.label.slice(0, -LLM_LABEL_SUFFIX.length)
		: ref.label;
}

/** A deploy's own GPU model, neither of the shipped choices. */
function deployLlmRef(id: string, lib: string | undefined): ModelRef {
	const ref: ModelRef = {
		engine: "llm",
		family: "llm",
		id,
		label: `${id.replace(/-q4f16_1-MLC$/, "").replace(/-/g, " ")}${LLM_LABEL_SUFFIX}`,
		sizeBytes: LLM_SIZE_BYTES,
	};

	if (lib) {
		ref.lib = lib;
	}

	return ref;
}

/**
 * The GPU model `selected` names among the choices; an id that is none of
 * them (a stored setting a later deploy no longer offers, an empty one)
 * gets the default.
 */
export function llmChoice(catalog: ModelCatalog, selected: string | null | undefined): ModelRef {
	return (
		catalog.llmChoices.find((ref) => ref.id === selected) ??
		catalog.llmChoices.find((ref) => ref.id === catalog.llmDefault) ??
		catalog.llm
	);
}

/** The catalog with `selected` (see `llmChoice`) as its GPU model. */
export function selectLlm(
	catalog: ModelCatalog,
	selected: string | null | undefined
): ModelCatalog {
	const llm = llmChoice(catalog, selected);

	return llm === catalog.llm ? catalog : {...catalog, llm};
}

export function buildCatalog(
	options: CatalogOptions = {},
	selectedLlm: string | null = null
): ModelCatalog {
	const llmId = options.llm?.model ?? DEFAULT_LLM_ID;
	const lib = options.llm?.lib;
	// A deploy's library belongs to the deploy's model (or to the shipped
	// default it mirrors), never to the other choice: a 4B load handed the
	// 1.7B wasm fails.
	const llmChoices = LLM_CHOICES.map(
		(ref): ModelRef => (ref.id === llmId && lib ? {...ref, lib} : {...ref})
	);

	if (!llmChoices.some((ref) => ref.id === llmId)) {
		llmChoices.push(deployLlmRef(llmId, lib));
	}

	const nllbId = options.cpu?.nllb ?? DEFAULT_NLLB_ID;
	const pairs = {...DEFAULT_OPUS_PAIRS, ...(options.cpu?.opus ?? {})};
	const opus: Record<string, ModelRef> = {};

	for (const [pairKey, id] of Object.entries(pairs)) {
		if (/^[a-z]{2,3}-[a-z]{2,3}$/.test(pairKey)) {
			opus[pairKey] = opusRef(pairKey, id);
		}
	}

	const catalog: ModelCatalog = {
		llm: llmChoices.find((ref) => ref.id === llmId) as ModelRef,
		llmChoices,
		llmDefault: llmId,
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

	return selectLlm(catalog, selectedLlm);
}

/** Every model Settings lists: all the GPU choices, NLLB, then the OPUS-MT pairs. */
export function catalogModels(catalog: ModelCatalog): ModelRef[] {
	return [...catalog.llmChoices, catalog.nllb, ...Object.values(catalog.opus)];
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
