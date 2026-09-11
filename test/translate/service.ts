import {expect} from "chai";
import sinon from "ts-sinon";
import type {Capability} from "../../client/js/translate/capability";
import {emptyContext} from "../../client/js/translate/engine";
import {buildCatalog, type CacheApi} from "../../client/js/translate/models";
import {createPortPair} from "../../client/js/translate/protocol";
import {DEFAULT_ROUTES} from "../../client/js/translate/routes.default";
import {TranslateClient, WORKER_DISPOSED} from "../../client/js/translate/client";
import {
	IDLE_UNLOAD_MS,
	TRANSLATION_UNAVAILABLE,
	TranslateService,
	type ServiceDeps,
} from "../../client/js/translate/service";
import {serveEngines} from "../../client/js/translate/worker";
import {FakeEngine} from "./fakeEngine";

const catalog = buildCatalog();

function capability(tier: Capability["tier"]): Capability {
	return {
		tier,
		reasons: tier === "gpu" ? [] : ["no WebGPU"],
		f16: tier === "gpu",
		maxBufferBytes: 0,
		deviceMemoryGiB: 8,
		storageQuotaBytes: null,
	};
}

function rig(tier: Capability["tier"] = "gpu", enabled = true) {
	const clock = sinon.useFakeTimers();
	const workers: {terminated: boolean}[] = [];
	const cached = new Set<string>();
	let failDelete: Error | null = null;
	const cache: CacheApi = {
		has(ref) {
			return Promise.resolve(cached.has(ref.id));
		},
		delete(ref) {
			if (failDelete) {
				const error = failDelete;

				failDelete = null;

				return Promise.reject(error);
			}

			cached.delete(ref.id);

			return Promise.resolve();
		},
	};
	const llm = new FakeEngine("llm", (req) => [`llm:${req.text}`]);
	const seq2seq = new FakeEngine("seq2seq", (req) => [`seq:${req.text}`]);
	const deps: ServiceDeps = {
		createClient() {
			const [mainPort, workerPort] = createPortPair();
			const entry = {terminated: false};

			workers.push(entry);
			const stop = serveEngines(workerPort, {llm, seq2seq}, {cache, configure() {}});

			return {
				client: new TranslateClient(mainPort),
				terminate() {
					entry.terminated = true;
					stop();
				},
			};
		},
		probe() {
			return Promise.resolve(capability(tier));
		},
		setTimeout: (fn, ms) => setTimeout(fn, ms),
		clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
	};
	const service = new TranslateService(
		deps,
		{catalog, routes: DEFAULT_ROUTES, ortBase: "https://app.test/js/ort/", enabled},
		{llm: true, cpu: true}
	);

	return {
		service,
		workers,
		cached,
		clock,
		llm,
		seq2seq,
		failNextDelete(error: Error) {
			failDelete = error;
		},
	};
}

async function text(iterable: AsyncIterable<{text: string; done: boolean}>) {
	let last = "";

	for await (const chunk of iterable) {
		last = chunk.text;
	}

	return last;
}

const base = {
	text: "Hallo",
	from: "de",
	to: "en",
	purpose: "read" as const,
	context: emptyContext(),
};

