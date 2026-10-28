// The model catalog (spec § router.ts, § Settings): which models exist, from
// the shipped defaults plus the deploy's `config.json` `translation` block,
// and the cache API the worker answers "is it downloaded" / "delete it"
// with. A router candidate names a catalog entry, never a URL.

import {ModelRef} from "./engine";
import type {Tier} from "./capability";

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
	/**
	 * The catalog's own fallback GPU model: the deploy's model, else the
	 * shipped 1.7B. What an unresolvable selection lands on when the device
	 * has not been probed (`llmChoice`).
	 */
	llmDefault: string;
	/**
	 * The deploy's `translation.llm.model`, when it named one. A deploy's
	 * model is a decision, so it outranks the device pick for a user who
	 * never chose (`llmChoice`); the shipped default is not.
	 */
	llmDeploy?: string;
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

// The downloads as Hugging Face lists them (2026-10-27): the MLC repo's
// files for the 1.7B; NLLB's and an OPUS pair's q8 encoder, merged decoder
// and tokenizer (a pair varies by a few MB).
const LLM_SIZE_BYTES = 984_000_000;
const NLLB_SIZE_BYTES = 912_000_000;
const OPUS_SIZE_BYTES = 113_000_000;

function opusRef(pairKey: string, id: string): ModelRef {
	const [from, to] = pairKey.split("-");

	return {
		engine: "seq2seq",
		family: "opus",
		id,
		label: {kind: "opus", from, to},
		sizeBytes: OPUS_SIZE_BYTES,
		pair: [from, to],
	};
}

/**
 * The GPU models Settings offers, both WebLLM prebuilt ids. `sizeBytes` is
 * the download; `vramBytes` is the graphics memory the model needs at
 * runtime (WebLLM's `vram_required_MB`, about 2.0 GB for 1.7B and 3.4 GB
 * for 4B); `largestBufferBytes` is the model's largest weight tensor, its
 * vocabulary embedding (`model.embed_tokens.q_weight`, 151936 rows of u32:
 * 256 per row for 1.7B, 320 for 4B, from each model's
 * tensor-cache.json) — the single binding the device must allow. The KV
 * cache's pages and the work buffers are smaller by estimate, not by
 * measurement.
 */
export const LLM_CHOICES: readonly ModelRef[] = [
	{
		engine: "llm",
		family: "llm",
		id: QWEN3_1_7B_ID,
		label: {kind: "llm", name: "Qwen3 1.7B"},
		sizeBytes: LLM_SIZE_BYTES,
		vramBytes: 2_000_000_000,
		largestBufferBytes: 155_574_272,
	},
	{
		engine: "llm",
		family: "llm",
		id: QWEN3_4B_ID,
		label: {kind: "llm", name: "Qwen3 4B"},
		sizeBytes: 2_280_000_000,
		vramBytes: 3_400_000_000,
		largestBufferBytes: 194_478_080,
	},
];

/** The smallest binding any GPU model needs: the gpu tier's floor (capability.ts). */
export const LLM_MIN_BUFFER_BYTES = Math.min(
	...LLM_CHOICES.map((ref) => ref.largestBufferBytes ?? Infinity)
);

/**
 * Whether `ref` can load on a device whose largest storage binding is
 * `maxBufferBytes` (the probe's `min(maxBufferSize,
 * maxStorageBufferBindingSize)`; the worker asks WebLLM's device for that
 * much, engines/gpuLimits.ts). Anything but a GPU model fits.
 */
export function llmFits(ref: ModelRef, maxBufferBytes: number): boolean {
	return ref.engine !== "llm" || (ref.largestBufferBytes ?? 0) <= maxBufferBytes;
}

/** What the default GPU model is decided from (capability.ts `Capability`). */
export interface AdapterMemory {
	maxBufferBytes: number;
	deviceMemoryGiB: number | null;
	/** A phone or tablet (capability.ts `browserEnv`): never the 4B by default. */
	mobile?: boolean;
	/**
	 * The probe's verdict, when it is known. Only a `gpu` device gets a GPU
	 * default: on a cpu-tier device the selected model still picks the route
	 * table (`service.ts` `buildTable`), whose non-LLM entries differ between
	 * the two models, so a device that can run neither must stay on the
	 * catalog's own default.
	 */
	tier?: Tier;
}

