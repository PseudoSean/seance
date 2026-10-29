// The router (spec § router.ts): a table keyed by target language, then
// source, each entry the candidates in **quality classes**, best class
// first. `resolveRoute` walks the classes in order and takes the first
// class with a candidate the device tier allows (an `llm` candidate is
// skipped, never failed, below the gpu tier), the user's engine settings
// allow, the catalog has a model for, and that is not marked down for the
// session. Inside that class a candidate whose model is already downloaded
// wins over the class's own order; a better class is never skipped for a
// downloaded model in a worse one: its model is downloaded on demand
// instead (service.ts), once the user has agreed to that download
// (consent.ts): a candidate the caller refuses to download (`refuse`) is
// passed over like any other block. NLLB-200 runs only once the user has
// switched it on (`allowNllb`; its licence is non-commercial), so the
// OPUS-MT pairs and the GPU model serve without it. A seq2seq candidate
// needs a source language: the request's `from`, or failing that its
// source hint.

import {Capability, Tier} from "./capability";
import {ModelRef} from "./engine";
import {Candidate, EngineSwitches, ModelBlock, ModelCatalog, modelBlock, refFor} from "./models";

/**
 * One table entry: its elements are quality classes, best first. A bare
 * candidate is a class of one, so a flat list (`["llm", "nllb"]`, the
 * shape every deploy override had) is a strict order, and a nested list
 * (`[["llm", "opus:de-en"], "nllb"]`) makes its candidates equivalent: the
 * downloaded one is preferred, the list's order breaks the tie.
 */
export type RouteEntry = (Candidate | Candidate[])[];

/** to → (from | "*") → classes; "*" → from and "*" → "*" behind a target's own rows. */
export type RouteTable = Record<string, Record<string, RouteEntry>>;

export interface RouteInput {
	from: string | null;
	/**
	 * The language the caller's detector placed the text in when the verdict
	 * was too weak to name as `from`: the reading queue's
	 * `QueueItem.routeHint` and the composer's `sourceHintFor`, which travel
	 * as `TranslateRequest.hint` -- routing only, never the prompt's
	 * `PromptContext.sourceHint`. It picks the table row when `from` is
	 * null, and lets a seq2seq candidate run with it as its source; the LLM
	 * request keeps `from: null`.
	 */
	hint: string | null;
	to: string;
	tier: Tier;
	allowLlm: boolean;
	allowCpu: boolean;
	/** NLLB-200 switched on (`translateNllb`): off, the `nllb` candidate is passed over. */
	allowNllb: boolean;
	down: ReadonlySet<Candidate>;
	/**
	 * Is this model already downloaded? Optional: without it every candidate
	 * counts as unknown and each class's order is the table's own.
	 */
	cached?: (ref: ModelRef) => boolean;
	/**
	 * A model this request must not download: the user said "not now" to an
	 * implicit download this session (service.ts `resolve`, consent.ts). Such
	 * a candidate is blocked as `download`, naming the model, and the walk
	 * goes on to one that needs no download. Absent, nothing is refused.
	 */
	refuse?: (ref: ModelRef) => boolean;
	/**
	 * Whether WebAssembly SIMD is there for the CPU models. A gpu-tier device
	 * can lack it (the tier only says the GPU is fine); absent means yes.
	 */
	wasm?: boolean;
	/**
	 * The source will be named before any request goes out: a question asked
	 * ahead of time ("could this pair run?") for a line whose language the
	 * detector has yet to place. A seq2seq candidate then counts with a null
	 * source, as the request it stands for will carry a hint.
	 */
	sourceLater?: boolean;
	/**
	 * The probe, for the explanation's words only (`explainRoute`): which
	 * device code, which buffer numbers. Routing reads `tier` and the flags.
	 */
	capability?: Capability | null;
}

export interface Route {
	candidate: Candidate;
	ref: ModelRef;
}

/**
 * Why no candidate can take a request: a model's own block (models.ts
 * `modelBlock`), the candidate marked down for the session after it failed,
 * a seq2seq model with no source to start from, or a pair the table and the
 * catalog have no model for at all.
 */
export type RouteBlock =
	| ModelBlock
	| {kind: "down"}
	| {kind: "source"}
	| {kind: "unserved"}
	/** The route's model is not on the device and its download was declined (consent.ts). */
	| {kind: "download"; ref: ModelRef};

