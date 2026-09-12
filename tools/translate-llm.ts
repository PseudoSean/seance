/* eslint-disable no-console */
// An offline runner for the translation LLM: the browser's own
// `WebLlmEngine` (client/js/translate/engines/webllm.ts) driven over a Node
// backend, so a prompt or a piece of post-processing can be tried from the
// command line without a WebGPU browser.
//
//   npx tsx tools/translate-llm.ts "hello, how are you?" --to de [--from en]
//       [--purpose read|write] [--context fixture.json] [--show-prompt]
//       [--raw] [--device cpu|cuda] [--markers placeholder|literal|tags]
//   npx tsx tools/translate-llm.ts --capture capture.json
//   npx tsx tools/translate-llm.ts --eval tools/translate-eval/prompts.json [--to de]
//
// Only the model backend differs from the browser. The think-block
// stripping, the echo and canned-answer guards, the blank-line rule,
// `cleanOutput` and the abort/drain loop are the shipped engine itself
// (`--raw` says what each line of a reply was kept or dropped as), and the
// request is assembled by `protect()` and `emptyContext()` exactly as
// `reader.ts` and `outgoing.ts` assemble theirs — so what this prints is
// what the app would show, up to the weights.
//
// The weights are the ONNX build of the same model
// (`onnx-community/Qwen3-1.7B-ONNX`, `q4f16`) rather than WebLLM's MLC
// `q4f16_1`, so token-level output can differ slightly; what the prompt
// makes the model do is the same.
//
// Run it from the repository root: the download (~1.4 GB, first use only)
// is cached in `tmp/models/` — gitignored — unless `SEANCE_MODEL_CACHE`
// says otherwise.
//
// `--device cuda` is a convenience, not a supported path, and the fallback
// below only catches a session that will not *build*: an ONNX Runtime CUDA
// provider without cuDNN loads the fp16 weights happily and then decodes
// nothing but `!` (token 0). Read the output before trusting it; `cpu` is
// the default because it is the one that is always right.

import {readFileSync} from "node:fs";
import path from "node:path";
import {
	AutoModelForCausalLM,
	AutoTokenizer,
	InterruptableStoppingCriteria,
	StoppingCriteriaList,
	TextStreamer,
	env,
	type ProgressInfo,
} from "@huggingface/transformers";
import {
	ContextLine,
	PromptContext,
	TranslateRequest,
	emptyContext,
} from "../client/js/translate/engine";
import {
	ChatDelta,
	ChatRequest,
	MlcLike,
	ModelRecord,
	WebLlmDeps,
	WebLlmEngine,
} from "../client/js/translate/engines/webllm";
import {languageName} from "../client/js/translate/languages";
import {buildCatalog} from "../client/js/translate/models";
import type {TranslateCapture} from "../client/js/translate/outgoing";
import {
	EXAMPLE_ANSWERS,
	cleanOutput,
	parseBatchedOutput,
	stripSentinel,
} from "../client/js/translate/prompt";
import {type MarkerForm, placeholdersIn, protect, restoreAll} from "../client/js/translate/spans";

type Device = "cpu" | "cuda";
type Purpose = "read" | "write";
type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type Model = Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;

/** The Hugging Face repository the MLC model id is served from here. */
const ONNX_REPO = "onnx-community/Qwen3-1.7B-ONNX";
const DTYPE = "q4f16";
/** What WebLLM pushes into the output when thinking is off; see `create()`. */
const THINK_BLOCK = "<think>\n\n</think>\n\n";
/** The same block as the chat template renders it, wherever it put it. */
const CLOSED_THINK = /<think>\s*<\/think>/;

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

/** The earliest of `stops` in `text`; -1 when none of them is there. */
function firstStop(text: string, stops: string[]): number {
	let at = -1;

	for (const stop of stops) {
		if (stop === "") {
			continue;
		}

		const found = text.indexOf(stop);

		if (found !== -1 && (at === -1 || found < at)) {
			at = found;
		}
	}

	return at;
}

