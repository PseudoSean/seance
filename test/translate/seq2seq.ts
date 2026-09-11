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
	const d: Seq2seqDeps = {
		pipeline(modelId, onProgress) {
			calls.pipeline.push(modelId);
			onProgress({file: "encoder.onnx", loaded: 50, total: 100});
			onProgress({file: "decoder.onnx", loaded: 0, total: 100});
			onProgress({file: "encoder.onnx", loaded: 100, total: 100});
			onProgress({file: "decoder.onnx", loaded: 100, total: 100});
			const pipe = ((text: string, options: unknown) => {
				calls.run.push([modelId, text, options]);

				return Promise.resolve([{translation_text: `[${modelId}] ${text}`}]);
			}) as unknown as PipelineLike;

			pipe.dispose = () => {
				calls.disposed.push(modelId);

				return Promise.resolve();
			};

			return Promise.resolve(pipe);
		},
		threads: () => false,
	};

	return {deps: d, calls};
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
});