/** The device memory a 4B model asks for, in GiB. */
export const LARGE_LLM_MIN_MEMORY_GIB = 6;

/**
 * The default GPU model for this device: the most capable choice it can hold.
 * Only a model whose largest buffer the device can bind is a candidate
 * (`llmFits`). The 4B needs `navigator.deviceMemory` (`deviceMemoryGiB`) of
 * LARGE_LLM_MIN_MEMORY_GIB and a computer: Chrome reports 8 GiB on many
 * phones, where its 3.4 GB is most of the memory, and a browser without
 * `deviceMemory` (Safari, Firefox) says nothing about it — the adapter's
 * binding limit is per buffer, not the total. Falls back to the first choice
 * when nothing fits (the gpu tier's floor makes that the smallest model's
 * own need). It answers for a gpu-tier device; gating on the tier is the
 * caller's (`llmChoice`).
 */
export function defaultLlmForAdapter(memory: AdapterMemory | null | undefined): string {
	const fitting = LLM_CHOICES.filter((ref) => llmFits(ref, memory?.maxBufferBytes ?? 0));
	const large = fitting.find((ref) => ref.id === QWEN3_4B_ID);
	const wantsLarge =
		!!memory &&
		!memory.mobile &&
		typeof memory.deviceMemoryGiB === "number" &&
		memory.deviceMemoryGiB >= LARGE_LLM_MIN_MEMORY_GIB;

	return (wantsLarge && large ? large : fitting[0] ?? LLM_CHOICES[0]).id;
}

/** A GPU model's own product name, for the model select. */
export function llmName(ref: ModelRef): string {
	return ref.label.kind === "llm" ? ref.label.name : ref.id;
}

/** A deploy's own GPU model, neither of the shipped choices. */
function deployLlmRef(id: string, lib: string | undefined): ModelRef {
	const ref: ModelRef = {
		engine: "llm",
		family: "llm",
		id,
		label: {kind: "llm", name: id.replace(/-q4f16_1-MLC$/, "").replace(/-/g, " ")},
		sizeBytes: LLM_SIZE_BYTES,
	};

	if (lib) {
		ref.lib = lib;
	}

	return ref;
}

/**
 * The GPU model `selected` names among the choices; an id that is none of
 * them (a stored setting a later deploy no longer offers, an empty one — an
 * unset setting is no choice) is resolved here, at read time, and never
 * written back: the deploy's own model, else what `memory` fits, else the
 * catalog default. `memory` is the device probe (store `translationCapability`),
 * null while it is still running — the catalog default serves until it lands
 * and this answers anew once it has.
 */
export function llmChoice(
	catalog: ModelCatalog,
	selected: string | null | undefined,
	memory?: AdapterMemory | null
): ModelRef {
	// A probe that found no GPU names no GPU model (see AdapterMemory.tier).
	const device = memory && (memory.tier ?? "gpu") === "gpu" ? memory : null;
	const chosen = catalog.llmChoices.find((ref) => ref.id === selected);

	// A choice this GPU cannot bind (llmFits) runs the default instead, so
	// a gpu tier always means the model in use can load; Settings says why
	// the chosen row cannot be downloaded.
	if (chosen && (!device || llmFits(chosen, device.maxBufferBytes))) {
		return chosen;
	}

	const unset = catalog.llmDeploy ?? (device ? defaultLlmForAdapter(device) : undefined);

	return (
		catalog.llmChoices.find((ref) => ref.id === unset) ??
		catalog.llmChoices.find((ref) => ref.id === catalog.llmDefault) ??
		catalog.llm
	);
}

/** The catalog with `selected` (see `llmChoice`) as its GPU model. */
export function selectLlm(
	catalog: ModelCatalog,
	selected: string | null | undefined,
	memory?: AdapterMemory | null
): ModelCatalog {
	const llm = llmChoice(catalog, selected, memory);

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
			label: {kind: "nllb"},
			sizeBytes: NLLB_SIZE_BYTES,
		},
		opus,
	};

	if (options.llm?.model) {
		catalog.llmDeploy = options.llm.model;
	}

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