/**
 * The deltas a generation produces, as the async iterable `MlcLike` owes the
 * engine: `model.generate()` is one await with a streamer callback, and the
 * engine consumes a stream, so the callback fills this and the loop drains it.
 */
class DeltaQueue implements AsyncIterable<ChatDelta> {
	private items: string[] = [];
	private ended = false;
	private failure: unknown = null;
	private wake: (() => void) | null = null;

	push(text: string): void {
		this.items.push(text);
		this.signal();
	}

	finish(): void {
		this.ended = true;
		this.signal();
	}

	fail(error: unknown): void {
		this.failure = error;
		this.ended = true;
		this.signal();
	}

	private signal(): void {
		const wake = this.wake;

		this.wake = null;
		wake?.();
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<ChatDelta> {
		for (;;) {
			while (this.items.length > 0) {
				yield {choices: [{delta: {content: this.items.shift() ?? ""}}]};
			}

			if (this.failure !== null) {
				throw asError(this.failure);
			}

			if (this.ended) {
				return;
			}

			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}

interface BackendOptions {
	device: Device;
	repo: string;
	log(text: string): void;
}

interface LoadAttempt {
	device: Device;
	/** ONNX Runtime's `basic` graph optimization: the fallback for a session that will not build. */
	basic: boolean;
}

function attemptsFor(device: Device): LoadAttempt[] {
	const cpu: LoadAttempt[] = [
		{device: "cpu", basic: false},
		{device: "cpu", basic: true},
	];

	return device === "cuda"
		? [{device: "cuda", basic: false}, {device: "cuda", basic: true}, ...cpu]
		: cpu;
}

/**
 * `MlcLike` over transformers.js. Everything the engine asks of WebLLM —
 * load one model, generate a stream, interrupt it, unload — with ONNX
 * Runtime underneath.
 */
class NodeMlc implements MlcLike {
	readonly chat: MlcLike["chat"];
	/** The last rendered chat-template prompt, for `--show-prompt`. */
	lastPrompt = "";
	/** The last delta stream as the engine saw it, for `--raw`. */
	lastRaw = "";
	/** Whether the rendered prompt carried the closed thinking block. */
	promptHasThinkBlock = false;
	/** Which ONNX Runtime execution provider the weights actually loaded on. */
	device: Device = "cpu";

	private options: BackendOptions;
	private onProgress: (report: {progress: number; text: string}) => void;
	private tokenizer: Tokenizer | null = null;
	private model: Model | null = null;
	private loaded: string | null = null;
	private stopper: InterruptableStoppingCriteria | null = null;

	constructor(
		options: BackendOptions,
		onProgress: (report: {progress: number; text: string}) => void
	) {
		this.options = options;
		this.onProgress = onProgress;

		const create = (request: ChatRequest) => this.create(request);

		this.chat = {completions: {create}};
	}

	async reload(modelId: string): Promise<void> {
		if (this.loaded === modelId && this.model) {
			return;
		}

		const repo = this.options.repo;

		this.tokenizer = await AutoTokenizer.from_pretrained(repo, {
			progress_callback: (info: ProgressInfo) => this.progress(info),
		});

		let last: unknown = new Error("no load attempt was made");

		for (const attempt of attemptsFor(this.options.device)) {
			try {
				this.model = await AutoModelForCausalLM.from_pretrained(repo, {
					dtype: DTYPE,
					device: attempt.device,
					...(attempt.basic ? {session_options: {graphOptimizationLevel: "basic"}} : {}),
					progress_callback: (info: ProgressInfo) => this.progress(info),
				});
				this.device = attempt.device;
				this.loaded = modelId;
				return;
			} catch (error) {
				last = error;
				this.options.log(
					`  ! ${attempt.device}${
						attempt.basic ? " with basic graph optimization" : ""
					} would not load: ${message(error)}`
				);
			}
		}

		throw asError(last);
	}

	async unload(): Promise<void> {
		const model = this.model;

		this.model = null;
		this.tokenizer = null;
		this.loaded = null;
		await model?.dispose();
	}

	interruptGenerate(): void {
		this.stopper?.interrupt();
	}

	/** transformers.js reports per file; the engine wants one fraction. */
	private progress(info: ProgressInfo): void {
		const report = info as {status: string; file?: string; progress?: number};

		this.onProgress({
			progress: typeof report.progress === "number" ? report.progress / 100 : 0,
			text: `${report.status} ${report.file ?? ""}`.trim(),
		});
	}

	private create(request: ChatRequest): Promise<AsyncIterable<ChatDelta>> {
		const tokenizer = this.tokenizer;
		const model = this.model;

		if (!tokenizer || !model) {
			throw new Error("model not loaded");
		}

		// Two casts, and only these: the library's generated types describe
		// neither the template kwargs it spreads into the Jinja render nor the
		// encoded inputs spread into generate().
		const applyTemplate = tokenizer.apply_chat_template.bind(tokenizer) as (
			messages: ChatRequest["messages"],
			options: Record<string, unknown>
		) => string;
		const generate = model.generate.bind(model) as (
			options: Record<string, unknown>
		) => Promise<unknown>;

		const prompt = applyTemplate(request.messages, {
			tokenize: false,
			add_generation_prompt: true,
			// Not one of apply_chat_template's own options: what is left of them
			// is spread into the template's variables, which is how Qwen3's
			// template sees it.
			enable_thinking: request.extra_body?.enable_thinking ?? true,
		});

		this.lastPrompt = prompt;
		this.promptHasThinkBlock = CLOSED_THINK.test(prompt);

		const inputs = tokenizer(prompt, {add_special_tokens: false}) as Record<string, unknown>;
		const queue = new DeltaQueue();
		const stopper = new InterruptableStoppingCriteria();
		const criteria = new StoppingCriteriaList();

		criteria.push(stopper);
		this.stopper = stopper;

		const stops = request.stop ?? [];
		let raw = "";
		let stopped = false;

		// With `enable_thinking: false` WebLLM does not ask the model not to
		// think: it encodes `<think>\n\n</think>` itself and pushes those
		// tokens into the *output* before prefill, so every reply the engine
		// sees starts with a block the model never generated — which is what
		// `visibleText()` in webllm.ts strips. Qwen3's chat template puts the
		// same block at the end of the *prompt* instead, so nothing here
		// generates it. Prepending it as the first delta is what makes the
		// engine see exactly what the browser sees.
		if (this.promptHasThinkBlock) {
			raw = THINK_BLOCK;
			queue.push(THINK_BLOCK);
		}

		this.lastRaw = raw;

		const streamer = new TextStreamer(tokenizer, {
			skip_prompt: true,
			skip_special_tokens: true,
			callback_function: (text: string) => {
				if (stopped || text === "") {
					return;
				}

				// A stop string ends the generation and is not part of the
				// answer, as it is not for WebLLM; it can straddle two deltas,
				// so it is looked for in the whole of the text so far.
				const combined = raw + text;
				const at = firstStop(combined, stops);
				const piece =
					at === -1 ? text : combined.slice(raw.length, Math.max(at, raw.length));

				if (at !== -1) {
					stopped = true;
				}

				if (piece !== "") {
					raw += piece;
					this.lastRaw = raw;
					queue.push(piece);
				}

				if (stopped) {
					stopper.interrupt();
				}
			},
		});

		// Greedy, as the spec asks: the engine's `temperature: 0.1` has no
		// sampling to temper. `max_tokens` is the budget the engine computed,
		// which includes 16 tokens for a thinking block this backend does not
		// generate — a little more room than the browser has, never less.
		void (async () => {
			try {
				await generate({
					...inputs,
					max_new_tokens: request.max_tokens,
					do_sample: false,
					streamer,
					stopping_criteria: criteria,
				});
				queue.finish();
			} catch (error) {
				queue.fail(error);
			} finally {
				if (this.stopper === stopper) {
					this.stopper = null;
				}
			}
		})();

		return Promise.resolve(queue);
	}
}

/**
 * `WebLlmDeps` whose `create()` builds the Node backend. `prebuilt` carries
 * the catalog's own id so `appConfigFor()` still resolves — the model_list it
 * produces is WebLLM's business and nothing here reads it.
 */
function nodeDeps(
	modelId: string,
	options: BackendOptions
): {deps: WebLlmDeps; backend: () => NodeMlc | null} {
	let made: NodeMlc | null = null;
	const prebuilt: ModelRecord[] = [
		{model_id: modelId, model: `node:${options.repo}`, model_lib: "node"},
	];

	function create(
		_appConfig: {model_list: ModelRecord[]},
		onProgress: (report: {progress: number; text: string}) => void
	): MlcLike {
		made = new NodeMlc(options, onProgress);

		return made;
	}

	return {
		deps: {prebuilt, create},
		backend: () => made,
	};
}

interface Fixture extends Partial<PromptContext> {
	nicks?: string[];
}

interface EvalCase {
	text: string;
	from?: string | null;
	to?: string;
	purpose?: Purpose;
	/** The channel's names, for `protect()`; a nick becomes a placeholder. */
	nicks?: string[];
	/** The case's own channel: a `PromptContext` (plus `nicks`), as `--context` takes one. */
	context?: Fixture;
	note?: string;
	/** What a correct answer carries. Printed, never asserted. */
	expect?: string;
}

interface Options {
	text: string | null;
	to: string;
	from: string | null;
	purpose: Purpose;
	/** The route's marker form (spans.ts `renderMarkers`); the app's LLM route uses `LLM_MARKERS`. */
	markers: MarkerForm;
	contextFile: string | null;
	/** `--capture`: a `seanceTranslateLast` object saved from the app. */
	captureFile: string | null;
	capture: TranslateCapture | null;
	showPrompt: boolean;
	raw: boolean;
	device: Device;
	evalFile: string | null;
	repo: string;
}

const USAGE = [
	'usage: npx tsx tools/translate-llm.ts "text" --to de [--from en] [--purpose read|write]',
	"                                     [--context fixture.json] [--show-prompt] [--raw]",
	"                                     [--device cpu|cuda] [--repo <hf repo>]",
	"                                     [--markers placeholder|literal|tags]",
	"       npx tsx tools/translate-llm.ts --capture capture.json [--to de] [--show-prompt]",
	"       npx tsx tools/translate-llm.ts --eval tools/translate-eval/prompts.json [--to de]",
].join("\n");

function parseArgs(argv: string[]): Options {
	const options: Options = {
		text: null,
		to: "de",
		from: null,
		purpose: "read",
		markers: "placeholder",
		contextFile: null,
		captureFile: null,
		capture: null,
		showPrompt: false,
		raw: false,
		device: "cpu",
		evalFile: null,
		repo: ONNX_REPO,
	};

	// Which flags the command line actually carried: a capture supplies the
	// rest, and "the default is still there" cannot be told from "the user
	// asked for the default" any other way (`--from` has no value that means
	// "unset" -- null is a real source).
	const given = new Set<string>();

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		given.add(arg);

		const value = () => {
			const next = argv[++i];

			if (next === undefined) {
				throw new Error(`${arg} wants a value\n${USAGE}`);
			}

			return next;
		};

		if (arg === "--to") {
			options.to = value();
		} else if (arg === "--from") {
			options.from = value();
		} else if (arg === "--purpose") {
			const purpose = value();

			if (purpose !== "read" && purpose !== "write") {
				throw new Error(`--purpose is read or write, not ${purpose}`);
			}

			options.purpose = purpose;
		} else if (arg === "--markers") {
			const markers = value();

			if (markers !== "placeholder" && markers !== "literal" && markers !== "tags") {
				throw new Error(`--markers is placeholder, literal or tags, not ${markers}`);
			}

			options.markers = markers;
		} else if (arg === "--context") {
			options.contextFile = value();
		} else if (arg === "--capture") {
			options.captureFile = value();
		} else if (arg === "--eval") {
			options.evalFile = value();
		} else if (arg === "--device") {
			const device = value();

			if (device !== "cpu" && device !== "cuda") {
				throw new Error(`--device is cpu or cuda, not ${device}`);
			}

			options.device = device;
		} else if (arg === "--repo") {
			options.repo = value();
		} else if (arg === "--show-prompt") {
			options.showPrompt = true;
		} else if (arg === "--raw") {
			options.raw = true;
		} else if (arg === "--help" || arg === "-h") {
			console.log(USAGE);
			process.exit(0);
		} else if (arg.startsWith("--")) {
			throw new Error(`unknown option ${arg}\n${USAGE}`);
		} else if (options.text === null) {
			options.text = arg;
		} else {
			throw new Error(`unexpected argument ${arg}\n${USAGE}`);
		}
	}

	// Before the check below: a capture brings the text with it.
	if (options.captureFile) {
		options.capture = JSON.parse(readFileSync(options.captureFile, "utf8")) as TranslateCapture;
		applyCapture(options, options.capture, given);
	}

	if (options.text === null && options.evalFile === null) {
		throw new Error(USAGE);
	}

	return options;
}

/**
 * `--capture` takes a saved `seanceTranslateLast` (translate/writer.ts, a
 * development build only) as the whole request: the draft, the pair, the
 * marker form and the context the page built, so a translation someone
 * reports can be replayed exactly as it was asked for rather than
 * approximated. `--to`, `--from`, `--purpose`, `--markers` and a text
 * argument on the command line still override it, and `--context` replaces
 * the context.
 *
 * `purpose` comes from `kind`: the draft's translation is a write, the round
 * trip reading one back is a read -- the default (`read`) would otherwise
 * build the wrong prompt for every captured draft.
 */
function applyCapture(options: Options, capture: TranslateCapture, given: Set<string>): void {
	if (options.text === null) {
		options.text = capture.draft;
	}

	if (!given.has("--from")) {
		options.from = capture.from;
	}

	if (!given.has("--to")) {
		options.to = capture.to;
	}

	if (!given.has("--purpose")) {
		options.purpose = capture.kind === "write" ? "write" : "read";
	}

	if (!given.has("--markers")) {
		options.markers = capture.markers;
	}
}

function fixtureContext(fixture: Fixture): PromptContext {
	const context: PromptContext = {
		recent: fixture.recent ?? [],
		names: fixture.names ?? [],
		terms: fixture.terms ?? [],
		voice: fixture.voice ?? [],
		formality: fixture.formality ?? "auto",
	};

	if (fixture.topic) {
		context.topic = fixture.topic;
	}

	if (fixture.replyTo) {
		context.replyTo = fixture.replyTo as ContextLine;
	}

	if (fixture.variant) {
		context.variant = fixture.variant;
	}

	if (fixture.sourceHint) {
		context.sourceHint = fixture.sourceHint;
	}

	return context;
}

function loadFixture(file: string | null): {context: PromptContext; nicks: string[]} {
	if (!file) {
		return {context: emptyContext(), nicks: []};
	}

	const fixture = JSON.parse(readFileSync(file, "utf8")) as Fixture;

	return {context: fixtureContext(fixture), nicks: fixture.nicks ?? []};
}

/**
 * For comparing a line with the source the way `isEcho()` in webllm.ts does
 * — mirrored here only so `--raw` can say *why* a line was dropped; the
 * engine's own copy is what decides.
 */
function normalise(text: string): string {
	return text
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.replace(/[.!?]$/, "");
}

/**
 * The engine's view of the raw stream, line by line, for `--raw`: what each
 * line is kept or dropped as, and where the answer stops. The kept lines are
 * what the engine joins with single spaces.
 */
function echoVerdict(raw: string, source: string): string[] {
	const visible = raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
	let past = false;

	return visible.split("\n").map((line, i) => {
		const carried = cleanOutput(line.replace(/\r$/, ""));
		const bare = /^(?:"""|["'“”„«»])+$/.test(carried) ? "" : carried;
		const verdict = past
			? "dropped (past the blank line)"
			: line.trim() === ""
			? "the blank line: the answer ends here"
			: bare === ""
			? "dropped (empty or a bare fence)"
			: normalise(bare) === normalise(source)
			? "dropped (the source read back)"
			: EXAMPLE_ANSWERS.some((answer) => normalise(answer) === normalise(bare))
			? "dropped (a canned answer — the example guard)"
			: "kept — part of the translation";

		if (line.trim() === "") {
			past = true;
		}

		return `    [${i}] ${JSON.stringify(line)} → ${JSON.stringify(bare)}  ${verdict}`;
	});
}

interface RunResult {
	text: string;
	ms: number;
}

async function runCase(
	engine: WebLlmEngine,
	backend: () => NodeMlc | null,
	modelId: string,
	item: EvalCase,
	base: {
		to: string;
		from: string | null;
		purpose: Purpose;
		context: PromptContext;
		nicks: string[];
		markers: MarkerForm;
	},
	show: {prompt: boolean; raw: boolean; stream: boolean},
	id: number
): Promise<RunResult> {
	const nicks = item.nicks ?? base.nicks;
	// The app's exact shape: one protection per request, in the marker form
	// the route it is about to take asks for (spans.ts `renderMarkers`).
	const info = protect(item.text, {nicks, markers: base.markers});
	// A draft is protected once and only then split, as outgoing.ts does, so a
	// fenced block is one span rather than a fence per line.
	const lines = info.text.split("\n").filter((line) => line.trim() !== "");
	const batched = lines.length > 1;
	const request: TranslateRequest = {
		id,
		model: modelId,
		text: batched ? "" : info.text,
		from: item.from === undefined ? base.from : item.from,
		to: item.to ?? base.to,
		purpose: item.purpose ?? base.purpose,
		context: base.context,
		markers: base.markers,
	};

	if (batched) {
		request.lines = lines;
	}

	const controller = new AbortController();
	const started = Date.now();
	let last = "";

	for await (const chunk of engine.translate(request, controller.signal)) {
		last = chunk.text;

		if (show.stream) {
			console.log(`… ${chunk.text.replace(/\n/g, "\\n")}`);
		}
	}

	const ms = Date.now() - started;
	const node = backend();

	if (show.prompt && node) {
		console.log("\n--- rendered chat-template prompt ---");
		console.log(node.lastPrompt);
		console.log("--- end of prompt ---");
		console.log(
			node.promptHasThinkBlock
				? "think block: the template put <think></think> in the PROMPT, so it is prepended as the first delta (where WebLLM puts it)"
				: "think block: NOT in the rendered prompt — nothing prepended; the model may generate real reasoning and maxTokensFor's +16 is wrong"
		);
		console.log("");
	}

	if (show.raw && node) {
		console.log(`raw deltas as the engine saw them: ${JSON.stringify(node.lastRaw)}`);

		if (!batched) {
			console.log("  the engine's guards, line by line (the kept lines are joined):");

			for (const line of echoVerdict(node.lastRaw, request.text)) {
				console.log(line);
			}
		}

		console.log(`  engine output before restore: ${JSON.stringify(last)}`);
	}

	if (!batched) {
		return {text: restoreAll(last, info, placeholdersIn(info.text)), ms};
	}

	const parsed = parseBatchedOutput(last, lines.length);

	if (!parsed) {
		console.log("  ! the numbered answer did not parse; showing it as it came");

		return {text: restoreAll(stripSentinel(last), info), ms};
	}

	return {
		text: parsed.map((text, i) => restoreAll(text, info, placeholdersIn(lines[i]))).join("\n"),
		ms,
	};
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));

	env.cacheDir = process.env.SEANCE_MODEL_CACHE ?? path.resolve(process.cwd(), "tmp", "models");

	const catalog = buildCatalog();
	const {deps, backend} = nodeDeps(catalog.llm.id, {
		device: options.device,
		repo: options.repo,
		log: (text) => console.log(text),
	});
	const engine = new WebLlmEngine(deps, (code) => languageName(code));

	engine.configure(catalog);

	console.log(`model   ${catalog.llm.id} → ${options.repo} (${DTYPE})`);
	console.log(`cache   ${env.cacheDir}`);
	console.log(`device  ${options.device} requested`);
	console.log(`markers ${options.markers}`);

	if (options.capture) {
		const capture = options.capture;

		console.log(
			`capture ${options.captureFile ?? ""} — ${capture.kind}${
				capture.retry ? " (the bare second try)" : ""
			}, ${capture.from ?? "auto"} → ${capture.to}, ${
				capture.model ?? "no model"
			}; the page got ${JSON.stringify(capture.text)}${
				capture.error ? ` (${capture.error})` : ""
			}`
		);
	}

	const loadStarted = Date.now();
	let shown = -1;

	await engine.load(catalog.llm, (progress) => {
		const percent = Math.floor(progress.fraction * 100);

		if (percent >= shown + 10 || percent === 100) {
			shown = percent;
			console.log(`  load ${percent}% ${progress.text ?? ""}`.trimEnd());
		}
	});

	const loadMs = Date.now() - loadStarted;
	const node = backend();

	console.log(`loaded  on ${node?.device ?? "?"} in ${(loadMs / 1000).toFixed(1)}s\n`);

	// A capture carries the context the page sent. It carries no user list,
	// so the context's own `names` stand in for span protection -- they are
	// the recent speakers and the nicks the draft mentions, which is what a
	// nick placeholder is for. `--context` replaces both.
	const fixture =
		options.capture && !options.contextFile
			? {
					context: fixtureContext(options.capture.context),
					nicks: options.capture.context.names,
			  }
			: loadFixture(options.contextFile);
	const base = {
		to: options.to,
		from: options.from,
		purpose: options.purpose,
		context: fixture.context,
		nicks: fixture.nicks,
		markers: options.markers,
	};

	if (options.evalFile) {
		const cases = JSON.parse(readFileSync(options.evalFile, "utf8")) as EvalCase[];
		let promptShown = !options.showPrompt;

		for (let i = 0; i < cases.length; i++) {
			const item = cases[i];

			console.log(`[${i + 1}/${cases.length}] ${item.note ?? ""}`.trimEnd());
			console.log(
				`  in   (${item.from ?? base.from ?? "auto"} → ${
					item.to ?? base.to
				}) ${JSON.stringify(item.text)}`
			);

			if (item.expect) {
				console.log(`  want ${item.expect}`);
			}

			// A case may bring its own channel: its context replaces the
			// command line's, and its own `nicks` the fixture's.
			const local = item.context
				? {context: fixtureContext(item.context), nicks: item.context.nicks ?? base.nicks}
				: {context: base.context, nicks: base.nicks};
			const result = await runCase(
				engine,
				backend,
				catalog.llm.id,
				item,
				{...base, ...local},
				{prompt: !promptShown, raw: options.raw, stream: false},
				i + 1
			);

			promptShown = true;
			console.log(`  out  ${JSON.stringify(result.text)}`);
			console.log(`  time ${(result.ms / 1000).toFixed(1)}s\n`);
		}
	} else {
		const result = await runCase(
			engine,
			backend,
			catalog.llm.id,
			{text: options.text ?? ""},
			base,
			{prompt: options.showPrompt, raw: options.raw, stream: true},
			1
		);

		console.log(`done ${JSON.stringify(result.text)}`);
		console.log(`time ${(result.ms / 1000).toFixed(1)}s`);
	}

	await engine.unload();
}

main().catch((error: unknown) => {
	console.error(message(error));
	process.exit(1);
});
