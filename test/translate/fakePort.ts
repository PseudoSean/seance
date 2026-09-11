import {expect} from "chai";
import {TranslateClient} from "../../client/js/translate/client";
import {emptyContext} from "../../client/js/translate/engine";
import {FAKE_CAPABILITY, fakePort} from "../../client/js/translate/fakePort";
import {buildCatalog} from "../../client/js/translate/models";

const catalog = buildCatalog();

describe("translate/fakePort", () => {
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
});
