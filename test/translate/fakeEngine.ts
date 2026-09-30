import type {
	Engine,
	EngineName,
	EngineStatus,
	LoadProgress,
	ModelRef,
	TranslateChunk,
	TranslateRequest,
} from "../../client/js/translate/engine";

/**
 * A scripted engine: `script(req)` returns the cumulative chunk texts to
 * yield; the last one is repeated with `done: true`. `failLoad` /
 * `failTranslate` make the next call reject; `loadTicks` is how many
 * progress reports a load emits before resolving.
 */
export class FakeEngine implements Engine {
	readonly name: EngineName;
	calls = {load: [] as ModelRef[], translate: [] as TranslateRequest[], unload: 0};
	failLoad: Error | null = null;
	failTranslate: Error | null = null;
	loadTicks = 2;
	private loaded: string[] = [];
	private state: EngineStatus = "cold";

	constructor(name: EngineName, private script: (req: TranslateRequest) => string[]) {
		this.name = name;
	}

	async load(ref: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void> {
		this.calls.load.push(ref);
		this.state = "loading";

		if (this.failLoad) {
			const error = this.failLoad;
			this.failLoad = null;
			this.state = "failed";
			throw error;
		}

		for (let i = 1; i <= this.loadTicks; i++) {
			await Promise.resolve();
			onProgress({fraction: i / this.loadTicks, text: `part ${i}`});
		}

		if (this.name === "llm") {
			this.loaded = [ref.id];
		} else if (!this.loaded.includes(ref.id)) {
			this.loaded.push(ref.id);
		}

		this.state = "ready";
	}

	unload(): Promise<void> {
		this.calls.unload++;
		this.loaded = [];
		this.state = "cold";
		return Promise.resolve();
	}

	status(): EngineStatus {
		return this.state;
	}

	loadedModels(): string[] {
		return [...this.loaded];
	}

	isLoaded(id: string): boolean {
		return this.loaded.includes(id);
	}

	capabilities() {
		return {streams: this.name === "llm", batches: this.name === "llm"};
	}

	async *translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk> {
		this.calls.translate.push(req);

		if (!this.isLoaded(req.model)) {
			throw new Error(`model not loaded: ${req.model}`);
		}

		if (this.failTranslate) {
			const error = this.failTranslate;
			this.failTranslate = null;
			throw error;
		}

		const texts = this.script(req);

		for (const text of texts) {
			if (signal.aborted) {
				return;
			}

			await Promise.resolve();
			yield {id: req.id, text, done: false};
		}

		if (!signal.aborted) {
			yield {id: req.id, text: texts[texts.length - 1] ?? "", done: true};
		}
	}
}