/**
 * The router's answer with its reason: a route, or why there is none.
 * `polish` says the request was in one language (the cleanup pass), which
 * only the GPU model does.
 */
export type RouteVerdict =
	| {route: Route; why: null; polish: boolean}
	| {route: null; why: RouteBlock; polish: boolean};

/**
 * The input `resolveRoute` takes, from the probe and the user's switches:
 * the one place the tier, the flags and WebAssembly SIMD are read off a
 * `Capability`, for the service's requests and the UI's questions alike. A
 * capability still unknown routes nothing.
 */
export function routeInput(
	capability: Capability | null,
	switches: EngineSwitches,
	pair: {from: string | null; to: string; hint?: string | null; sourceLater?: boolean},
	down: ReadonlySet<Candidate> = new Set()
): RouteInput {
	return {
		from: pair.from,
		hint: pair.hint ?? null,
		to: pair.to,
		tier: capability?.tier ?? "none",
		allowLlm: switches.llm,
		allowCpu: switches.opus,
		allowNllb: switches.nllb,
		down,
		wasm: capability ? !capability.reasons.includes("NO_WASM_SIMD") : false,
		sourceLater: pair.sourceLater,
		capability,
	};
}

/** An entry's classes, each a non-empty list of candidates. */
export function classesOf(entry: RouteEntry): Candidate[][] {
	return entry
		.map((element) => (Array.isArray(element) ? [...element] : [element]))
		.filter((group) => group.length > 0);
}

/**
 * The classes for a pair: the target's row for the source, the target's
 * wildcard, the wildcard target's row for the source, then the global
 * wildcard.
 */
export function candidatesFor(table: RouteTable, from: string | null, to: string): Candidate[][] {
	const forTarget = table[to];
	const anyTarget = table["*"];
	const entry =
		(from ? forTarget?.[from] : undefined) ??
		forTarget?.["*"] ??
		(from ? anyTarget?.[from] : undefined) ??
		anyTarget?.["*"] ??
		[];

	return classesOf(entry);
}

/**
 * What keeps one candidate from taking the request, or null when it can.
 * The routing and the explanation are the same test: `resolveRoute` takes
 * the first candidate this passes, `explainRoute` reports what it said.
 */
function candidateBlock(
	candidate: Candidate,
	ref: ModelRef | null,
	input: RouteInput,
	source: string | null
): RouteBlock | null {
	if (!ref) {
		return {kind: "unserved"};
	}

	const switches = {llm: true, opus: true, nllb: true};

	if (candidate === "llm") {
		if (input.tier !== "gpu") {
			// The words: which code, or the buffer numbers. A caller that
			// passed no probe (tests, a bare tier) gets the generic one.
			return (
				(input.capability ? modelBlock(ref, input.capability, switches) : null) ?? {
					kind: "device",
					reason: "NO_WEBGPU",
				}
			);
		}

		// A phone's page cannot hold this model (models.ts `tooLargeForPhone`).
		// The service never routes it there — its selection resolves to a
		// model the device runs (`llmChoice`) — but a caller holding another
		// catalog (Settings' questions, a test) hears the same reason.
		const memory = input.capability ? modelBlock(ref, input.capability, switches) : null;

		if (memory?.kind === "memory") {
			return memory;
		}

		if (!input.allowLlm) {
			return {kind: "off", engine: "llm"};
		}
	} else {
		if (input.wasm === false) {
			return (
				(input.capability ? modelBlock(ref, input.capability, switches) : null) ?? {
					kind: "device",
					reason: "NO_WASM_SIMD",
				}
			);
		}

		if (!input.allowCpu) {
			return {kind: "off", engine: "seq2seq"};
		}

		if (candidate === "nllb" && !input.allowNllb) {
			return {kind: "off", engine: "nllb"};
		}

		if (source === null && !input.sourceLater) {
			return {kind: "source"};
		}
	}

	if (input.down.has(candidate)) {
		return {kind: "down"};
	}

	return input.refuse?.(ref) ? {kind: "download", ref} : null;
}

/**
 * Of the reasons each candidate gave, the one to tell the user: a switch
 * they turned off, when one would serve the pair (the fix is theirs to
 * make; both, when either would), then a download they declined (the
 * best class's model, which Settings can download), else the best class's
 * own reason, a pair the catalog has no model for last.
 */
