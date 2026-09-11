import {expect} from "chai";
import {emptyContext, type TranslateRequest} from "../../client/js/translate/engine";
import {
	SEQ2SEQ_MAX_LOADED,
	Seq2seqEngine,
	translationOptions,
	type PipelineLike,
	type Seq2seqDeps,
} from "../../client/js/translate/engines/seq2seq";
import {buildCatalog} from "../../client/js/translate/models";

const catalog = buildCatalog();

function deps() {
	const calls = {
		pipeline: [] as string[],
		disposed: [] as string[],
		run: [] as [string, string, unknown][],
	};
	const failDispose = new Set<string>();
	const pending = new Map<string, Promise<void>>();
	const d: Seq2seqDeps = {
		pipeline(modelId, onProgress) {
			calls.pipeline.push(modelId);
			onProgress({file: "encoder.onnx", loaded: 50, total: 100});
			onProgress({file: "decoder.onnx", loaded: 0, total: 100});
			onProgress({file: "encoder.onnx", loaded: 100, total: 100});
			onProgress({file: "decoder.onnx", loaded: 100, total: 100});
			const pipe = ((text: string, options: unknown) => {
				calls.run.push([modelId, text, options]);

				const result = [{translation_text: `[${modelId}] ${text}`}];
				const block = pending.get(modelId);

				return block ? block.then(() => result) : Promise.resolve(result);
			}) as unknown as PipelineLike;

			pipe.dispose = () => {
				calls.disposed.push(modelId);

				return failDispose.has(modelId)
					? Promise.reject(new Error(`dispose failed: ${modelId}`))
					: Promise.resolve();
			};

			return Promise.resolve(pipe);
		},
		threads: () => false,
	};

	/** Blocks the next `translate()` call on this model until the returned function runs. */
	function gate(modelId: string): () => void {
		let release: () => void = () => {};

		const promise = new Promise<void>((resolve) => {
			release = resolve;
		});

		pending.set(modelId, promise);

		return () => {
			pending.delete(modelId);
			release();
		};
	}

	return {deps: d, calls, failDispose, gate};
}

function request(overrides: Partial<TranslateRequest> = {}): TranslateRequest {
	return {
		id: 1,
		model: catalog.nllb.id,
		text: "Hallo Welt",
		from: "de",
		to: "en",
		purpose: "read",
		context: emptyContext(),
		...overrides,
	};
}

