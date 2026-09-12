import {expect} from "chai";
import {TranslateClient} from "../../client/js/translate/client";
import {emptyContext} from "../../client/js/translate/engine";
import {FAKE_CAPABILITY, fakePort} from "../../client/js/translate/fakePort";
import {buildCatalog} from "../../client/js/translate/models";
import {parseBatchedOutput} from "../../client/js/translate/prompt";

const catalog = buildCatalog();

describe("translate/fakePort", () => {
	afterEach(() => {
		delete globalThis.__seanceTranslateFake;
	});

	it("downloads with progress, remembers the cache, deletes, and echoes a translation", async () => {
		const {port, terminate} = fakePort({stepMs: 0});
		const client = new TranslateClient(port);

		client.configure(catalog, "https://app.test/js/ort/");
		const progress: number[] = [];

		await client.load(catalog.llm, (p) => progress.push(p.fraction));
		expect(progress.length).to.be.greaterThan(2);
		expect(progress[progress.length - 1]).to.equal(1);
		expect((await client.models()).find((m) => m.ref.id === catalog.llm.id)?.cached).to.equal(
			true
		);

		const chunks: string[] = [];

		for await (const chunk of client.translate(
			{
				id: 1,
				model: catalog.llm.id,
				text: "Hallo Welt",
				from: "de",
				to: "en",
				purpose: "read",
				context: emptyContext(),
			},
			catalog.llm
		)) {
			chunks.push(chunk.text);
		}

		expect(chunks[chunks.length - 1]).to.equal("[English] Hallo Welt");
		expect(chunks.length).to.be.greaterThan(1);

		await client.deleteModel(catalog.llm);
		expect((await client.models()).find((m) => m.ref.id === catalog.llm.id)?.cached).to.equal(
			false
		);
		expect(FAKE_CAPABILITY.tier).to.equal("gpu");
		terminate();
	});

	it("answers a batched request as numbered lines closed by END, and logs the request", async () => {
		const {port, terminate} = fakePort({stepMs: 0});
		const client = new TranslateClient(port);

		client.configure(catalog, "https://app.test/js/ort/");
		await client.load(catalog.llm, () => {});

		const lines = ["Hallo", "Wie geht es dir", "Tschüss"];
		let last = "";

		for await (const chunk of client.translate(
			{
				id: 2,
				model: catalog.llm.id,
				text: "",
				lines,
				from: "de",
				to: "en",
				purpose: "read",
				context: emptyContext(),
			},
			catalog.llm
		)) {
			last = chunk.text;
		}

		expect(last.trim().endsWith("END")).to.equal(true);
		const parsed = parseBatchedOutput(last, lines.length);
		expect(parsed).to.not.equal(null);
		expect(parsed).to.deep.equal(lines.map((l) => `[English] ${l}`));

		expect(globalThis.__seanceTranslateFake?.requests).to.have.length(1);
		expect(globalThis.__seanceTranslateFake?.requests[0]).to.deep.equal({
			id: 2,
			model: catalog.llm.id,
			text: "",
			purpose: "read",
			lines: 3,
			engine: "llm",
		});

		terminate();
	});

	it("fails a request carrying [fail] once, then succeeds the same text again", async () => {
		const {port, terminate} = fakePort({stepMs: 0});
		const client = new TranslateClient(port);

		client.configure(catalog, "https://app.test/js/ort/");
		await client.load(catalog.llm, () => {});

		const req = {
			id: 3,
			model: catalog.llm.id,
			text: "this line will [fail] once",
			from: "de",
			to: "en",
			purpose: "read" as const,
			context: emptyContext(),
		};

		let threw = false;

		try {
			for await (const _chunk of client.translate(req, catalog.llm)) {
				// draining
			}
		} catch (e) {
			threw = true;
		}

		expect(threw).to.equal(true);

		const chunks: string[] = [];

		for await (const chunk of client.translate(req, catalog.llm)) {
			chunks.push(chunk.text);
		}

		expect(chunks[chunks.length - 1]).to.equal("[English] this line will [fail] once");
		terminate();

		// The one-shot is the engine instance's, not the module's: a fresh
		// page (a scenario reload) fails the same text again.
		const second = fakePort({stepMs: 0});
		const reloaded = new TranslateClient(second.port);

		reloaded.configure(catalog, "https://app.test/js/ort/");
		await reloaded.load(catalog.llm, () => {});

		let threwAgain = false;

		try {
			for await (const _chunk of reloaded.translate(req, catalog.llm)) {
				// draining
			}
		} catch (e) {
			threwAgain = true;
		}

		expect(threwAgain).to.equal(true);
		second.terminate();
	});
});
