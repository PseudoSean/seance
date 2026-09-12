// The GPU tier (spec § engines/webllm.ts): WebLLM's MLCEngine behind the
// Engine interface. One model at a time. Generation is greedy at a low
// temperature, thinking off, a token budget from the input length, and a
// stop at the batch sentinel — a single-line request has no stop at all,
// because with thinking off WebLLM prepends an empty `<think></think>`
// block to the reply that a "\n" stop matched inside.
//
// So a single-line generation is consumed whole and the answer is picked
// out of it here: the lines up to the first **blank** one (a blank line
// opens the note the prompt forbade), minus the source echoed back, a bare
// `"""` fence and the canned greetings of `EXAMPLES` — a small model asked
// to translate often repeats the text before it gets to the translation,
// and sometimes greets instead of translating at all. What is left is
// joined back into one line, so a long message the model wrapped over
// several lines arrives whole; it used to be cut at the first of them.
//
// The library arrives through `WebLlmDeps` so this file never imports it;
// webllm.real.ts does.

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
	EXAMPLE_ANSWERS,
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

	// 3 × the input: room for the model to echo the line once before it
	// translates (the scan drops the echo) and still finish. + 16: the empty
	// thinking block WebLLM prepends when thinking is off. Measured against
	// the real model, the longest case of the evaluation set (four sentences,
	// ~60 input tokens) finished well inside it.
	return Math.min(512, 3 * estimateTokens(input) + 48 + 16);
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
 * A canned greeting the model offers instead of translating (`EXAMPLES` in
 * prompt.ts). It is fluent target-language text and it is not the source,
 * so nothing else would catch it: shown, it is a confident translation of
 * somebody else's sentence.
 */
function isExampleAnswer(carried: string): boolean {
	return (
		carried !== "" && EXAMPLE_ANSWERS.some((answer) => normalise(answer) === normalise(carried))
	);
}

/** What the guards took out of a single-line reply, and what they left. */
interface Scan {
	/** The lines that are the translation, cleaned, in order. */
	kept: string[];
	/** A canned answer was dropped — and it was not the source read back. */
	example: boolean;
}

/**
 * A single-line reply, line by line, up to the first **blank** one: a blank
 * line opens the note or the explanation the prompt forbade, and nothing
 * past it is the translation. Everything before it that is not the source
 * read back, a bare fence or a canned answer is kept — a translation the
 * model wrapped over two lines is both of them, which is why the cut at the
 * first line is gone.
 *
 * The echo check comes first on purpose: a line that is both the source and
 * a canned answer (the source *is* "hallo, wie geht es dir?") is an echo,
 * not a refusal.
 */
function scanLines(text: string, source: string): Scan {
	const scan: Scan = {kept: [], example: false};

	for (const raw of text.split("\n")) {
		const line = raw.replace(/\r$/, "");

		if (line.trim() === "") {
			break;
		}

		const carried = content(line);

		if (carried === "" || isEcho(line, source)) {
			continue;
		}

		if (isExampleAnswer(carried)) {
			scan.example = true;
			continue;
		}

		scan.kept.push(carried);
	}

	return scan;
}

/** The last line that carries anything at all: better than showing nothing. */
function lastCarried(text: string): string {
	const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));

	for (let i = lines.length - 1; i >= 0; i--) {
		const carried = content(lines[i]);

		if (carried !== "") {
			return carried;
		}
	}

	return "";
}

/**
 * What to show while a single-line reply is still coming: the lines that
 * are the translation so far, joined, and the line still being generated
 * after them. Past a blank line nothing more is shown.
 */
function progressText(shown: string, source: string): string {
	const parts = shown.split("\n");
	const complete = parts.slice(0, -1);
	const scan = scanLines(complete.join("\n"), source);
	const done = complete.some((line) => line.trim() === "");

	return (done ? scan.kept : [...scan.kept, parts[parts.length - 1]])
		.filter((part) => part !== "")
		.join(" ");
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

	/**
	 * A finished single-line reply as the one line a message is: everything
	 * up to the first blank line that is not the source read back or a
	 * canned answer, joined with single spaces.
	 *
	 * Nothing left, with a canned answer among what was dropped, is a
	 * refusal rather than an empty translation — the composer's strip offers
	 * "send as written" and a reading line offers Retry. Nothing left with
	 * only the source read back keeps the old fallback: the last line that
	 * carries anything, which beats showing nothing.
	 */
	private oneLine(text: string, source: string): string {
		const scan = scanLines(text, source);

		if (scan.kept.length > 0) {
			return scan.kept.join(" ");
		}

		if (scan.example) {
			throw new EngineError("the model answered with the example", "request");
		}

		return lastCarried(text);
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

				// The whole generation is consumed: a single-line request
				// used to be cut at its first complete line, which dropped
				// every later sentence when the model wrapped a long answer
				// or restated the line before translating it.
				yield {id: req.id, text: progressText(shown, req.text), done: false};
			}

			// A drained (aborted) generation proves nothing about the model:
			// only a completed one clears the failure count.
			if (!signal.aborted) {
				this.failures = 0;

				const visible = visibleText(text);

				if (visible !== null) {
					// A batched answer is cleaned line by line, where it is
					// parsed; a single one is its lines up to the first blank
					// one, the source read back and the canned answers
					// dropped, joined back into the one line a message is.
					const done = stripSentinel(req.lines ? visible : visible.trimStart());

					yield {
						id: req.id,
						text: req.lines ? done : this.oneLine(done, req.text),
						done: true,
					};
				}
			}
		} catch (e) {
			// A guard's refusal is about this answer, not about the device:
			// the model stays loaded and the request is the one that failed.
			if (e instanceof EngineError) {
				throw e;
			}

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
