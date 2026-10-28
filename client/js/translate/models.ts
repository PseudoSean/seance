// The model catalog (spec § router.ts, § Settings): which models exist, from
// the shipped defaults plus the deploy's `config.json` `translation` block,
// and the cache API the worker answers "is it downloaded" / "delete it"
// with. A router candidate names a catalog entry, never a URL.

import {EngineName, ModelRef, SmallBufferBuild} from "./engine";
import type {Capability, CapabilityReason, Tier} from "./capability";

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

/** The small-buffer build of the 1.7B: its own WebLLM id (engine.ts `SmallBufferBuild`). */
export const QWEN3_1_7B_SPLIT_ID = "Qwen3-1.7B-q4f16_1-MLC-split";

/**
 * The 1.7B's published directory at the commit its split was cut from (the
 * manifest there is byte-identical to `main` on 2026-10-28). Pinned, so the
 * byte ranges the rewrite names can never move, and so the build's cache
 * keys are never the model's own `resolve/main/` ones.
 */
export const QWEN3_1_7B_PINNED_MODEL =
	"https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/resolve/80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc/";

/**
 * The split library the app ships (client/models/, copied to public/models/
 * by webpack; built by tools/translate-split/). The file name carries the
 * first eight hex digits of its SHA-256: WebLLM caches a library by URL, so
 * a rebuilt library must have a new one. Relative to the app's root, which
 * the worker resolves against its own location (a deploy may live under a
 * subpath).
 */
export const QWEN3_1_7B_SPLIT_LIB = "models/qwen3-1.7b-q4f16_1-split-c4939e7d.wasm";

/** Qwen3's vocabulary, and the row its table is split at: two halves of 75968 rows. */
const QWEN3_VOCAB_ROWS = 151_936;
const QWEN3_SPLIT_ROW = 75_968;

/**
 * The GPU models Settings offers, both WebLLM prebuilt ids. `sizeBytes` is
 * the download; `vramBytes` is the graphics memory the model needs at
 * runtime (WebLLM's `vram_required_MB`, about 2.0 GB for 1.7B and 3.4 GB
 * for 4B); `largestBufferBytes` is the model's largest weight tensor, its
 * vocabulary embedding (`model.embed_tokens.q_weight`, 151936 rows of u32:
 * 256 per row for 1.7B, 320 for 4B, from each model's
 * tensor-cache.json: 155,582,464 and 194,478,080 bytes) — the single
 * binding the device must allow. The KV cache's pages and the work buffers
 * are smaller by estimate, not by measurement.
 *
 * The 1.7B also has a small-buffer build (`smallBuffer`): the table split
 * in two halves of 75968 rows, whose larger tensor is 75968 × 1024 bytes,
 * so it loads where a storage binding stops at WebGPU's 128 MiB floor. The
 * same weights, so the same download and the same graphics memory. The 4B
 * has none: its library was never built (its table is 186 MiB, two halves
 * of 93 MiB would fit too, but nothing has measured it on a phone).
 */
