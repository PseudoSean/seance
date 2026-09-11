// The one interface both translation engines implement (spec:
// docs/projects/client-translation.md § engine.ts). Streaming is the base
// contract: the LLM yields cumulative text as it decodes, a seq2seq engine
// yields once with `done: true`. Nothing here touches Vue, the store, the
// DOM or a library, so mocha loads it and test/translate/fakeEngine.ts can
// stand in for either engine.

export type EngineName = "llm" | "seq2seq";
export type ModelFamily = "llm" | "nllb" | "opus";
export type EngineStatus = "cold" | "loading" | "ready" | "failed";

export interface ModelRef {
	engine: EngineName;
	family: ModelFamily;
	/** The library's own id: a WebLLM `model_id` or a Hugging Face repo. */
	id: string;
	/** What Settings shows. */
	label: string;
	/** Approximate download size for Settings; 0 when unknown. */
	sizeBytes: number;
	/** OPUS-MT pair models: [from, to] in ISO 639-1. */
	pair?: [string, string];
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

/** What prompt.ts turns into the LLM's messages; seq2seq engines ignore it. */
export interface PromptContext {
	recent: ContextLine[];
	replyTo?: ContextLine;
	topic?: string;
	/** The channel's dominant language when the detector was unsure. */
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
	/** A batched request: numbered lines in, numbered lines out (LLM only). */
	lines?: string[];
	/** ISO 639-1 (639-3 codes are mapped by languages.ts); null = unknown. */
	from: string | null;
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
