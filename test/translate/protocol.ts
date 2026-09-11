import {expect} from "chai";
import {TranslateClient} from "../../client/js/translate/client";
import {emptyContext, type ModelRef} from "../../client/js/translate/engine";
import {buildCatalog, type CacheApi} from "../../client/js/translate/models";
import {createPortPair} from "../../client/js/translate/protocol";
import {serveEngines} from "../../client/js/translate/worker";
import {FakeEngine} from "./fakeEngine";

const catalog = buildCatalog();
const llmRef: ModelRef = catalog.llm;
const nllbRef: ModelRef = catalog.nllb;

function rig(script: (text: string) => string[] = (t) => [t.slice(0, 1), t]) {
	const [mainPort, workerPort] = createPortPair();
	const llm = new FakeEngine("llm", (req) => script(req.text));
	const seq2seq = new FakeEngine("seq2seq", (req) => [`[${req.to}] ${req.text}`]);
	const cached = new Set<string>();
	const cache: CacheApi = {
		has: async (ref) => cached.has(ref.id),
		delete: async (ref) => {
			cached.delete(ref.id);
		},
	};
	const configured: string[] = [];
	const stop = serveEngines(
		workerPort,
		{llm, seq2seq},
		{
			cache,
			configure: (c, ortBase) => configured.push(`${c.llm.id}@${ortBase}`),
		}
	);
	const client = new TranslateClient(mainPort);

	client.configure(catalog, "https://app.test/js/ort/");

	return {client, llm, seq2seq, cached, configured, stop};
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
});