function pickReason(blocks: RouteBlock[]): RouteBlock {
	const off = (engine: string) =>
		blocks.some((block) => block.kind === "off" && block.engine === engine);

	// Either switch would serve: both are named, as translationBlock does.
	if (off("llm") && off("seq2seq")) {
		return {kind: "off", engine: "all"};
	}

	// The GPU model or NLLB-200 would serve (English -> Japanese has no
	// OPUS-MT pair): naming the GPU switch alone hid the other way in.
	if (off("llm") && off("nllb")) {
		return {kind: "off", engine: "llmOrNllb"};
	}

	return (
		blocks.find((block) => block.kind === "off") ??
		blocks.find((block) => block.kind === "download") ??
		blocks.find((block) => block.kind !== "unserved") ??
		blocks[0] ?? {kind: "unserved"}
	);
}

/**
 * `resolveRoute` with its reason: the route, or why there is none (see
 * `RouteBlock`). Settings, the composer's dialog, the panel and the toolbar
 * ask this before they offer an action, so what they disable is exactly
 * what the router would refuse.
 */
export function explainRoute(
	table: RouteTable,
	catalog: ModelCatalog,
	input: RouteInput
): RouteVerdict {
	const source = input.from ?? input.hint;
	// A request in one language (purpose "polish": the composer's cleanup
	// pass) is prose work only a language model can do: the LLM where it
	// may run, else no route -- a seq2seq model asked to translate English
	// into English would mangle the line.
	const polish = source !== null && source === input.to;

	if (input.tier === "none") {
		const why =
			(input.capability
				? modelBlock(catalog.nllb, input.capability, {llm: true, opus: true, nllb: true})
				: null) ?? ({kind: "device", reason: "NO_WASM_SIMD"} as const);

		return {route: null, why, polish};
	}

	if (polish) {
		const ref = refFor(catalog, "llm");
		const why = candidateBlock("llm", ref, input, source);

		return why || !ref
			? {route: null, why: why ?? {kind: "unserved"}, polish}
			: {route: {candidate: "llm", ref}, why: null, polish};
	}

	const blocks: RouteBlock[] = [];

	for (const group of candidatesFor(table, source, input.to)) {
		let first: Route | null = null;

		for (const candidate of group) {
			const ref = refFor(catalog, candidate);
			const block = candidateBlock(candidate, ref, input, source);

			if (block || !ref) {
				blocks.push(block ?? {kind: "unserved"});
				continue;
			}

			// Preference inside the class only: an equivalent model already on
			// the device answers at once instead of waiting for a download.
			if (input.cached?.(ref)) {
				return {route: {candidate, ref}, why: null, polish};
			}

			first = first ?? {candidate, ref};
		}

		if (first) {
			return {route: first, why: null, polish};
		}
	}

	return {route: null, why: pickReason(blocks), polish};
}

export function resolveRoute(
	table: RouteTable,
	catalog: ModelCatalog,
	input: RouteInput
): Route | null {
	return explainRoute(table, catalog, input).route;
}

/**
 * Whether anything can translate here at all, and if not why: the GPU model
 * in use and the CPU models, each by `modelBlock`. Null once either runs.
 * The CPU models count with NLLB-200 switched off: the OPUS-MT pairs still
 * run on the CPU switch alone, so NLLB's opt-in never makes translation as
 * a whole unavailable (a pair only NLLB serves says so in `explainRoute`).
 * Of two blocks, a switch the user turned off is the one named (turning it
 * on is the fix; both off is `engine: "all"`), else the CPU models' (they
 * are the floor every device that translates at all can reach).
 */
export function translationBlock(
	catalog: ModelCatalog,
	capability: Capability | null,
	switches: EngineSwitches,
	enabled = true
): ModelBlock | null {
	const llm = modelBlock(catalog.llm, capability, switches, enabled);
	const cpu = modelBlock(catalog.nllb, capability, {...switches, nllb: true}, enabled);

	if (!llm || !cpu) {
		return null;
	}

	if (llm.kind === "off" && cpu.kind === "off") {
		return {kind: "off", engine: "all"};
	}

	return llm.kind === "off" ? llm : cpu;
}

/** A deploy's `translation.routes` over the shipped table, one entry at a time. */
export function mergeRoutes(base: RouteTable, override: RouteTable): RouteTable {
	const merged: RouteTable = {};

	for (const [to, sources] of Object.entries(base)) {
		merged[to] = {...sources};
	}

	for (const [to, sources] of Object.entries(override)) {
		merged[to] = {...(merged[to] ?? {}), ...sources};
	}

	return merged;
}
