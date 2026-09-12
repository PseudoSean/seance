import {expect} from "chai";
import {EngineError, emptyContext, type TranslateRequest} from "../../client/js/translate/engine";
import {
	WebLlmEngine,
	appConfigFor,
	maxTokensFor,
	type ChatRequest,
	type MlcLike,
	type ModelRecord,
	type WebLlmDeps,
} from "../../client/js/translate/engines/webllm";
import {buildCatalog} from "../../client/js/translate/models";

const catalog = buildCatalog();
const prebuilt: ModelRecord[] = [
	{
		model_id: catalog.llm.id,
		model: `https://huggingface.co/mlc-ai/${catalog.llm.id}/resolve/main/`,
		model_lib: "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/qwen3.wasm",
	},
];

function fakeMlc(pieces: string[]) {
	const calls = {
		reload: [] as string[],
		unload: 0,
		interrupt: 0,
		create: [] as ChatRequest[],
		/**
		 * Set when the generator reaches the end of its `for` loop — where
		 * WebLLM's own generator releases its per-model lock. An early
		 * `return()` from the consumer never gets there, so a stranded lock
		 * shows up here as `false`. This fake keeps streaming through an
		 * interrupt, as WebLLM does until its next decode step.
		 */
		ranToEnd: false,
	};
	const mlc: MlcLike = {
		reload(modelId) {
			calls.reload.push(modelId);

			return Promise.resolve();
		},
		unload() {
			calls.unload++;

			return Promise.resolve();
		},
		interruptGenerate() {
			calls.interrupt++;
		},
		chat: {
			completions: {
				async create(req) {
					calls.create.push(req);
					await Promise.resolve();

					return (async function* () {
						await Promise.resolve();

						for (const piece of pieces) {
							await Promise.resolve();
							yield {choices: [{delta: {content: piece}}]};
						}

						calls.ranToEnd = true;
					})();
				},
			},
		},
	};

	return {mlc, calls};
}

function deps(pieces: string[]) {
	const fake = fakeMlc(pieces);
	const created: {appConfig: {model_list: ModelRecord[]}; progress: number[]}[] = [];
	const d: WebLlmDeps = {
		prebuilt,
		create(appConfig, onProgress) {
			const entry = {appConfig, progress: [] as number[]};
			created.push(entry);
			onProgress({progress: 0.5, text: "half"});
			onProgress({progress: 1, text: "done"});
			return fake.mlc;
		},
	};

	return {deps: d, created, calls: fake.calls};
}

/**
 * WebLLM's per-model lock, modelled as a deferred `create()`: a request sits
 * in `create()` until the test grants it the lock, exactly as a generation
 * waits for the one before it. `interruptGenerate()` is engine-global, as
 * WebLLM's is — it ends whichever generation is streaming, whoever called it.
 */
function lockedMlc(pieces: string[]) {
	const calls = {reload: [] as string[], unload: 0, interrupt: 0, create: [] as ChatRequest[]};
	const locks: (() => void)[] = [];
	let interrupted = false;
	const mlc: MlcLike = {
		reload(modelId) {
			calls.reload.push(modelId);

			return Promise.resolve();
		},
		unload() {
			calls.unload++;

			return Promise.resolve();
		},
		interruptGenerate() {
			calls.interrupt++;
			interrupted = true;
		},
		chat: {
			completions: {
				async create(req) {
					calls.create.push(req);
					await new Promise<void>((resolve) => locks.push(resolve));
					// WebLLM clears the flag as a generation starts.
					interrupted = false;

					return (async function* () {
						await Promise.resolve();

						for (const piece of pieces) {
							if (interrupted) {
								return;
							}

							yield {choices: [{delta: {content: piece}}]};
						}
					})();
				},
			},
		},
	};

	return {mlc, calls, locks};
}

function lockedDeps(pieces: string[]) {
	const fake = lockedMlc(pieces);
	const d: WebLlmDeps = {prebuilt, create: () => fake.mlc};

	return {
		deps: d,
		calls: fake.calls,
		/** Hand the lock to the n-th `create()` call; any other keeps waiting. */
		grant: (n: number) => fake.locks[n](),
	};
}

