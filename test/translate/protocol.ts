import {expect} from "chai";
import {TranslateClient, TranslateError} from "../../client/js/translate/client";
import {EngineError, emptyContext, type ModelRef} from "../../client/js/translate/engine";
import {buildCatalog, type CacheApi} from "../../client/js/translate/models";
import {createPortPair} from "../../client/js/translate/protocol";
import {serveEngines} from "../../client/js/translate/worker";
import {FakeEngine} from "./fakeEngine";

const catalog = buildCatalog();
const llmRef: ModelRef = catalog.llm;
const nllbRef: ModelRef = catalog.nllb;

function rig(
	script: (text: string) => string[] = (t) => [t.slice(0, 1), t],
	configureError: Error | null = null
) {
	const [mainPort, workerPort] = createPortPair();
	const llm = new FakeEngine("llm", (req) => script(req.text));
	const seq2seq = new FakeEngine("seq2seq", (req) => [`[${req.to}] ${req.text}`]);
	const cached = new Set<string>();
	const cache: CacheApi = {
		has(ref) {
			return Promise.resolve(cached.has(ref.id));
		},
		delete(ref) {
			cached.delete(ref.id);
			return Promise.resolve();
		},
	};
	const configured: string[] = [];
	const stop = serveEngines(
		workerPort,
		{llm, seq2seq},
		{
			cache,
			configure(c, ortBase) {
				if (configureError) {
					throw configureError;
				}

				configured.push(`${c.llm.id}@${ortBase}`);
			},
		}
	);
	const client = new TranslateClient(mainPort);

	client.configure(catalog, "https://app.test/js/ort/");

	return {client, llm, seq2seq, cached, cache, configured, stop};
}

async function collect(iterable: AsyncIterable<{text: string; done: boolean}>) {
	const out: {text: string; done: boolean}[] = [];

	for await (const chunk of iterable) {
		out.push({text: chunk.text, done: chunk.done});
	}

	return out;
}

