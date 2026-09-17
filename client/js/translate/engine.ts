// The one interface both translation engines implement (spec:
// docs/projects/client-translation.md § engine.ts). Streaming is the base
// contract: the LLM yields cumulative text as it decodes, a seq2seq engine
// yields once with `done: true`. Nothing here touches Vue, the store, the
// DOM or a library, so mocha loads it and test/translate/fakeEngine.ts can
// stand in for either engine.

import type {MarkerForm} from "./spans";

export type EngineName = "llm" | "seq2seq";
export type ModelFamily = "llm" | "nllb" | "opus";
export type EngineStatus = "cold" | "loading" | "ready" | "failed";

/**
 * How a model is named in the interface, as a code plus the values the
 * phrase needs: an OPUS-MT pair names its two languages, NLLB names
 * itself, a GPU model carries its own product name.
 */
export type ModelLabel =
	| {kind: "opus"; from: string; to: string}
	| {kind: "nllb"}
	| {kind: "llm"; name: string};

export interface ModelRef {
	engine: EngineName;
	family: ModelFamily;
	/** The library's own id: a WebLLM `model_id` or a Hugging Face repo. */
	id: string;
	/**
	 * What Settings shows, as data: this module is Vue-free and never
	 * imports the i18n runtime, so the catalog entry names its kind and
	 * the component renders it (helpers/modelLabel.ts).
	 */
	label: ModelLabel;
	/** Approximate download size for Settings; 0 when unknown. */
	sizeBytes: number;
	/**
	 * The graphics memory the model needs at runtime (GPU models only):
	 * what the capability probe's adapter limit is checked against when
	 * the default model is picked (models.ts `defaultLlmForAdapter`).
	 */
	vramBytes?: number;
	/** OPUS-MT pair models: [from, to] in ISO 639-1. */
	pair?: [string, string];
	/**
	 * A GPU model's compiled WebLLM library, when the deploy named one
	 * (`translation.llm.lib`): it belongs to that model alone, never to the
	 * other GPU choices.
	 */
	lib?: string;
}

export interface LoadProgress {
	/** 0..1 of the whole download. */
	fraction: number;
	text?: string;
}

export interface ContextLine {
	nick: string;
	text: string;
	translated?: string;
}

/** One batched line's own context (`TranslateRequest.lineContexts`). */
export interface LineContext {
	replyTo?: ContextLine;
}

/** What prompt.ts turns into the LLM's messages; seq2seq engines ignore it. */
export interface PromptContext {
	recent: ContextLine[];
	replyTo?: ContextLine;
	topic?: string;
	/**
	 * The channel's dominant language when the detector was unsure: the LLM
	 * is told it as a guess. Absent `TranslateRequest.hint`, a seq2seq route
	 * also takes it as the source (router.ts, service.ts).
	 */
	sourceHint?: string;
	names: string[];
	terms: [string, string][];
	/** The user's own recent lines in the target language (`purpose: "write"`). */
	voice: string[];
	formality: "auto" | "formal" | "casual";
	variant?: string;
}

export function emptyContext(): PromptContext {
	return {recent: [], names: [], terms: [], voice: [], formality: "auto"};
}

export interface TranslateRequest {
	/** Request id, for cancellation and for matching chunks. */
	id: number;
	/** `ModelRef.id` the router chose. */
	model: string;
	/** After span protection: placeholders are already in place. */
	text: string;
	/**
	 * The form `text`'s marker pairs are in (spans.ts `renderMarkers`), so
	 * the prompt can say what to keep. Absent means `placeholder`; the
	 * seq2seq engines ignore it, having no prompt to say it in.
	 */
	markers?: MarkerForm;
	/** A batched request: numbered lines in, numbered lines out (LLM only). */
	lines?: string[];
	/**
	 * A batched request's per-line context, one entry per `lines` entry: a
	 * batch is several people's lines, and each of them replies to whatever
	 * it replies to. The prompt writes each note against its own line number
	 * (prompt.ts `userPrompt`); without this the head's reply target stood
	 * above the whole block. Everything else -- the earlier lines, the
	 * topic, the names, the terms -- is the channel's and stays in
	 * `context`, which is the batch head's.
	 */
	lineContexts?: LineContext[];
	/** ISO 639-1 (639-3 codes are mapped by languages.ts); null = unknown. */
	from: string | null;
	/**
	 * The language the text is probably in when `from` is null, for routing
	 * only: it picks the table row and is a seq2seq request's source
	 * (service.ts), and never reaches a prompt. The composer's weak detector
	 * verdict travels here, since telling the LLM a guess the code judged
	 * too weak to trust is measured to cost it (prompt.ts). Absent, the
	 * router falls back to `context.sourceHint`.
	 */
	hint?: string | null;
	to: string;
	purpose: "read" | "write";
	context: PromptContext;
}

export interface TranslateChunk {
	id: number;
	/** Cumulative for a streaming engine, the whole result for seq2seq. */
	text: string;
	done: boolean;
}

export interface EngineCapabilities {
	streams: boolean;
	batches: boolean;
	/** seq2seq only: multi-threaded WASM is available. */
	threads?: boolean;
}

export interface Engine {
	readonly name: EngineName;
	load(ref: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void>;
	unload(): Promise<void>;
	status(): EngineStatus;
	loadedModels(): string[];
	isLoaded(id: string): boolean;
	capabilities(): EngineCapabilities;
	translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk>;
}

/**
 * An engine's own failure classification. `load`: the model is gone or
 * cannot be used (a lost WebGPU device, twice); the service marks the
 * candidate down. `request`: this request failed (a bad pair, an
 * unsupported shape); the next request may succeed.
 */
export class EngineError extends Error {
	readonly cause: "load" | "request";

	constructor(message: string, cause: "load" | "request") {
		super(message);
		this.name = "EngineError";
		this.cause = cause;
	}
}
