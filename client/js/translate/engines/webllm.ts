// The GPU tier (spec § engines/webllm.ts): WebLLM's MLCEngine behind the
// Engine interface. One model at a time. Generation is greedy at a low
// temperature, thinking off, a token budget from the input length, a stop
// at the first newline (a translation is one line) or at the batch
// sentinel. The library arrives through `WebLlmDeps` so this file never
// imports it; webllm.real.ts does.

import {
	Engine,
	EngineCapabilities,
	EngineError,
	EngineStatus,
	LoadProgress,
	ModelRef,
	TranslateChunk,
	TranslateRequest,
} from "../engine";
import {ModelCatalog} from "../models";
import {ChatMessage, END_SENTINEL, buildMessages, estimateTokens, stripSentinel} from "../prompt";

export interface ChatRequest {
	messages: ChatMessage[];
	stream: true;
	temperature: number;
	max_tokens: number;
	stop?: string[];
	extra_body?: {enable_thinking?: boolean};
}

export interface ChatDelta {
	choices: {delta: {content?: string | null}}[];
}

/** The slice of MLCEngine the engine uses. */
export interface MlcLike {
	reload(modelId: string): Promise<void>;
	unload(): Promise<void>;
	interruptGenerate(): void;
	chat: {completions: {create(request: ChatRequest): Promise<AsyncIterable<ChatDelta>>}};
}

/** WebLLM's `ModelRecord`, the fields that matter here. */
export interface ModelRecord {
	model_id: string;
	model: string;
	model_lib: string;
	vram_required_MB?: number;
	low_resource_required?: boolean;
}

export interface WebLlmDeps {
	create(
		appConfig: {model_list: ModelRecord[]},
		onProgress: (report: {progress: number; text: string}) => void
	): MlcLike;
	prebuilt: ModelRecord[];
}

const HF_MLC = "https://huggingface.co/mlc-ai/";

export function appConfigFor(
	ref: ModelRef,
	prebuilt: ModelRecord[],
	mirror: {modelBase?: string; lib?: string}
): {model_list: ModelRecord[]} {
	const known = prebuilt.find((record) => record.model_id === ref.id);
	const lib = mirror.lib ?? known?.model_lib;

	if (!lib) {
		throw new Error(`unknown WebLLM model ${ref.id}: set translation.llm.lib`);
	}

	if (known && !mirror.modelBase && !mirror.lib) {
		return {model_list: [known]};
	}

	const model = mirror.modelBase
		? `${mirror.modelBase}/${ref.id}/`
		: known?.model ?? `${HF_MLC}${ref.id}/resolve/main/`;

	return {model_list: [{model_id: ref.id, model, model_lib: lib}]};
}

export function maxTokensFor(req: TranslateRequest): number {
	const input = req.lines ? req.lines.join("\n") : req.text;

	return Math.min(512, 2 * estimateTokens(input) + 32);
}

export class WebLlmEngine implements Engine {
	readonly name = "llm" as const;
	private engine: MlcLike | null = null;
	private model: string | null = null;
	/** In-flight `load()` calls, deduped by model id (as in seq2seq.ts). */
	private loading = new Map<string, Promise<void>>();
	private state: EngineStatus = "cold";
	private catalog: ModelCatalog | null = null;
	private deps: WebLlmDeps;
	private languageName: (code: string) => string;
	private failures = 0;
	private failuresModel: string | null = null;
	/**
	 * The id of the request whose generation is running. WebLLM serialises
	 * generations per model behind its own lock, so a second request sits in
	 * `create()` until the first is done — but `interruptGenerate()` is
	 * engine-global and would end whatever is generating. Only the request
	 * that owns the generation may interrupt it; a queued one just drops out.
	 */
	private generating: number | null = null;

	constructor(deps: WebLlmDeps, languageName: (code: string) => string) {
		this.deps = deps;
		this.languageName = languageName;
	}

	/** Consecutive generation failures; a completed generation resets it. */
	get generationFailures(): number {
		return this.failures;
	}

	configure(catalog: ModelCatalog): void {
		this.catalog = catalog;
	}