describe("translate/service", () => {
	let clock: sinon.SinonFakeTimers | null = null;

	afterEach(() => {
		clock?.restore();
		clock = null;
	});

	it("routes to the LLM on a gpu device and to a CPU model otherwise", async () => {
		const gpu = rig("gpu");
		clock = gpu.clock;
		expect((await gpu.service.route("de", "en"))?.candidate).to.equal("llm");
		expect(await text(gpu.service.translate(base))).to.equal("llm:Hallo");
		expect(gpu.llm.calls.load.map((r) => r.id)).to.deep.equal([catalog.llm.id]);
		gpu.service.dispose();
		gpu.clock.restore();

		const cpu = rig("cpu");
		clock = cpu.clock;
		expect((await cpu.service.route("de", "en"))?.candidate).to.equal("opus:de-en");
		expect(await text(cpu.service.translate(base))).to.equal("seq:Hallo");
		cpu.service.dispose();
	});

	it("marks a candidate down when its model fails to load and takes the next", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.capabilities();
		// the worker exists only after the first request; create it, then break the LLM
		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		await r.llm.unload();
		r.llm.failLoad = new Error("device lost");
		expect(await text(r.service.translate({...base, text: "Zwei"}))).to.equal("seq:Zwei");
		expect((await r.service.route("de", "en"))?.candidate).to.equal("opus:de-en");
		r.service.dispose();
	});

	it("gives up when no candidate is left", async () => {
		const r = rig("none");
		clock = r.clock;
		let message = "";

		try {
			await text(r.service.translate(base));
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal(TRANSLATION_UNAVAILABLE);
		r.service.dispose();
	});

	it("the engine settings narrow the route", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.service.setSettings({llm: false, cpu: true});
		expect((await r.service.route("de", "en"))?.candidate).to.equal("opus:de-en");
		r.service.setSettings({llm: false, cpu: false});
		expect(await r.service.route("de", "en")).to.equal(null);
		r.service.dispose();
	});

	it("unloads and terminates the worker after ten idle minutes, not while a request runs", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await text(r.service.translate(base));
		expect(r.workers.length).to.equal(1);
		await r.clock.tickAsync(IDLE_UNLOAD_MS - 1);
		expect(r.workers[0].terminated).to.equal(false);
		await r.clock.tickAsync(1);
		expect(r.workers[0].terminated).to.equal(true);
		// the next request starts a fresh worker
		await text(r.service.translate(base));
		expect(r.workers.length).to.equal(2);
		r.service.dispose();
	});

	it("pagehide unloads at once", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await text(r.service.translate(base));
		r.service.pagehide();
		expect(r.workers[0].terminated).to.equal(true);
		r.service.dispose();
	});

	it("models() lists the catalog with cached flags and download/delete move them", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const seen: string[][] = [];

		r.service.onModels((views) =>
			seen.push(views.map((v) => `${v.ref.id}:${v.status}:${v.cached}`))
		);
		const views = await r.service.models();

		expect(views.map((v) => v.ref.id)).to.deep.equal([
			catalog.llm.id,
			catalog.nllb.id,
			...Object.values(catalog.opus).map((o) => o.id),
		]);
		expect(views.every((v) => !v.cached && v.status === "idle")).to.equal(true);

		await r.service.download(catalog.nllb);
		r.cached.add(catalog.nllb.id);
		const after = await r.service.models();
		const nllb = after.find((v) => v.ref.id === catalog.nllb.id);

		expect(nllb).to.include({cached: true, status: "ready", fraction: 1});
		expect(seen.some((s) => s.includes(`${catalog.nllb.id}:downloading:false`))).to.equal(true);

		await r.service.deleteModel(catalog.nllb);
		const gone = (await r.service.models()).find((v) => v.ref.id === catalog.nllb.id);

		expect(gone).to.include({cached: false, status: "idle"});
		r.service.dispose();
	});

	it("a failed download is reported on the view", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.models();
		r.llm.failLoad = new Error("out of memory");
		let message = "";

		try {
			await r.service.download(catalog.llm);
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("out of memory");
		const view = (await r.service.models()).find((v) => v.ref.id === catalog.llm.id);

		expect(view).to.include({status: "failed", error: "out of memory"});
		r.service.dispose();
	});

	it("a disabled deploy has no worker and no route", async () => {
		const r = rig("gpu", false);
		clock = r.clock;
		expect(r.service.enabled).to.equal(false);
		expect(await r.service.route("de", "en")).to.equal(null);
		expect(await r.service.models()).to.deep.equal([]);
		expect(r.workers.length).to.equal(0);
		r.service.dispose();
	});

	it("a teardown during a translation aborts it without marking the candidate down", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.llm.loadTicks = 50;
		let intervened = false;

		r.service.onModels((views) => {
			const llmView = views.find((v) => v.ref.id === catalog.llm.id);

			if (!intervened && llmView?.status === "downloading") {
				intervened = true;
				r.service.pagehide();
			}
		});

		let message = "";

		try {
			await text(r.service.translate(base));
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal(WORKER_DISPOSED);
		expect(r.workers.length).to.equal(1);
		expect((await r.service.route("de", "en"))?.candidate).to.equal("llm");
		r.service.dispose();
	});

	it("an implicit download during a translation shows on the views", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const seen: {status: string; cached: boolean}[] = [];

		r.service.onModels((views) => {
			const llmView = views.find((v) => v.ref.id === catalog.llm.id);

			if (llmView) {
				seen.push({status: llmView.status, cached: llmView.cached});
			}
		});

		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		expect(seen.some((s) => s.status === "downloading")).to.equal(true);
		expect(seen[seen.length - 1]).to.deep.equal({status: "ready", cached: true});
		r.service.dispose();
	});

	it("models() clears a failed view once the model is cached", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.seq2seq.failLoad = new Error("boom");
		let message = "";

		try {
			await r.service.download(catalog.nllb);
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("boom");
		r.cached.add(catalog.nllb.id);
		const view = (await r.service.models()).find((v) => v.ref.id === catalog.nllb.id);

		expect(view).to.include({status: "ready", error: null, cached: true});
		r.service.dispose();
	});

	it("a failed delete is recorded on the view", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.failNextDelete(new Error("locked"));
		let message = "";

		try {
			await r.service.deleteModel(catalog.nllb);
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("locked");
		const view = (await r.service.models()).find((v) => v.ref.id === catalog.nllb.id);

		expect(view).to.include({status: "failed", error: "locked"});
		r.service.dispose();
	});

	it("dispose is terminal", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await text(r.service.translate(base));
		expect(r.workers.length).to.equal(1);
		r.service.dispose();

		let message = "";

		try {
			await text(r.service.translate(base));
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal(TRANSLATION_UNAVAILABLE);
		expect(r.workers.length).to.equal(1);
	});
});
