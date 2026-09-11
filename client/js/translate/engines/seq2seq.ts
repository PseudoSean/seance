// The CPU tier (spec § engines/seq2seq.ts): transformers.js translation
// pipelines on ONNX Runtime WASM. Two model families behind one engine,
// NLLB-200 (any pair, FLORES codes on every call) and OPUS-MT (one pair
// per model, no options). At most two pipelines stay loaded, evicted by
// last use. The library arrives through `Seq2seqDeps`; seq2seq.real.ts is
// its only import. A transformers.js pipeline call cannot be cancelled, so
// a cancelled request runs to completion and only its result is dropped
// (`signal.aborted` is checked after the call).

import {
	Engine,
	EngineCapabilities,
	EngineStatus,
	LoadProgress,
	ModelRef,
	TranslateChunk,
	TranslateRequest,
} from "../engine";
import {nllbCode} from "../languages";

export interface PipelineLike {
	(text: string, options: Record<string, string>): Promise<{translation_text: string}[]>;
	dispose(): Promise<void>;
}

export interface PipelineProgress {
	file: string;
	loaded: number;
	total: number;
}

export interface Seq2seqDeps {
	pipeline(modelId: string, onProgress: (p: PipelineProgress) => void): Promise<PipelineLike>;
	threads(): boolean;
}

export const SEQ2SEQ_MAX_LOADED = 2;

function isNllb(modelId: string): boolean {
	return /nllb/i.test(modelId);
}

export function translationOptions(req: TranslateRequest): Record<string, string> {
	if (!isNllb(req.model)) {
		return {};
	}

	const from = req.from ?? req.context.sourceHint ?? null;

	if (!from) {
		throw new Error("NLLB needs a source language");
	}

	const src = nllbCode(from);
	const tgt = nllbCode(req.to);

	if (!src) {
		throw new Error(`no NLLB code for ${from}`);
	}

	if (!tgt) {
		throw new Error(`no NLLB code for ${req.to}`);
	}

	return {src_lang: src, tgt_lang: tgt};
}

export class Seq2seqEngine implements Engine {
	readonly name = "seq2seq" as const;
	/** Insertion order is recency: the first entry is the least recently used. */
	private loaded = new Map<string, PipelineLike>();
	/** In-flight `deps.pipeline(...)` calls, deduped by model id. */
	private loading = new Map<string, Promise<PipelineLike>>();
	/** How many `translate()` calls are currently mid-`await pipe(...)` for a model. */
	private inUse = new Map<string, number>();
	private state: EngineStatus = "cold";
	private deps: Seq2seqDeps;

	constructor(deps: Seq2seqDeps) {
		this.deps = deps;
	}

	async load(ref: ModelRef, onProgress: (p: LoadProgress) => void): Promise<void> {
		if (this.loaded.has(ref.id)) {
			this.touch(ref.id);
			return;
		}

		const inFlight = this.loading.get(ref.id);

		if (inFlight) {
			await inFlight;
			return;
		}

		this.state = "loading";

		const files = new Map<string, PipelineProgress>();
		const promise = this.deps.pipeline(ref.id, (p) => {
			files.set(p.file, p);
			let loaded = 0;
			let total = 0;

			for (const file of files.values()) {
				loaded += file.loaded;
				total += file.total;
			}

			onProgress({fraction: total > 0 ? loaded / total : 0, text: p.file});
		});

		this.loading.set(ref.id, promise);

		let pipe: PipelineLike;

		try {
			pipe = await promise;
		} catch (e) {
			this.state = this.loaded.size > 0 ? "ready" : "failed";
			throw e;
		} finally {
			this.loading.delete(ref.id);
		}

		this.loaded.set(ref.id, pipe);
		this.state = "ready";
		await this.evict();
	}

	async unload(): Promise<void> {
		await Promise.allSettled([...this.loaded.values()].map((pipe) => pipe.dispose()));
		this.loaded.clear();
		this.inUse.clear();
		this.state = "cold";
	}

	status(): EngineStatus {
		return this.state;
	}

	loadedModels(): string[] {
		return [...this.loaded.keys()];
	}

	isLoaded(id: string): boolean {
		return this.loaded.has(id);
	}

	capabilities(): EngineCapabilities {
		return {streams: false, batches: false, threads: this.deps.threads()};
	}

	async *translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk> {
		if (req.lines) {
			throw new Error("seq2seq engines do not batch");
		}

		const pipe = this.loaded.get(req.model);

		if (!pipe) {
			throw new Error(`model not loaded: ${req.model}`);
		}

		this.touch(req.model);
		const options = translationOptions(req);
		this.inUse.set(req.model, (this.inUse.get(req.model) ?? 0) + 1);

		let result: {translation_text: string}[];

		// The eviction deferred while this pipeline was in use only resumes
		// once this `finally` runs, which requires the caller to drain the
		// generator (an abandoned generator pins the model in `inUse`).
		try {
			result = await pipe(req.text, options);
		} finally {
			const count = (this.inUse.get(req.model) ?? 1) - 1;

			if (count > 0) {
				this.inUse.set(req.model, count);
			} else {
				this.inUse.delete(req.model);
			}

			await this.evict();
		}

		if (signal.aborted) {
			return;
		}

		yield {id: req.id, text: (result[0]?.translation_text ?? "").trim(), done: true};
	}

	private touch(id: string): void {
		const pipe = this.loaded.get(id);

		if (pipe) {
			this.loaded.delete(id);
			this.loaded.set(id, pipe);
		}
	}

	private async evict(): Promise<void> {
		for (const id of this.loaded.keys()) {
			if (this.loaded.size <= SEQ2SEQ_MAX_LOADED) {
				break;
			}

			if ((this.inUse.get(id) ?? 0) > 0) {
				continue;
			}

			const pipe = this.loaded.get(id) as PipelineLike;

			this.loaded.delete(id);
			await pipe.dispose().catch(() => {});
		}
	}
}