	// Two callers can ask for the same model at once — Settings downloading it
	// while a translation waits for it — and a reload takes minutes: the second
	// caller waits on the first instead of unloading the engine the first one is
	// still reloading.
	async load(ref: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void> {
		const inFlight = this.loading.get(ref.id);

		if (inFlight) {
			await inFlight;
			return;
		}

		const promise = this.loadOnce(ref, onProgress);

		this.loading.set(ref.id, promise);

		try {
			await promise;
		} finally {
			this.loading.delete(ref.id);
		}
	}

	private async loadOnce(ref: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void> {
		this.state = "loading";

		try {
			const appConfig = appConfigFor(ref, this.deps.prebuilt, {
				modelBase: this.catalog?.modelBase,
				lib: this.catalog?.llmLib,
			});
			// Let go of the old engine before awaiting its unload, not after: a
			// translate() landing in between must report "model not loaded"
			// rather than generate on an engine that is being torn down.
			const previous = this.engine;

			this.engine = null;
			this.model = null;

			if (previous) {
				await previous.unload();
			}

			this.engine = this.deps.create(appConfig, (report) =>
				onProgress({fraction: report.progress, text: report.text})
			);
			await this.engine.reload(ref.id);
			this.model = ref.id;
			this.state = "ready";

			if (this.failuresModel !== ref.id) {
				this.failures = 0;
				this.failuresModel = ref.id;
			}
		} catch (e) {
			const created = this.engine;

			this.engine = null;
			this.model = null;
			this.state = "failed";

			if (created) {
				await created.unload().catch(() => {});
			}

			throw e;
		}
	}

	async unload(): Promise<void> {
		await this.engine?.unload();
		this.engine = null;
		this.model = null;
		this.state = "cold";
	}

	status(): EngineStatus {
		return this.state;
	}

	loadedModels(): string[] {
		return this.model ? [this.model] : [];
	}

	isLoaded(id: string): boolean {
		return this.model === id;
	}

	capabilities(): EngineCapabilities {
		return {streams: true, batches: true};
	}

	async *translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk> {
		const engine = this.engine;

		if (!engine || this.model !== req.model) {
			throw new Error(`model not loaded: ${req.model}`);
		}

		const onAbort = () => {
			if (this.generating === req.id) {
				engine.interruptGenerate();
			}
		};

		signal.addEventListener("abort", onAbort);

		try {
			const stream = await engine.chat.completions.create({
				messages: buildMessages(req, this.languageName),
				stream: true,
				temperature: 0.1,
				max_tokens: maxTokensFor(req),
				stop: req.lines ? [`\n${END_SENTINEL}`] : ["\n"],
				extra_body: {enable_thinking: false},
			});

			// The lock is ours from here, so an abort from now on is ours to
			// act on — the loop's drain is what ends a generation nobody
			// wants any more, whether the abort came before it or during it.
			this.generating = req.id;

			let text = "";

			for await (const delta of stream) {
				if (signal.aborted) {
					// Drain, never return: WebLLM releases its per-model lock only
					// when its generator finishes, and resets its interrupt flag
					// when a generation starts, so ask again on every chunk until
					// it stops. Nothing is yielded after an abort.
					engine.interruptGenerate();
					continue;
				}

				const piece = delta.choices[0]?.delta?.content ?? "";

				if (piece === "") {
					continue;
				}

				text += piece;
				yield {id: req.id, text, done: false};
			}

			// A drained (aborted) generation proves nothing about the model:
			// only a completed one clears the failure count.
			if (!signal.aborted) {
				this.failures = 0;
				yield {id: req.id, text: stripSentinel(text), done: true};
			}
		} catch (e) {
			if (signal.aborted) {
				return;
			}

			// A generation that threw is a device that may be gone (spec
			// § Lifecycle): drop the engine so the next request reloads it;
			// the second failure in a row is the model's failure, not the
			// request's, and the service takes the candidate down.
			this.failures++;
			this.engine = null;
			this.model = null;
			this.state = "failed";
			await engine.unload().catch(() => {});
			throw new EngineError(
				e instanceof Error ? e.message : String(e),
				this.failures >= 2 ? "load" : "request"
			);
		} finally {
			if (this.generating === req.id) {
				this.generating = null;
			}

			signal.removeEventListener("abort", onAbort);
		}
	}
}
