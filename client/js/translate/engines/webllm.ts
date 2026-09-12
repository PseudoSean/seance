// The GPU tier (spec § engines/webllm.ts): WebLLM's MLCEngine behind the
// Engine interface. One model at a time. Generation is greedy at a low
// temperature, thinking off, a token budget from the input length, and a
// stop at the batch sentinel — a single-line request cuts itself instead,
// because with thinking off WebLLM prepends an empty `<think></think>`
// block to the reply that a "\n" stop matched inside. The cut takes the
// first line that is not the source echoed back: a small model asked to
// translate often repeats the text (or opens a `"""` fence around it)
// before it gets to the translation. The library arrives through
// `WebLlmDeps` so this file never imports it; webllm.real.ts does.

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
import {
	ChatMessage,
	END_SENTINEL,
	buildMessages,
	cleanOutput,
	estimateTokens,
	stripSentinel,
} from "../prompt";

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

	// + 16: the empty thinking block WebLLM prepends when thinking is off.
	return Math.min(512, 2 * estimateTokens(input) + 32 + 16);
}

/** The empty thinking block, and the opener on its own while the rest streams in. */
const THINK_BLOCK = /^\s*<think>[\s\S]*?<\/think>\s*/;
const THINK_OPEN = /^\s*<think>/;

/**
 * What of the raw reply is the translation. With `enable_thinking: false`
 * WebLLM does not ask the model not to think: it encodes `<think>\n\n</think>`
 * itself and pushes those tokens into the output before prefill, so every
 * reply starts with a block the model never generated. `null` means the
 * block is still open — there is nothing to show yet.
 */
function visibleText(raw: string): string | null {
	if (THINK_OPEN.test(raw) && !THINK_BLOCK.test(raw)) {
		return null;
	}

	return raw.replace(THINK_BLOCK, "");
}

/** A line of nothing but quotes or a fence: the model opened a block. */
const FENCE_ONLY = /^(?:"""|["'“”„«»])+$/;

/** For comparing a line with the source: spacing, case and one final .!? do not count. */
function normalise(text: string): string {
	return text
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.replace(/[.!?]$/, "");
}

/** What a line carries once its fence and its label are off; "" when nothing. */
function content(line: string): string {
	const clean = cleanOutput(line);

	return FENCE_ONLY.test(clean) ? "" : clean;
}

/**
 * Not a translation: the source echoed back, an empty line, or a bare
 * fence. `req.text` is the protected text, the same the model was shown,
 * so the comparison is like for like.
 */
function isEcho(line: string, source: string): boolean {
	const carried = content(line);

	return carried === "" || normalise(carried) === normalise(source);
}

/**
 * A single-line reply as it streams. `cut` is the translation once a
 * complete line that is not an echo has arrived — everything before it was
 * echo, and the generation is over as far as we are concerned. Until then
 * `rest` is what to show: the text with the echoed lines dropped, so the
 * source never flashes up in the translation's place.
 */
function scanLines(shown: string, source: string): {cut: string | null; rest: string} {
	const parts = shown.split("\n");

	// The last element is still being generated; the others are lines.
	for (let i = 0; i < parts.length - 1; i++) {
		if (!isEcho(parts[i], source)) {
			return {cut: cleanOutput(parts[i].replace(/\r$/, "")), rest: ""};
		}
	}

	return {cut: null, rest: parts[parts.length - 1]};
}

/**
 * The whole of a single-line reply once the stream is over: the first line
 * that is not an echo, or — when the model only ever echoed — the last line
 * that carries anything at all, which beats showing nothing. Nothing at all
 * returns "", which the queue and writer already treat as a failure.
 */
function pickTranslation(text: string, source: string): string {
	const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));

	for (const line of lines) {
		if (!isEcho(line, source)) {
			return cleanOutput(line);
		}
	}

	for (let i = lines.length - 1; i >= 0; i--) {
		const carried = content(lines[i]);

		if (carried !== "") {
			return carried;
		}
	}

	return "";
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
				stop: req.lines ? [`\n${END_SENTINEL}`] : [],
				extra_body: {enable_thinking: false},
			});

			// The lock is ours from here, so an abort from now on is ours to
			// act on — the loop's drain is what ends a generation nobody
			// wants any more, whether the abort came before it or during it.
			this.generating = req.id;

			let text = "";
			// A single-line request that has had its line: the generation is
			// over as far as we are concerned, but the stream is still drained.
			let cut = false;

			for await (const delta of stream) {
				if (signal.aborted) {
					// Drain, never return: WebLLM releases its per-model lock only
					// when its generator finishes, and resets its interrupt flag
					// when a generation starts, so ask again on every chunk until
					// it stops. Nothing is yielded after an abort.
					engine.interruptGenerate();
					continue;
				}

				if (cut) {
					// The same drain, but the interrupt is already sent: the
					// generation was running when it went out, and WebLLM only
					// clears that flag when the next generation starts.
					continue;
				}

				const piece = delta.choices[0]?.delta?.content ?? "";

				if (piece === "") {
					continue;
				}

				text += piece;

				const visible = visibleText(text);

				if (visible === null) {
					continue;
				}

				// A single-line reply that opens with a newline is not an
				// empty translation: the leading whitespace goes first.
				const shown = req.lines ? visible : visible.trimStart();

				if (req.lines) {
					yield {id: req.id, text: shown, done: false};
					continue;
				}

				// A translation is one line, and the stop string that used
				// to end it here matched inside the thinking block instead —
				// so the line is picked out here, past the echoed ones.
				const scan = scanLines(shown, req.text);

				if (scan.cut !== null) {
					cut = true;
					this.failures = 0;
					yield {id: req.id, text: scan.cut, done: true};
					engine.interruptGenerate();
					continue;
				}

				yield {id: req.id, text: scan.rest, done: false};
			}

			// A drained (aborted) generation proves nothing about the model:
			// only a completed one clears the failure count.
			if (!signal.aborted) {
				this.failures = 0;

				const visible = cut ? null : visibleText(text);

				if (visible !== null) {
					// A batched answer is cleaned line by line, where it is
					// parsed; a single one is whichever of its lines is the
					// translation rather than the source read back.
					const done = stripSentinel(req.lines ? visible : visible.trimStart());

					yield {
						id: req.id,
						text: req.lines ? done : pickTranslation(done, req.text),
						done: true,
					};
				}
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