describe("translate/engines/seq2seq", () => {
	it("translationOptions gives NLLB its FLORES codes and OPUS nothing", () => {
		expect(translationOptions(request())).to.deep.equal({
			src_lang: "deu_Latn",
			tgt_lang: "eng_Latn",
		});
		expect(translationOptions(request({model: "Xenova/opus-mt-de-en"}))).to.deep.equal({});
	});

	it("translationOptions falls back to the source hint and refuses an unknown pair", () => {
		expect(
			translationOptions(
				request({from: null, context: {...emptyContext(), sourceHint: "fr"}})
			)
		).to.deep.equal({src_lang: "fra_Latn", tgt_lang: "eng_Latn"});
		expect(() => translationOptions(request({from: null}))).to.throw(
			"NLLB needs a source language"
		);
		expect(() => translationOptions(request({to: "xx"}))).to.throw("no NLLB code for xx");
	});

	it("load creates the pipeline once and reports progress across files", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		const progress: number[] = [];

		await engine.load(catalog.nllb, (p) => progress.push(p.fraction));
		await engine.load(catalog.nllb, (p) => progress.push(p.fraction));

		expect(d.calls.pipeline).to.deep.equal([catalog.nllb.id]);
		expect(progress).to.deep.equal([0.5, 0.25, 0.5, 1]);
		expect(engine.status()).to.equal("ready");
		expect(engine.isLoaded(catalog.nllb.id)).to.equal(true);
	});

	it("translate yields once, done, with the pipeline's text", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		await engine.load(catalog.nllb, () => {});
		const chunks: {text: string; done: boolean}[] = [];

		for await (const chunk of engine.translate(request(), new AbortController().signal)) {
			chunks.push({text: chunk.text, done: chunk.done});
		}

		expect(chunks).to.deep.equal([{text: `[${catalog.nllb.id}] Hallo Welt`, done: true}]);
		expect(d.calls.run[0][2]).to.deep.equal({src_lang: "deu_Latn", tgt_lang: "eng_Latn"});
	});

	it("keeps two models and evicts the least recently used", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		const a = catalog.opus["de-en"];
		const b = catalog.opus["fr-en"];
		const c = catalog.opus["es-en"];

		expect(SEQ2SEQ_MAX_LOADED).to.equal(2);
		await engine.load(a, () => {});
		await engine.load(b, () => {});

		// use a, so b is the least recently used
		for await (const _chunk of engine.translate(
			request({model: a.id}),
			new AbortController().signal
		)) {
			// consume
		}

		await engine.load(c, () => {});
		expect(d.calls.disposed).to.deep.equal([b.id]);
		expect(engine.loadedModels()).to.deep.equal([a.id, c.id]);
	});

	it("refuses batched requests and unknown models", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		await engine.load(catalog.nllb, () => {});
		const messages: string[] = [];

		for (const req of [request({lines: ["a", "b"]}), request({model: "nope"})]) {
			try {
				for await (const _c of engine.translate(req, new AbortController().signal)) {
					// consume
				}
			} catch (e) {
				messages.push((e as Error).message);
			}
		}

		expect(messages).to.deep.equal(["seq2seq engines do not batch", "model not loaded: nope"]);
	});

	it("unload disposes everything; a failed load keeps the others", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		await engine.load(catalog.nllb, () => {});

		d.deps.pipeline = () => Promise.reject(new Error("404"));

		let message = "";

		try {
			await engine.load(catalog.opus["de-en"], () => {});
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("404");
		expect(engine.status()).to.equal("ready");
		expect(engine.loadedModels()).to.deep.equal([catalog.nllb.id]);
		await engine.unload();
		expect(d.calls.disposed).to.deep.equal([catalog.nllb.id]);
		expect(engine.status()).to.equal("cold");
		expect(engine.capabilities()).to.deep.equal({
			streams: false,
			batches: false,
			threads: false,
		});
	});

	it("dedupes two concurrent loads of the same model", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);

		await Promise.all([
			engine.load(catalog.nllb, () => {}),
			engine.load(catalog.nllb, () => {}),
		]);

		expect(d.calls.pipeline).to.deep.equal([catalog.nllb.id]);
		expect(engine.isLoaded(catalog.nllb.id)).to.equal(true);
	});

	it("never evicts a pipeline mid-translate, and re-admits it to eviction once free", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		const a = catalog.opus["de-en"];
		const b = catalog.opus["fr-en"];
		const c = catalog.opus["es-en"];
		const e = catalog.opus["it-en"];

		await engine.load(a, () => {});
		await engine.load(b, () => {});

		const release = d.gate(a.id);
		const consumed = (async () => {
			const chunks: {text: string; done: boolean}[] = [];

			for await (const chunk of engine.translate(
				request({model: a.id}),
				new AbortController().signal
			)) {
				chunks.push({text: chunk.text, done: chunk.done});
			}

			return chunks;
		})();

		// a is mid-translate (blocked on the gate): loading a third model must
		// evict b, the least recently used pipeline that is not in use, and
		// must not touch a.
		await engine.load(c, () => {});
		expect(d.calls.disposed).to.deep.equal([b.id]);
		expect(engine.loadedModels()).to.deep.equal([a.id, c.id]);

		release();
		const chunks = await consumed;

		expect(chunks).to.deep.equal([{text: `[${a.id}] Hallo Welt`, done: true}]);
		// a's translate has ended, but the cache is not over capacity, so
		// nothing is evicted yet — a is merely eligible again.
		expect(d.calls.disposed).to.deep.equal([b.id]);
		expect(engine.loadedModels()).to.deep.equal([a.id, c.id]);

		// Now that a is free, it is the least recently used pipeline and a
		// fourth model finally evicts it.
		await engine.load(e, () => {});
		expect(d.calls.disposed).to.deep.equal([b.id, a.id]);
		expect(engine.loadedModels()).to.deep.equal([c.id, e.id]);
	});

	it("unload resolves even if a dispose throws, and attempts every pipeline", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		const a = catalog.opus["de-en"];
		const b = catalog.opus["fr-en"];

		await engine.load(a, () => {});
		await engine.load(b, () => {});
		d.failDispose.add(a.id);

		await engine.unload();

		expect(d.calls.disposed).to.deep.equal([a.id, b.id]);
		expect(engine.status()).to.equal("cold");
		expect(engine.loadedModels()).to.deep.equal([]);
	});

	it("an eviction whose dispose throws still lets the new model load", async () => {
		const d = deps();
		const engine = new Seq2seqEngine(d.deps);
		const a = catalog.opus["de-en"];
		const b = catalog.opus["fr-en"];
		const c = catalog.opus["es-en"];

		await engine.load(a, () => {});
		await engine.load(b, () => {});
		d.failDispose.add(a.id);

		await engine.load(c, () => {});

		expect(d.calls.disposed).to.deep.equal([a.id]);
		expect(engine.status()).to.equal("ready");
		expect(engine.loadedModels()).to.deep.equal([b.id, c.id]);
	});
});