export const LLM_CHOICES: readonly ModelRef[] = [
	{
		engine: "llm",
		family: "llm",
		id: QWEN3_1_7B_ID,
		label: {kind: "llm", name: "Qwen3 1.7B"},
		sizeBytes: LLM_SIZE_BYTES,
		vramBytes: 2_000_000_000,
		largestBufferBytes: 155_582_464,
		smallBuffer: {
			id: QWEN3_1_7B_SPLIT_ID,
			model: QWEN3_1_7B_PINNED_MODEL,
			lib: QWEN3_1_7B_SPLIT_LIB,
			split: {
				rows: QWEN3_VOCAB_ROWS,
				at: QWEN3_SPLIT_ROW,
				weight: {cols: 256, dtype: "uint32"},
				scale: {cols: 64, dtype: "float16"},
			},
			largestBufferBytes: 77_791_232,
		},
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

/**
 * What the worker is told about the device (protocol.ts `configure`): the
 * probe's largest storage binding, which decides the build
 * (`smallBufferBuildFor`), and the test cap (translate/gpuTestLimit.ts),
 * which WebLLM's device request is held to (engines/gpuLimits.ts). Null
 * where nothing is known: the model's own build loads, uncapped.
 */
export interface GpuBudget {
	maxBufferBytes: number | null;
	capBytes: number | null;
	/**
	 * A phone or tablet (capability.ts `Capability.mobile`): the GPU model
	 * loads with `MOBILE_CONTEXT_WINDOW` (`contextWindowFor`). Absent on a
	 * computer, so the message a computer's worker is told is unchanged.
	 */
	mobile?: boolean;
}

/**
 * The context window a GPU model loads with on a phone or tablet, in tokens.
 * WebLLM sizes the KV cache for the whole window at load and WebKit counts
 * GPU memory against the page's own process (about 2.1 GB on an iPhone,
 * past which the page is killed), so the window is memory: measured on a
 * SwiftShader bench (the f32 build; the shipped f16 KV is half), the 1.7B
 * at load was 1,278 MiB at 1024, 1,502 at 2048 and 1,950 at 4096 — about
 * 1,050 / 1,160 / 1,390 MiB in f16. 2048 holds the worst single request
 * the reader builds (10 full-length context lines with their translations,
 * a 250-byte topic, 20 names, 20 terms, a full line and its 394-token reply:
 * at most 1,952 tokens, docs/resources/translation.md § Phones and small
 * GPUs); anything larger is trimmed to fit (budget.ts). 1024 saves another
 * ~110 MiB and cannot hold a full line with its context; the library's
 * prefill chunk is 1k.
 */
export const MOBILE_CONTEXT_WINDOW = 2048;

/**
 * The window a model loads with when nothing says otherwise: the Qwen3
 * records' own (`overrides.context_window_size` in WebLLM's prebuilt list).
 */
export const DEFAULT_CONTEXT_WINDOW = 4096;

/**
 * The context window to ask WebLLM for on this device: `MOBILE_CONTEXT_WINDOW`
 * on a phone or tablet, null elsewhere — the model's own record decides
 * (4096 for both Qwen3 models), and the reload is the one it always was.
 */
export function contextWindowFor(gpu: GpuBudget | null | undefined): number | null {
	return gpu?.mobile ? MOBILE_CONTEXT_WINDOW : null;
}

/**
 * The most graphics memory a GPU model may need and still run on a phone or
 * tablet. WebKit attributes GPU memory to the page's process and kills it
 * past about 2.1 GB, and the page itself, the weights' load buffers and the
 * other engine all live there too. The 1.7B (WebLLM's 2.0 GB figure is its
 * 4096-token window in f32; about 1.2 GiB at `MOBILE_CONTEXT_WINDOW` in f16)
 * is under it; the 4B, whose weights alone are 2.2 GB, never is.
 */
export const MOBILE_LLM_MAX_VRAM_BYTES = 2_500_000_000;

/** A GPU model too large for a phone's page (`MOBILE_LLM_MAX_VRAM_BYTES`); unknown sizes pass. */
export function tooLargeForPhone(ref: ModelRef): boolean {
	return ref.engine === "llm" && (ref.vramBytes ?? 0) > MOBILE_LLM_MAX_VRAM_BYTES;
}

/**
 * Which build of `ref` loads on a device whose largest storage binding is
 * `maxBufferBytes`: null for the model itself — it fits, it has no
 * small-buffer build, or the limit is unknown — and its small-buffer build
 * when only that fits. The one rule the engine's load, the worker's cache
 * answers (Downloaded / Delete) and Settings read, so a phone's Download
 * downloads the build it will run and a desktop's the model itself. A
 * device that can bind neither gets the model itself, which then fails as
 * `modelBlock` already said it would.
 */
export function smallBufferBuildFor(
	ref: ModelRef,
	maxBufferBytes: number | null | undefined
): SmallBufferBuild | null {
	const build = ref.engine === "llm" ? ref.smallBuffer : undefined;

	if (!build || typeof maxBufferBytes !== "number" || !(maxBufferBytes > 0)) {
		return null;
	}

	if ((ref.largestBufferBytes ?? 0) <= maxBufferBytes) {
		return null;
	}

	return build.largestBufferBytes <= maxBufferBytes ? build : null;
}

/** The WebLLM id that loads for `ref` on this device: its own, or its small-buffer build's. */
export function buildIdFor(ref: ModelRef, maxBufferBytes: number | null | undefined): string {
	return smallBufferBuildFor(ref, maxBufferBytes)?.id ?? ref.id;
}

/**
 * The smallest binding any build of `ref` needs: its small-buffer build's
 * when it has one. Undefined for a model of unknown size (a deploy's own).
 */
export function minBufferNeed(ref: ModelRef): number | undefined {
	const own = ref.largestBufferBytes;
	const small = ref.smallBuffer?.largestBufferBytes;

	if (own === undefined) {
		return small;
	}

	return small === undefined ? own : Math.min(own, small);
}

/**
 * The smallest binding any GPU model needs, by its smallest build: the gpu
 * tier's floor (capability.ts). The 1.7B's small-buffer build: 74 MiB.
 */
export const LLM_MIN_BUFFER_BYTES = Math.min(
	...LLM_CHOICES.map((ref) => minBufferNeed(ref) ?? Infinity)
);

/**
 * Whether `ref` can load on a device whose largest storage binding is
 * `maxBufferBytes` (the probe's `min(maxBufferSize,
 * maxStorageBufferBindingSize)`, and the test cap; the worker asks WebLLM's
 * device for that much, engines/gpuLimits.ts): the model itself fits, or
 * its small-buffer build does. Anything but a GPU model fits.
 */
export function llmFits(ref: ModelRef, maxBufferBytes: number): boolean {
	return ref.engine !== "llm" || (minBufferNeed(ref) ?? 0) <= maxBufferBytes;
}

/**
 * The device codes that keep a model from running: everything the probe can
 * report but SMALL_BUFFER, which is per model and becomes a `buffer` block
 * with that model's own numbers.
 */
export type DeviceReason = Exclude<CapabilityReason, "SMALL_BUFFER">;

/**
 * Why a model cannot run here, in the order a user can do something about
 * it last: the deploy switched translation off, the probe has not answered
 * yet, the device cannot (a capability code), the GPU binds too little for
 * this model (with both numbers), or the user switched its engine off in
 * Settings. A model the device cannot run is never reported as switched off:
 * turning the setting on would change nothing.
 */
export type ModelBlock =
	| {kind: "disabled"}
	| {kind: "probing"}
	| {kind: "device"; reason: DeviceReason}
	| {kind: "buffer"; needed: number; limit: number}
	/**
	 * A GPU model a phone or tablet cannot hold (`tooLargeForPhone`):
	 * `needed` is its graphics memory (`ModelRef.vramBytes`).
	 */
	| {kind: "memory"; needed: number}
	/**
	 * `all`: both engine switches (router.ts `translationBlock`; never one
	 * model's). `nllb`: NLLB-200 alone, which is off until the user opts in
	 * (its licence is non-commercial, CC-BY-NC-4.0).
	 */
	| {kind: "off"; engine: EngineName | "nllb" | "all"};

/**
 * The user's engine switches (`translateLlm`, `translateCpu`,
 * `translateNllb`; service.ts `ServiceSettings`). `nllb` is NLLB-200's own
 * opt-in under the CPU switch: the OPUS-MT pairs run with `cpu` alone.
 */
export interface EngineSwitches {
	llm: boolean;
	cpu: boolean;
	nllb: boolean;
}

/** The GPU codes, most fundamental first: the first one the probe lists is the one named. */
const GPU_REASONS: readonly DeviceReason[] = [
	"PROBE_FAILED",
	"INSECURE_ORIGIN",
	"NO_WEBGPU",
	"NO_ADAPTER",
	"NO_F16",
	"GPU_LIMITS",
];

/**
 * What keeps `ref` from running on this device, or null when it can. The
 * one rule Settings' model rows, the router's explanations (router.ts
 * `explainRoute`) and the disabled translation actions all read. `capability`
 * is the probe (store `translationCapability`), null while it runs; `enabled`
 * is the deploy's `translation.enabled`.
 */
export function modelBlock(
	ref: ModelRef,
	capability: Capability | null,
	switches: EngineSwitches,
	enabled = true
): ModelBlock | null {
	if (!enabled) {
		return {kind: "disabled"};
	}

	if (!capability) {
		return {kind: "probing"};
	}

	if (ref.engine === "llm") {
		const reason = GPU_REASONS.find((code) => capability.reasons.includes(code));

		if (reason) {
			return {kind: "device", reason};
		}

		// The gpu tier's floor is the smallest shipped model's need, so a
		// deploy model of unknown size on a device below it is held to that.
		// A model with a small-buffer build needs what that build needs.
		const needed = minBufferNeed(ref) ?? (capability.tier === "gpu" ? 0 : LLM_MIN_BUFFER_BYTES);

		if (capability.tier !== "gpu" || needed > capability.maxBufferBytes) {
			return {kind: "buffer", needed, limit: capability.maxBufferBytes};
		}

		// Whatever the GPU binds, a phone's page cannot hold the 4B: the
		// switch would change nothing, so this comes before it.
		if (capability.mobile && tooLargeForPhone(ref)) {
			return {kind: "memory", needed: ref.vramBytes ?? 0};
		}

		return switches.llm ? null : {kind: "off", engine: "llm"};
	}

	if (capability.reasons.includes("PROBE_FAILED")) {
		return {kind: "device", reason: "PROBE_FAILED"};
	}

	if (capability.tier === "none" || capability.reasons.includes("NO_WASM_SIMD")) {
		return {kind: "device", reason: "NO_WASM_SIMD"};
	}

	if (!switches.cpu) {
		return {kind: "off", engine: "seq2seq"};
	}

	return ref.family === "nllb" && !switches.nllb ? {kind: "off", engine: "nllb"} : null;
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

/**
 * Whether `ref` can run on the device `memory` describes: its smallest
 * build binds (`llmFits`) and, on a phone or tablet, it is not too large
 * for the page (`tooLargeForPhone`) — the GPU half of `modelBlock`, for the
 * callers that hold an `AdapterMemory` rather than a whole capability.
 */
export function llmRunsOn(
	ref: ModelRef,
	memory: Pick<AdapterMemory, "maxBufferBytes" | "mobile">
): boolean {
	return llmFits(ref, memory.maxBufferBytes) && !(memory.mobile && tooLargeForPhone(ref));
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
	const fitting = LLM_CHOICES.filter((ref) =>
		llmRunsOn(ref, {maxBufferBytes: memory?.maxBufferBytes ?? 0, mobile: memory?.mobile})
	);
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

	// A choice this GPU cannot bind (llmFits), or a phone cannot hold
	// (tooLargeForPhone), runs the default instead, so a gpu tier always
	// means the model in use can load; Settings says why the chosen row
	// cannot be downloaded. The deploy's own model is held to the same rule.
	const runs = (ref: ModelRef | undefined): ref is ModelRef =>
		!!ref && (!device || llmRunsOn(ref, device));

	if (runs(chosen)) {
		return chosen;
	}

	const deployed = catalog.llmChoices.find((ref) => ref.id === catalog.llmDeploy);

	if (runs(deployed)) {
		return deployed;
	}

	const unset = device ? defaultLlmForAdapter(device) : undefined;
	const fallback =
		catalog.llmChoices.find((ref) => ref.id === unset) ??
		catalog.llmChoices.find((ref) => ref.id === catalog.llmDefault);

	return runs(fallback)
		? fallback
		: catalog.llmChoices.find((ref) => runs(ref)) ?? fallback ?? catalog.llm;
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
	//
	// The small-buffer build reads the published weights from Hugging Face
	// at a pinned commit through the app's own library: a deploy that
	// mirrors the weights (`modelBase`, which keeps its readers off
	// third-party hosts) or names its own library for the model has neither,
	// so there the model has no such build and a small GPU cannot run it.
	const llmChoices = LLM_CHOICES.map((ref): ModelRef => {
		const choice: ModelRef = ref.id === llmId && lib ? {...ref, lib} : {...ref};

		if (choice.smallBuffer && (options.modelBase || choice.lib)) {
			delete choice.smallBuffer;
		}

		return choice;
	});

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