describe("translate/protocol", () => {
	it("configure reaches the worker", async () => {
		const {client, configured} = rig();

		await client.status();
		expect(configured).to.deep.equal([`${catalog.llm.id}@https://app.test/js/ort/`]);
	});

	it("load resolves after the engine loaded, reporting progress on the way", async () => {
		const {client, llm} = rig();
		const progress: number[] = [];

		await client.load(llmRef, (p) => progress.push(p.fraction));

		expect(llm.calls.load).to.deep.equal([llmRef]);
		// The port boundary posts a plain copy of every ref (client.ts), so a
		// reactive Proxy from a future call site cannot fail structured cloning.
		expect(Object.getPrototypeOf(llm.calls.load[0])).to.equal(Object.prototype);
		expect(progress).to.deep.equal([0.5, 1]);
		expect((await client.status()).llm).to.deep.equal({
			status: "ready",
			models: [llmRef.id],
		});
	});

	it("load rejects with the engine's message", async () => {
		const {client, llm} = rig();
		llm.failLoad = new Error("out of memory");
		let message = "";

		try {
			await client.load(llmRef);
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("out of memory");
		expect((await client.status()).llm.status).to.equal("failed");
	});

	it("translate streams the chunks in order and loads the model first when needed", async () => {
		const {client, llm} = rig();
		const chunks = await collect(
			client.translate(
				{
					id: 7,
					model: llmRef.id,
					text: "Hallo",
					from: "de",
					to: "en",
					purpose: "read",
					context: emptyContext(),
				},
				llmRef
			)
		);

		expect(llm.calls.load.length).to.equal(1);
		expect(chunks).to.deep.equal([
			{text: "H", done: false},
			{text: "Hallo", done: false},
			{text: "Hallo", done: true},
		]);
	});

	it("does not reload a model that is already loaded", async () => {
		const {client, seq2seq} = rig();
		const req = {
			id: 1,
			model: nllbRef.id,
			text: "x",
			from: "de",
			to: "en",
			purpose: "read" as const,
			context: emptyContext(),
		};

		await collect(client.translate(req, nllbRef));
		await collect(client.translate({...req, id: 2}, nllbRef));
		expect(seq2seq.calls.load.length).to.equal(1);
		expect(seq2seq.calls.translate.length).to.equal(2);
	});

	it("a failed translation rejects the stream", async () => {
		const {client, llm} = rig();
		await client.load(llmRef);
		llm.failTranslate = new Error("device lost");
		let message = "";

		try {
			await collect(
				client.translate(
					{
						id: 3,
						model: llmRef.id,
						text: "x",
						from: "de",
						to: "en",
						purpose: "read",
						context: emptyContext(),
					},
					llmRef
				)
			);
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("device lost");
	});

	it("leaving the stream early cancels the request in the worker", async () => {
		const {client, llm} = rig(() => ["a", "ab", "abc", "abcd"]);
		await client.load(llmRef);
		const seen: string[] = [];

		for await (const chunk of client.translate(
			{
				id: 4,
				model: llmRef.id,
				text: "x",
				from: "de",
				to: "en",
				purpose: "read",
				context: emptyContext(),
			},
			llmRef
		)) {
			seen.push(chunk.text);
			break;
		}

		// let the cancel message travel and the engine observe its signal
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(seen).to.deep.equal(["a"]);
		expect(llm.calls.translate.length).to.equal(1);
	});

	it("unload, models and delete round-trip", async () => {
		const {client, llm, cached} = rig();
		cached.add(nllbRef.id);

		await client.load(llmRef);
		await client.unload("llm");
		expect(llm.calls.unload).to.equal(1);
		expect((await client.status()).llm.status).to.equal("cold");

		const before = await client.models();

		expect(before.find((m) => m.ref.id === nllbRef.id)?.cached).to.equal(true);
		await client.deleteModel(nllbRef);
		const after = await client.models();

		expect(after.find((m) => m.ref.id === nllbRef.id)?.cached).to.equal(false);
	});

	it("dispose rejects everything still pending", async () => {
		const {client} = rig();
		const pending = client.status();

		client.dispose();
		let message = "";

		try {
			await pending;
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("translation worker disposed");
	});

	it("client.cancel() from inside the for-await ends the loop", async () => {
		const {client, llm} = rig(() => ["a", "ab", "abc", "abcd"]);
		await client.load(llmRef);
		const seen: string[] = [];
		const req = {
			id: 5,
			model: llmRef.id,
			text: "x",
			from: "de",
			to: "en",
			purpose: "read" as const,
			context: emptyContext(),
		};

		for await (const chunk of client.translate(req, llmRef)) {
			seen.push(chunk.text);
			client.cancel(req.id);
		}

		// let the cancel message travel and the engine observe its signal
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(seen).to.deep.equal(["a"]);
		expect(llm.calls.translate.length).to.equal(1);
	});

	it("two concurrent loads for the same model both resolve, sharing progress", async () => {
		const {client, llm} = rig();
		const progressA: number[] = [];
		const progressB: number[] = [];

		await Promise.all([
			client.load(llmRef, (p) => progressA.push(p.fraction)),
			client.load(llmRef, (p) => progressB.push(p.fraction)),
		]);

		expect(llm.calls.load.length).to.equal(1);
		expect(progressA).to.deep.equal([0.5, 1]);
		expect(progressB).to.deep.equal([0.5, 1]);
	});

	it("a throwing unload rejects with the engine's message", async () => {
		const {client, llm} = rig();

		llm.unload = () => {
			throw new Error("stuck");
		};

		let message = "";

		try {
			await client.unload("llm");
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("stuck");
	});

	it("translate of an unloaded model reports its load progress before the chunks", async () => {
		const {client} = rig();
		const events: string[] = [];
		const req = {
			id: 6,
			model: llmRef.id,
			text: "Hallo",
			from: "de",
			to: "en",
			purpose: "read" as const,
			context: emptyContext(),
		};

		for await (const chunk of client.translate(req, llmRef, (p) =>
			events.push(`progress:${p.fraction}`)
		)) {
			events.push(`chunk:${chunk.text}`);
		}

		expect(events.slice(0, 2)).to.deep.equal(["progress:0.5", "progress:1"]);
		expect(events.slice(2)).to.deep.equal(["chunk:H", "chunk:Hallo", "chunk:Hallo"]);
	});

	it("a duplicate translation request id throws synchronously", () => {
		const {client} = rig();
		const req = {
			id: 8,
			model: llmRef.id,
			text: "x",
			from: "de",
			to: "en",
			purpose: "read" as const,
			context: emptyContext(),
		};

		client.translate(req, llmRef);

		expect(() => client.translate({...req}, llmRef)).to.throw(
			"duplicate translation request id 8"
		);
	});

	it("a load that fails under a translation fails the stream as a load error", async () => {
		const {client, llm} = rig();

		llm.failLoad = new Error("out of memory");

		let error: unknown = null;

		try {
			await collect(
				client.translate(
					{
						id: 9,
						model: llmRef.id,
						text: "x",
						from: "de",
						to: "en",
						purpose: "read",
						context: emptyContext(),
					},
					llmRef
				)
			);
		} catch (e) {
			error = e;
		}

		expect(error).to.be.instanceOf(TranslateError);
		expect((error as TranslateError).cause).to.equal("load");
		expect((error as Error).message).to.equal("out of memory");
	});

	it("a failed translation is a request error, not the model's", async () => {
		const {client, llm} = rig();

		await client.load(llmRef);
		llm.failTranslate = new Error("seq2seq engines do not batch");

		let error: unknown = null;

		try {
			await collect(
				client.translate(
					{
						id: 10,
						model: llmRef.id,
						text: "x",
						from: "de",
						to: "en",
						purpose: "read",
						context: emptyContext(),
					},
					llmRef
				)
			);
		} catch (e) {
			error = e;
		}

		expect(error).to.be.instanceOf(TranslateError);
		expect((error as TranslateError).cause).to.equal("request");
	});

	it("a worker-scope error reaches onWorkerError", async () => {
		// rig() configures the client on the way out and the port delivers in a
		// microtask, so the listener set here is in place before it arrives.
		const {client} = rig(undefined, new Error("no WebAssembly"));
		const seen: string[] = [];

		client.onWorkerError = (message) => seen.push(message);

		await client.status();

		expect(seen).to.deep.equal(["no WebAssembly"]);
	});

	it("a throwing cache rejects models() but leaves the worker alive", async () => {
		const {client, cache} = rig();

		cache.has = () => {
			throw new Error("no cache storage");
		};

		let message = "";

		try {
			await client.models();
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("no cache storage");
		expect((await client.status()).llm.status).to.equal("cold");
	});

	it("a throwing snapshot rejects status() with the engine's message", async () => {
		const {client, llm} = rig();

		llm.loadedModels = () => {
			throw new Error("adapter lost");
		};

		let message = "";

		try {
			await client.status();
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("adapter lost");
	});

	it("a load-class EngineError from translate arrives as a load failure", async () => {
		const {client, llm} = rig();
		await client.load(llmRef);
		llm.failTranslate = new EngineError("device lost twice", "load");
		let caught: unknown = null;

		try {
			await collect(
				client.translate(
					{
						id: 9,
						model: llmRef.id,
						text: "x",
						from: "de",
						to: "en",
						purpose: "read",
						context: emptyContext(),
					},
					llmRef
				)
			);
		} catch (e) {
			caught = e;
		}

		expect(caught).to.be.instanceOf(TranslateError);
		expect((caught as TranslateError).cause).to.equal("load");
	});

	it("translate posts a plain copy, so a reactive Proxy inside the request cannot fail structured cloning", async () => {
		const {client, llm} = rig();
		await client.load(llmRef);
		const context = emptyContext();

		// A bare Proxy is enough: structured clone rejects any Proxy, which is
		// what a Vue reactive object is under the hood (Translation.vue's
		// channel term list, reached through `reader.ts`'s live channel settings).
		context.terms = new Proxy([["Seance", "Séance"]], {}) as [string, string][];

		await collect(
			client.translate(
				{
					id: 10,
					model: llmRef.id,
					text: "hi",
					from: "de",
					to: "en",
					purpose: "read",
					context,
				},
				llmRef
			)
		);

		const received = llm.calls.translate[llm.calls.translate.length - 1];

		expect(received.context.terms).to.deep.equal([["Seance", "Séance"]]);
		expect(received.text).to.equal("hi");
		expect(received.from).to.equal("de");
		expect(received.to).to.equal("en");
		expect(received.purpose).to.equal("read");
		expect(received.model).to.equal(llmRef.id);
	});
});