/** Drain the microtask queue (these harnesses use no timers). */
async function settle() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
}

function request(overrides: Partial<TranslateRequest> = {}): TranslateRequest {
	return {
		id: 1,
		model: catalog.llm.id,
		text: "Ich schick dir gleich das Log.",
		from: "de",
		to: "en",
		purpose: "read",
		context: emptyContext(),
		...overrides,
	};
}

const name = (code: string) => code;

describe("translate/engines/webllm", () => {
	it("appConfigFor takes the prebuilt record as it is", () => {
		expect(appConfigFor(catalog.llm, prebuilt, {})).to.deep.equal({model_list: [prebuilt[0]]});
	});

	it("appConfigFor points a mirrored model at the mirror, keeping or overriding the library", () => {
		const mirrored = appConfigFor(catalog.llm, prebuilt, {modelBase: "https://m.test/models"});

		expect(mirrored.model_list[0].model).to.equal(`https://m.test/models/${catalog.llm.id}/`);
		expect(mirrored.model_list[0].model_lib).to.equal(prebuilt[0].model_lib);

		const own = appConfigFor(catalog.llm, prebuilt, {
			modelBase: "https://m.test/models",
			lib: "https://m.test/libs/qwen3.wasm",
		});

		expect(own.model_list[0].model_lib).to.equal("https://m.test/libs/qwen3.wasm");
	});

	it("appConfigFor refuses an unknown model without a library", () => {
		const ref = {...catalog.llm, id: "not-prebuilt"};

		expect(() => appConfigFor(ref, prebuilt, {})).to.throw(
			"unknown WebLLM model not-prebuilt: set translation.llm.lib"
		);
		expect(
			appConfigFor(ref, prebuilt, {lib: "https://m.test/x.wasm"}).model_list[0]
		).to.deep.equal({
			model_id: "not-prebuilt",
			model: "https://huggingface.co/mlc-ai/not-prebuilt/resolve/main/",
			model_lib: "https://m.test/x.wasm",
		});
	});

	it("load creates the engine with the app config, reloads the model and reports progress", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);
		const progress: number[] = [];

		engine.configure(catalog);
		await engine.load(catalog.llm, (p) => progress.push(p.fraction));

		expect(d.created[0].appConfig.model_list[0].model_id).to.equal(catalog.llm.id);
		expect(d.calls.reload).to.deep.equal([catalog.llm.id]);
		expect(progress).to.deep.equal([0.5, 1]);
		expect(engine.status()).to.equal("ready");
		expect(engine.loadedModels()).to.deep.equal([catalog.llm.id]);
		expect(engine.isLoaded(catalog.llm.id)).to.equal(true);
	});

	it("translate streams cumulative text, then the trimmed result, with the spec's decoding settings", async () => {
		const d = deps(["I'll", " send", " you the log", " shortly.\n"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const seen: {text: string; done: boolean}[] = [];

		for await (const chunk of engine.translate(request(), new AbortController().signal)) {
			seen.push({text: chunk.text, done: chunk.done});
		}

		expect(seen).to.deep.equal([
			{text: "I'll", done: false},
			{text: "I'll send", done: false},
			{text: "I'll send you the log", done: false},
			// The newline is the engine's own cut now, not a stop string.
			{text: "I'll send you the log shortly.", done: true},
		]);
		expect(d.calls.interrupt).to.equal(1);
		const created = d.calls.create[0];

		expect(created.stream).to.equal(true);
		expect(created.temperature).to.equal(0.1);
		expect(created.stop).to.deep.equal([]);
		expect(created.extra_body).to.deep.equal({enable_thinking: false});
		expect(created.max_tokens).to.equal(maxTokensFor(request()));
		expect(created.messages[0].role).to.equal("system");
		expect(created.messages[1].content).to.include("Message to translate, from de:");
		expect(created.messages[1].content).to.include("Ich schick dir gleich das Log.");
	});

	it("a batched request stops at the sentinel and strips it", async () => {
		const d = deps(["1. one\n2. two\nEND"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const chunks: string[] = [];

		for await (const chunk of engine.translate(
			request({lines: ["eins", "zwei"]}),
			new AbortController().signal
		)) {
			chunks.push(chunk.text);
		}

		expect(chunks[chunks.length - 1]).to.equal("1. one\n2. two");
		expect(d.calls.create[0].stop).to.deep.equal(["\nEND"]);
	});

	it("the empty thinking block WebLLM prepends never reaches the caller", async () => {
		const d = deps(["<think>", "\n\n</think>", "\n\n", "Hallo", " Welt"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const seen: {text: string; done: boolean}[] = [];

		for await (const chunk of engine.translate(request(), new AbortController().signal)) {
			seen.push({text: chunk.text, done: chunk.done});
		}

		// Nothing at all while the block is open; an empty translation-so-far
		// once it closes, which is all the block leaves behind.
		expect(seen).to.deep.equal([
			{text: "", done: false},
			{text: "", done: false},
			{text: "Hallo", done: false},
			{text: "Hallo Welt", done: false},
			{text: "Hallo Welt", done: true},
		]);
		expect(seen.some((chunk) => chunk.text.includes("<think>"))).to.equal(false);
	});

	it("a single-line request cuts itself at the first newline and drains the rest", async () => {
		const d = deps(["<think>\n\n</think>\n\n", "Hallo", "\nWelt", " mehr"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const seen: {text: string; done: boolean}[] = [];

		for await (const chunk of engine.translate(request(), new AbortController().signal)) {
			seen.push({text: chunk.text, done: chunk.done});
		}

		expect(seen).to.deep.equal([
			{text: "", done: false},
			{text: "Hallo", done: false},
			{text: "Hallo", done: true},
		]);
		expect(d.calls.interrupt).to.equal(1);
		// The generation reached the point where WebLLM releases its lock.
		expect(d.calls.ranToEnd).to.equal(true);
		// A cut is a completed translation, not a failure.
		expect(engine.generationFailures).to.equal(0);
	});

	it("a reply that opens with a newline is not cut to nothing", async () => {
		const d = deps(["\n", "Hallo", "\nWelt"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const seen: {text: string; done: boolean}[] = [];

		for await (const chunk of engine.translate(request(), new AbortController().signal)) {
			seen.push({text: chunk.text, done: chunk.done});
		}

		expect(seen).to.deep.equal([
			{text: "", done: false},
			{text: "Hallo", done: false},
			{text: "Hallo", done: true},
		]);
	});

	it("a single-line reply is unquoted and unlabelled", async () => {
		const d = deps(['Translation: "Hallo Welt"']);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const seen: {text: string; done: boolean}[] = [];

		for await (const chunk of engine.translate(request(), new AbortController().signal)) {
			seen.push({text: chunk.text, done: chunk.done});
		}

		expect(seen[seen.length - 1]).to.deep.equal({text: "Hallo Welt", done: true});
	});

	it("a batched request keeps its newlines and stops at the sentinel, thinking block aside", async () => {
		const d = deps(["<think>\n\n</think>\n\n", "1. Hallo\n", "2. Welt\nEND"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const chunks: string[] = [];

		for await (const chunk of engine.translate(
			request({lines: ["eins", "zwei"]}),
			new AbortController().signal
		)) {
			chunks.push(chunk.text);
		}

		expect(chunks[chunks.length - 1]).to.equal("1. Hallo\n2. Welt");
		expect(d.calls.create[0].stop).to.deep.equal(["\nEND"]);
		expect(d.calls.interrupt).to.equal(0);
	});

	it("maxTokensFor is 2 × input tokens + 32 + the thinking block, capped at 512", () => {
		expect(maxTokensFor(request({text: "abcd"}))).to.equal(50);
		expect(maxTokensFor(request({text: "x".repeat(4000)}))).to.equal(512);
		expect(maxTokensFor(request({lines: ["abcd", "efgh"]}))).to.equal(2 * 3 + 32 + 16);
	});

	it("an abort interrupts generation", async () => {
		const d = deps(["a", "b", "c"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const controller = new AbortController();

		for await (const _chunk of engine.translate(request(), controller.signal)) {
			controller.abort();
			break;
		}

		expect(d.calls.interrupt).to.equal(1);
	});

	it("an abort mid-stream drains the stream instead of returning early", async () => {
		const d = deps(["a", "b", "c", "d"]);
		const engine = new WebLlmEngine(d.deps, name);

		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});

		const controller = new AbortController();
		const seen: string[] = [];

		for await (const chunk of engine.translate(request(), controller.signal)) {
			seen.push(chunk.text);

			if (seen.length === 2) {
				controller.abort();
			}
		}

		// Nothing after the abort: not the remaining pieces, not the done chunk.
		expect(seen).to.deep.equal(["a", "ab"]);
		expect(d.calls.interrupt).to.be.at.least(1);
		// The generation reached the point where WebLLM would release its lock.
		expect(d.calls.ranToEnd).to.equal(true);
	});

	it("an abort before the first chunk still drains and interrupts once the generation runs", async () => {
		const d = deps(["a", "b"]);
		const engine = new WebLlmEngine(d.deps, name);

		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});

		const controller = new AbortController();
		const stream = engine.translate(request(), controller.signal)[Symbol.asyncIterator]();
		const first = stream.next();

		// Before a single chunk — before `create()` has even resolved, so the
		// interrupt the listener would send has nothing to aim at yet.
		controller.abort();
		expect(d.calls.interrupt).to.equal(0);

		expect((await first).done).to.equal(true);
		expect(d.calls.interrupt).to.be.at.least(1);
		expect(d.calls.ranToEnd).to.equal(true);
	});

	it("an abort while waiting for the lock leaves the running generation alone", async () => {
		const d = lockedDeps(["a", "b"]);
		const engine = new WebLlmEngine(d.deps, name);

		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});

		const waiting = new AbortController();
		const running = engine
			.translate(request({id: 1}), new AbortController().signal)
			[Symbol.asyncIterator]();
		const queued = engine.translate(request({id: 2}), waiting.signal)[Symbol.asyncIterator]();
		const first = running.next();

		// The queued request asks for the lock and never gets it: that is the
		// case under test, so do not grant it here (test (c) below is the
		// request that does get it after its abort).
		void queued.next();
		await settle();
		expect(d.calls.create).to.have.length(2);
		d.grant(0);
		expect((await first).value.text).to.equal("a");

		waiting.abort();
		await settle();
		expect(d.calls.interrupt).to.equal(0);

		const rest: {text: string; done: boolean}[] = [];

		for (let step = await running.next(); !step.done; step = await running.next()) {
			rest.push({text: step.value.text, done: step.value.done});
		}

		expect(rest).to.deep.equal([
			{text: "ab", done: false},
			{text: "ab", done: true},
		]);
		expect(d.calls.interrupt).to.equal(0);
	});

	it("an abort of the generation that is running interrupts it once", async () => {
		const d = lockedDeps(["a", "b"]);
		const engine = new WebLlmEngine(d.deps, name);

		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});

		const controller = new AbortController();
		const stream = engine.translate(request(), controller.signal)[Symbol.asyncIterator]();
		const first = stream.next();

		await settle();
		d.grant(0);
		expect((await first).value.text).to.equal("a");

		controller.abort();
		expect(d.calls.interrupt).to.equal(1);
		expect((await stream.next()).done).to.equal(true);
	});

	it("a request aborted before the lock arrives ends the generation handed to it", async () => {
		const d = lockedDeps(["a", "b"]);
		const engine = new WebLlmEngine(d.deps, name);

		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});

		const controller = new AbortController();
		const stream = engine.translate(request(), controller.signal)[Symbol.asyncIterator]();
		const first = stream.next();

		await settle();
		controller.abort();
		expect(d.calls.interrupt).to.equal(0);

		d.grant(0);
		expect((await first).done).to.equal(true);
		expect(d.calls.interrupt).to.equal(1);
	});

	it("translating with a model that is not loaded throws; unload resets", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		let message = "";

		try {
			for await (const _c of engine.translate(request(), new AbortController().signal)) {
				// consume
			}
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal(`model not loaded: ${catalog.llm.id}`);
		await engine.load(catalog.llm, () => {});
		await engine.unload();
		expect(d.calls.unload).to.equal(1);
		expect(engine.status()).to.equal("cold");
		expect(engine.loadedModels()).to.deep.equal([]);
	});

	it("two concurrent loads of the same model share one engine", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);

		engine.configure(catalog);
		await Promise.all([engine.load(catalog.llm, () => {}), engine.load(catalog.llm, () => {})]);

		expect(d.created.length).to.equal(1);
		expect(d.calls.reload).to.deep.equal([catalog.llm.id]);
		expect(d.calls.unload).to.equal(0);
		expect(engine.status()).to.equal("ready");
		expect(engine.loadedModels()).to.deep.equal([catalog.llm.id]);
	});

	it("a failed load leaves the engine failed and empty", async () => {
		const d = deps([]);

		d.deps.create = () => {
			throw new Error("no adapter");
		};

		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		let message = "";

		try {
			await engine.load(catalog.llm, () => {});
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("no adapter");
		expect(engine.status()).to.equal("failed");
		expect(engine.loadedModels()).to.deep.equal([]);
	});

	it("a load whose reload throws releases the engine it created", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		const original = d.deps.create.bind(d.deps);

		d.deps.create = (appConfig, onProgress) => {
			const mlc = original(appConfig, onProgress);

			mlc.reload = () => {
				throw new Error("out of memory");
			};

			return mlc;
		};

		let message = "";

		try {
			await engine.load(catalog.llm, () => {});
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("out of memory");
		expect(d.calls.unload).to.equal(1);
		expect(engine.status()).to.equal("failed");
		expect(engine.loadedModels()).to.deep.equal([]);
	});
	it("a generation failure tears the engine down so the next request reloads", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});
		const original = d.calls;
		const mlc = d.deps.create({model_list: []}, () => {});
		mlc.chat.completions.create = () => Promise.reject(new Error("Device lost"));
		d.deps.create = () => mlc;
		await engine.unload();
		await engine.load(catalog.llm, () => {});
		let error: Error | null = null;

		try {
			for await (const _c of engine.translate(request(), new AbortController().signal)) {
				// consume
			}
		} catch (e) {
			error = e as Error;
		}

		expect(error).to.be.instanceOf(EngineError);
		expect((error as EngineError).cause).to.equal("request");
		expect(engine.isLoaded(catalog.llm.id)).to.equal(false);
		expect(engine.status()).to.equal("failed");
		expect(original.unload).to.be.greaterThan(0);
	});

	it("the second generation failure in a row is a load-class failure", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		const mlc = d.deps.create({model_list: []}, () => {});
		mlc.chat.completions.create = () => Promise.reject(new Error("Device lost"));
		d.deps.create = () => mlc;
		const causes: string[] = [];

		for (let i = 0; i < 2; i++) {
			await engine.load(catalog.llm, () => {});

			try {
				for await (const _c of engine.translate(request(), new AbortController().signal)) {
					// consume
				}
			} catch (e) {
				causes.push((e as EngineError).cause);
			}
		}

		expect(causes).to.deep.equal(["request", "load"]);
	});

	it("a different model gets its own reload grace", async () => {
		const d = deps([]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure({...catalog, llmLib: "https://m.test/lib.wasm"});
		const mlc = d.deps.create({model_list: []}, () => {});
		mlc.chat.completions.create = () => Promise.reject(new Error("Device lost"));
		d.deps.create = () => mlc;
		const other = {...catalog.llm, id: "other-model-q4f16_1-MLC"};
		const causes: string[] = [];

		for (const ref of [catalog.llm, other]) {
			await engine.load(ref, () => {});

			try {
				for await (const _c of engine.translate(
					request({model: ref.id}),
					new AbortController().signal
				)) {
					// consume
				}
			} catch (e) {
				causes.push((e as EngineError).cause);
			}
		}

		expect(causes).to.deep.equal(["request", "request"]);
	});

	it("a completed generation resets the failure count", async () => {
		const d = deps(["ok"]);
		const engine = new WebLlmEngine(d.deps, name);
		engine.configure(catalog);
		await engine.load(catalog.llm, () => {});

		for await (const _c of engine.translate(request(), new AbortController().signal)) {
			// consume
		}

		expect(engine.generationFailures).to.equal(0);
	});
});
