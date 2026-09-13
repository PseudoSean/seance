import {expect} from "chai";
import sinon from "ts-sinon";
import type {Capability} from "../../client/js/translate/capability";
import {emptyContext} from "../../client/js/translate/engine";
import {
	QWEN3_1_7B_ID,
	QWEN3_4B_ID,
	buildCatalog,
	type CacheApi,
} from "../../client/js/translate/models";
import {createPortPair} from "../../client/js/translate/protocol";
import type {RouteTable} from "../../client/js/translate/router";
import {DEFAULT_ROUTES} from "../../client/js/translate/routes.default";
import {TranslateClient, WORKER_DISPOSED} from "../../client/js/translate/client";
import {
	CPU_IDLE_UNLOAD_MS,
	GPU_IDLE_UNLOAD_MS,
	TRANSLATION_UNAVAILABLE,
	TranslateService,
	downloadNote,
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

function rig(
	tier: Capability["tier"] = "gpu",
	enabled = true,
	routes: RouteTable = DEFAULT_ROUTES
) {
	const clock = sinon.useFakeTimers();
	const workers: {terminated: boolean}[] = [];
	const cached = new Set<string>();
	let failDelete: Error | null = null;
	let failConfigure: Error | null = null;
	let hangDelete = false;
	const cache: CacheApi = {
		has(ref) {
			return Promise.resolve(cached.has(ref.id));
		},
		delete(ref) {
			if (hangDelete) {
				return new Promise<void>(() => {});
			}

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
			const stop = serveEngines(
				workerPort,
				{llm, seq2seq},
				{
					cache,
					configure() {
						if (failConfigure) {
							const error = failConfigure;

							failConfigure = null;

							throw error;
						}
					},
				}
			);

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
		{catalog, routesFor: () => routes, ortBase: "https://app.test/js/ort/", enabled},
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
		failNextConfigure(error: Error) {
			failConfigure = error;
		},
		hangNextDelete() {
			hangDelete = true;
		},
	};
}

/** Hold the rig's first LLM request before its first chunk until the returned function is called. */
function gateLlm(r: ReturnType<typeof rig>): () => void {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const original = r.llm.translate.bind(r.llm);
	let first = true;

	r.llm.translate = async function* (req, signal) {
		if (first) {
			first = false;
			await gate;
		}

		yield* original(req, signal);
	};

	return release;
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

	it("a seq2seq route takes the source hint as its source; the LLM keeps from: null", async () => {
		const hinted = {...base, from: null, context: {...emptyContext(), sourceHint: "de"}};
		const cpu = rig("cpu");
		clock = cpu.clock;

		expect((await cpu.service.route(null, "en", "de"))?.candidate).to.equal("opus:de-en");
		expect(await text(cpu.service.translate(hinted))).to.equal("seq:Hallo");
		expect(cpu.seq2seq.calls.translate[0].from).to.equal("de");
		cpu.service.dispose();
		cpu.clock.restore();

		const gpu = rig("gpu");
		clock = gpu.clock;

		expect(await text(gpu.service.translate(hinted))).to.equal("llm:Hallo");
		expect(gpu.llm.calls.translate[0].from).to.equal(null);
		gpu.service.dispose();
	});

	it("the request's routing hint wins over the context's and never changes the prompt context", async () => {
		const r = rig("cpu");
		clock = r.clock;
		const request = {
			...base,
			from: null,
			hint: "de",
			context: {...emptyContext(), sourceHint: "fr"},
		};

		expect(await text(r.service.translate(request))).to.equal("seq:Hallo");
		expect(r.seq2seq.calls.translate[0].from).to.equal("de");
		expect(r.seq2seq.calls.translate[0].context.sourceHint).to.equal("fr");
		r.service.dispose();
	});

	it("a download started from Settings does not move loadTicks on its own", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const ticks = r.service.loadTicks();

		await r.service.download(catalog.nllb);

		expect(r.service.loadTicks()).to.equal(ticks);
		r.service.dispose();
	});

	it("the first route knows what is downloaded without Settings having asked", async () => {
		const r = rig("gpu", true, {en: {de: [["llm", "opus:de-en"]]}});
		clock = r.clock;
		r.cached.add(catalog.opus["de-en"].id);

		expect((await r.service.route("de", "en"))?.candidate).to.equal("opus:de-en");
		r.service.dispose();
	});

	it("a better class is downloaded on demand rather than skipped for a downloaded worse one", async () => {
		const r = rig("gpu", true, {en: {sw: ["nllb", "llm"]}});
		clock = r.clock;
		r.cached.add(catalog.llm.id);
		const seen: string[] = [];

		r.service.onModels((views) => {
			const nllb = views.find((v) => v.ref.id === catalog.nllb.id);

			if (nllb) {
				seen.push(nllb.status);
			}
		});

		const ticks = r.service.loadTicks();

		expect(await text(r.service.translate({...base, from: "sw"}))).to.equal("seq:Hallo");
		expect(r.seq2seq.calls.load.map((ref) => ref.id)).to.deep.equal([catalog.nllb.id]);
		expect(r.llm.calls.load).to.deep.equal([]);
		expect(seen).to.include("downloading");
		// The deadlines of the queue and the composer watch this counter.
		expect(r.service.loadTicks()).to.be.greaterThan(ticks);
		r.service.dispose();
	});

	it("a better class whose download fails falls to the next class, the reason kept", async () => {
		const r = rig("gpu", true, {en: {sw: ["nllb", "llm"]}});
		clock = r.clock;
		r.seq2seq.failLoad = new Error("quota exceeded");

		expect(await text(r.service.translate({...base, from: "sw"}))).to.equal("llm:Hallo");
		expect((await r.service.route("sw", "en"))?.candidate).to.equal("llm");

		const views = await r.service.models();

		expect(views.find((v) => v.ref.id === catalog.nllb.id)?.error).to.equal("quota exceeded");
		r.service.dispose();
	});

	it("downloadNote names the model and how far its download has got", () => {
		expect(
			downloadNote({
				ref: catalog.nllb,
				cached: false,
				status: "downloading",
				fraction: 0.424,
				error: null,
			})
		).to.equal("Downloading NLLB-200 600M (CPU, 200 languages)\u2026 42%");
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

	it("a load failure lands on the model view and travels with the error", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.models();
		r.llm.failLoad = new Error("device lost");
		// failLoad is one-shot; both seq2seq candidates (the OPUS pair, then
		// NLLB) have to refuse for the loop to run out of route.
		r.seq2seq.load = () => Promise.reject(new Error("Can't create a session"));

		let message = "";

		try {
			await text(r.service.translate(base));
		} catch (e) {
			message = (e as Error).message;
		}

		// The generic message would say nothing about why the tier is dead;
		// the last candidate's model and reason ride with it.
		expect(message).to.equal(
			`${TRANSLATION_UNAVAILABLE}: ${catalog.nllb.id}: Can't create a session`
		);

		const views = await r.service.models();

		expect(views.find((v) => v.ref.id === catalog.llm.id)).to.include({
			status: "failed",
			error: "device lost",
		});
		expect(views.find((v) => v.ref.id === catalog.opus["de-en"].id)).to.include({
			status: "failed",
			error: "Can't create a session",
		});
		r.service.dispose();
	});

	it("a request the model cannot serve is reported, not blamed on the model", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.llm.failTranslate = new Error("no NLLB code for xx");

		let message = "";

		try {
			await text(r.service.translate(base));
		} catch (e) {
			message = (e as Error).message;
		}

		expect(message).to.equal("no NLLB code for xx");
		// not retried on the next candidate, and the LLM is still the route
		expect(r.seq2seq.calls.translate.length).to.equal(0);
		expect((await r.service.route("de", "en"))?.candidate).to.equal("llm");
		r.service.dispose();
	});

	it("downloading a model that failed puts its candidate back in the route", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.llm.failLoad = new Error("device lost");

		expect(await text(r.service.translate(base))).to.equal("seq:Hallo");
		expect((await r.service.route("de", "en"))?.candidate).to.equal("opus:de-en");

		await r.service.download(catalog.llm);

		expect((await r.service.route("de", "en"))?.candidate).to.equal("llm");
		r.service.dispose();
	});

	it("a download and a translation of the same model share one load", async () => {
		const r = rig("gpu");
		clock = r.clock;
		// long enough that the translation certainly arrives while Settings'
		// download is still running: it must join that load, not start a second
		r.llm.loadTicks = 50;

		const [, translated] = await Promise.all([
			r.service.download(catalog.llm),
			text(r.service.translate(base)),
		]);

		expect(translated).to.equal("llm:Hallo");
		expect(r.llm.calls.load.length).to.equal(1);
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

	it("a GPU model switch unloads the old model and routes the next LLM request to the new one", async () => {
		const r = rig("gpu");
		clock = r.clock;
		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		expect(r.llm.calls.load.map((ref) => ref.id)).to.deep.equal([QWEN3_1_7B_ID]);

		r.service.setLlmModel(QWEN3_4B_ID);
		await r.clock.tickAsync(0);
		expect(r.llm.calls.unload).to.equal(1);
		expect(r.service.catalog.llm.id).to.equal(QWEN3_4B_ID);
		expect((await r.service.route("de", "en"))?.ref.id).to.equal(QWEN3_4B_ID);

		expect(await text(r.service.translate({...base, text: "Welt"}))).to.equal("llm:Welt");
		expect(r.llm.calls.load.map((ref) => ref.id)).to.deep.equal([QWEN3_1_7B_ID, QWEN3_4B_ID]);
		expect(r.llm.calls.translate.map((req) => req.model)).to.deep.equal([
			QWEN3_1_7B_ID,
			QWEN3_4B_ID,
		]);
		// No worker was torn down for it.
		expect(r.workers.length).to.equal(1);
		expect(r.workers[0].terminated).to.equal(false);
		r.service.dispose();
	});

	it("a switch to the model already selected, or to no choice from the default, changes nothing", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await text(r.service.translate(base));
		const before = r.service.catalog;

		r.service.setLlmModel(QWEN3_1_7B_ID);
		r.service.setLlmModel("gone-model-q4f16_1-MLC");
		await r.clock.tickAsync(0);
		expect(r.service.catalog).to.equal(before);
		expect(r.llm.calls.unload).to.equal(0);
		r.service.dispose();
	});

	it("a switch with nothing loaded yet creates no worker", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.service.setLlmModel(QWEN3_4B_ID);
		await r.clock.tickAsync(0);
		expect(r.workers.length).to.equal(0);
		expect((await r.service.route("de", "en"))?.ref.id).to.equal(QWEN3_4B_ID);
		r.service.dispose();
	});

	it("a request in flight finishes on the old model; the switch waits for it", async () => {
		const r = rig("gpu");
		clock = r.clock;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const original = r.llm.translate.bind(r.llm);
		let started = 0;

		r.llm.translate = async function* (req, signal) {
			started++;

			if (started === 1) {
				await gate;
			}

			yield* original(req, signal);
		};

		const running = text(r.service.translate(base));

		await r.clock.tickAsync(0);
		expect(started).to.equal(1);

		r.service.setLlmModel(QWEN3_4B_ID);
		const next = text(r.service.translate({...base, text: "Welt"}));

		await r.clock.tickAsync(0);
		// Neither unloaded under the running request nor replaced by the new load.
		expect(r.llm.calls.unload).to.equal(0);
		expect(r.llm.calls.load.map((ref) => ref.id)).to.deep.equal([QWEN3_1_7B_ID]);
		expect(started).to.equal(1);

		release();
		expect(await running).to.equal("llm:Hallo");
		expect(await next).to.equal("llm:Welt");
		expect(r.llm.calls.unload).to.equal(1);
		expect(r.llm.calls.load.map((ref) => ref.id)).to.deep.equal([QWEN3_1_7B_ID, QWEN3_4B_ID]);
		expect(r.llm.calls.translate.map((req) => req.model)).to.deep.equal([
			QWEN3_1_7B_ID,
			QWEN3_4B_ID,
		]);
		r.service.dispose();
	});

	it("a switch lifts the old model's down-mark; the new model failing marks it down as today", async () => {
		const r = rig("gpu");
		clock = r.clock;
		// Japanese into French: the LLM strictly first, NLLB the next class.
		const jaFr = {...base, from: "ja", to: "fr"};

		r.llm.failLoad = new Error("out of memory");
		expect(await text(r.service.translate(jaFr))).to.equal("seq:Hallo");
		expect((await r.service.route("ja", "fr"))?.candidate).to.equal("nllb");

		r.service.setLlmModel(QWEN3_4B_ID);
		await r.clock.tickAsync(0);
		expect((await r.service.route("ja", "fr"))?.ref.id).to.equal(QWEN3_4B_ID);

		r.llm.failLoad = new Error("no adapter memory");
		expect(await text(r.service.translate(jaFr))).to.equal("seq:Hallo");
		const view = (await r.service.models()).find((v) => v.ref.id === QWEN3_4B_ID);

		expect(view).to.include({status: "failed", error: "no adapter memory"});
		expect((await r.service.route("ja", "fr"))?.candidate).to.equal("nllb");
		r.service.dispose();
	});

	it("builds its table from the selected model's routes with the deploy's merged over them", async () => {
		const asked: string[] = [];
		clock = sinon.useFakeTimers();
		const service = new TranslateService(
			{
				// No worker: the cache question fails and every model counts as absent.
				createClient() {
					throw new Error("no worker in this test");
				},
				probe: () => Promise.resolve(capability("gpu")),
				setTimeout: (fn, ms) => setTimeout(fn, ms),
				clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
			},
			{
				catalog,
				routesFor(id) {
					asked.push(id);
					return id === QWEN3_4B_ID ? {"*": {"*": ["nllb"]}} : {"*": {"*": ["llm"]}};
				},
				routes: {en: {de: ["opus:de-en"]}},
				ortBase: "",
				enabled: true,
			},
			{llm: true, cpu: true}
		);

		expect((await service.route("fr", "ja"))?.candidate).to.equal("llm");
		expect((await service.route("de", "en"))?.candidate).to.equal("opus:de-en");

		service.setLlmModel(QWEN3_4B_ID);
		expect(asked).to.deep.equal([QWEN3_1_7B_ID, QWEN3_4B_ID]);
		expect((await service.route("fr", "ja"))?.candidate).to.equal("nllb");
		// The deploy's override survives the switch.
		expect((await service.route("de", "en"))?.candidate).to.equal("opus:de-en");
		service.dispose();
	});

	it("a GPU model unloads after three idle minutes and a CPU model after five", async () => {
		const r = rig("gpu", true, {en: {de: ["llm"], fr: ["nllb"]}});
		clock = r.clock;
		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		expect(await text(r.service.translate({...base, from: "fr"}))).to.equal("seq:Hallo");

		await r.clock.tickAsync(GPU_IDLE_UNLOAD_MS - 1);
		expect(r.llm.calls.unload).to.equal(0);
		await r.clock.tickAsync(1);
		expect(r.llm.calls.unload).to.equal(1);
		expect(r.seq2seq.calls.unload).to.equal(0);
		expect(r.workers[0].terminated).to.equal(false);

		await r.clock.tickAsync(CPU_IDLE_UNLOAD_MS - GPU_IDLE_UNLOAD_MS - 1);
		expect(r.workers[0].terminated).to.equal(false);
		await r.clock.tickAsync(1);
		// The last model going takes the worker with it.
		expect(r.workers[0].terminated).to.equal(true);

		// A model that unloaded loads again on the next request.
		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		expect(r.llm.calls.load.length).to.equal(2);
		expect(r.workers.length).to.equal(2);
		r.service.dispose();
	});

	it("a request keeps its model's idle clock from starting", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const release = gateLlm(r);
		const running = text(r.service.translate(base));

		await r.clock.tickAsync(CPU_IDLE_UNLOAD_MS * 2);
		expect(r.llm.calls.unload).to.equal(0);
		expect(r.workers[0].terminated).to.equal(false);

		release();
		expect(await running).to.equal("llm:Hallo");
		await r.clock.tickAsync(GPU_IDLE_UNLOAD_MS - 1);
		expect(r.workers[0].terminated).to.equal(false);
		await r.clock.tickAsync(1);
		expect(r.workers[0].terminated).to.equal(true);
		r.service.dispose();
	});

	it("unloads everything at once when translation is not in use and nothing is in flight", async () => {
		const r = rig("gpu");
		clock = r.clock;
		let inUse = true;

		r.service.setInUse(() => inUse);
		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		await r.clock.tickAsync(0);
		expect(r.workers[0].terminated).to.equal(false);

		inUse = false;
		r.service.usageChanged();
		await r.clock.tickAsync(0);
		expect(r.workers[0].terminated).to.equal(true);

		// And it comes back when asked: a fresh worker (the rig's engines
		// outlive their workers, so the load itself is not counted here).
		inUse = true;
		expect(await text(r.service.translate(base))).to.equal("llm:Hallo");
		expect(r.workers.length).to.equal(2);
		r.service.dispose();
	});

	it("translation not in use waits for the request in flight, then unloads", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const release = gateLlm(r);

		r.service.setInUse(() => false);

		const running = text(r.service.translate(base));

		await r.clock.tickAsync(0);
		r.service.usageChanged();
		await r.clock.tickAsync(0);
		expect(r.workers[0].terminated).to.equal(false);

		release();
		expect(await running).to.equal("llm:Hallo");
		await r.clock.tickAsync(0);
		expect(r.workers[0].terminated).to.equal(true);
		r.service.dispose();
	});

	it("a tier switched off in Settings unloads that tier at once", async () => {
		const r = rig("gpu", true, {en: {de: ["llm"], fr: ["nllb"]}});
		clock = r.clock;
		await text(r.service.translate(base));
		await text(r.service.translate({...base, from: "fr"}));

		r.service.setSettings({llm: false, cpu: true});
		await r.clock.tickAsync(0);
		expect(r.llm.calls.unload).to.equal(1);
		expect(r.seq2seq.calls.unload).to.equal(0);
		expect(r.workers[0].terminated).to.equal(false);

		r.service.setSettings({llm: false, cpu: false});
		await r.clock.tickAsync(0);
		// The last loaded tier going takes the worker with it.
		expect(r.workers[0].terminated).to.equal(true);
		r.service.dispose();
	});

	it("a tier switched off while its request runs unloads when the request ends", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const release = gateLlm(r);
		const running = text(r.service.translate(base));

		await r.clock.tickAsync(0);
		r.service.setSettings({llm: false, cpu: true});
		await r.clock.tickAsync(0);
		// Not under the running request.
		expect(r.llm.calls.unload).to.equal(0);
		expect(r.workers[0].terminated).to.equal(false);

		release();
		expect(await running).to.equal("llm:Hallo");
		await r.clock.tickAsync(0);
		expect(r.llm.calls.unload).to.equal(1);
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
			...catalog.llmChoices.map((c) => c.id),
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

	it("onModels hands the new listener the rows as they are now", () => {
		const r = rig("gpu");
		clock = r.clock;
		const seen: string[][] = [];

		r.service.onModels((views) => seen.push(views.map((v) => `${v.ref.id}:${v.status}`)));

		expect(seen.length).to.equal(1);
		expect(seen[0][0]).to.equal(`${catalog.llm.id}:idle`);
		expect(seen[0].length).to.equal(
			// every GPU choice + nllb + the pairs
			catalog.llmChoices.length + 1 + Object.keys(catalog.opus).length
		);
		r.service.dispose();
	});

	it("a worker error of its own reaches the onWorkerError listeners", async () => {
		const r = rig("gpu");
		clock = r.clock;
		const seen: string[] = [];

		r.service.onWorkerError((message) => seen.push(message));
		r.failNextConfigure(new Error("no WebAssembly"));
		await r.service.models();

		expect(seen).to.deep.equal(["no WebAssembly"]);
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

	it("a teardown during a delete leaves the view as it was", async () => {
		const r = rig("gpu");
		clock = r.clock;
		r.hangNextDelete();

		let message = "";
		const pending = r.service.deleteModel(catalog.nllb).catch((e: Error) => {
			message = e.message;
		});

		r.service.pagehide();
		await pending;

		expect(message).to.equal(WORKER_DISPOSED);
		const view = (await r.service.models()).find((v) => v.ref.id === catalog.nllb.id);

		expect(view).to.include({status: "idle", error: null});
	});

	it("an abandoned translation does not leave its view downloading", async () => {
		const r = rig("gpu");
		clock = r.clock;
		let last: {status: string; fraction: number} | null = null;

		r.service.onModels((views) => {
			const llmView = views.find((v) => v.ref.id === catalog.llm.id);

			if (llmView) {
				last = {status: llmView.status, fraction: llmView.fraction};
			}
		});

		for await (const chunk of r.service.translate(base)) {
			expect(chunk.text).to.equal("llm:Hallo");
			break;
		}

		expect(last).to.deep.equal({status: "idle", fraction: 0});
		r.service.dispose();
	});

	it("an abort during a download leaves the model neither ready nor cached", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.capabilities();

		let release: (() => void) | null = null;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		// A load that reports progress and then hangs: the view is
		// "downloading" when the abort arrives.
		r.llm.load = async (ref, onProgress) => {
			onProgress({fraction: 0.4, text: "part 1"});
			await gate;
		};

		let last: {status: string; fraction: number; cached: boolean} | null = null;

		r.service.onModels((views) => {
			const llmView = views.find((v) => v.ref.id === catalog.llm.id);

			if (llmView) {
				last = {
					status: llmView.status,
					fraction: llmView.fraction,
					cached: llmView.cached,
				};
			}
		});

		const controller = new AbortController();
		const chunks: string[] = [];
		const iteration = (async () => {
			for await (const chunk of r.service.translate(base, controller.signal)) {
				chunks.push(chunk.text);
			}
		})();

		for (let i = 0; i < 100 && last?.status !== "downloading"; i++) {
			await Promise.resolve();
		}

		expect(last?.status).to.equal("downloading");

		controller.abort();
		await iteration;
		release?.();

		expect(chunks).to.deep.equal([]);
		expect(last).to.deep.equal({status: "idle", fraction: 0, cached: false});
		r.service.dispose();
	});

	it("an abort signal cancels the client stream at once, before any chunk arrives", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.capabilities();

		let release: (() => void) | null = null;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		// A translate that never yields until released: proves the cancel
		// does not wait on the engine, rather than racing its usual speed.
		r.llm.translate = (req, signal) => {
			r.llm.calls.translate.push(req);

			return (async function* () {
				await gate;

				if (!signal.aborted) {
					yield {id: req.id, text: "too late", done: true};
				}
			})();
		};

		const controller = new AbortController();
		const chunks: string[] = [];
		const iteration = (async () => {
			for await (const chunk of r.service.translate(base, controller.signal)) {
				chunks.push(chunk.text);
			}
		})();

		while (r.llm.calls.translate.length === 0) {
			await Promise.resolve();
		}

		controller.abort();
		await iteration;
		release?.();

		expect(chunks).to.deep.equal([]);
		expect(r.llm.calls.translate.length).to.equal(1);
		r.service.dispose();
	});

	it("one abort listener serves the whole call, whichever candidate ends up running", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.capabilities();
		// the first candidate (llm) fails to load and falls through to the
		// second (opus): the abort must still reach whichever one is current,
		// not a listener left behind closing over the abandoned llm id.
		r.llm.failLoad = new Error("device lost");

		let release: (() => void) | null = null;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});

		r.seq2seq.translate = (req, signal) => {
			r.seq2seq.calls.translate.push(req);

			return (async function* () {
				await gate;

				if (!signal.aborted) {
					yield {id: req.id, text: "too late", done: true};
				}
			})();
		};

		const controller = new AbortController();
		const chunks: string[] = [];
		const iteration = (async () => {
			for await (const chunk of r.service.translate(base, controller.signal)) {
				chunks.push(chunk.text);
			}
		})();

		while (r.seq2seq.calls.translate.length === 0) {
			await Promise.resolve();
		}

		controller.abort();
		await iteration;
		release?.();

		expect(chunks).to.deep.equal([]);
		expect(r.seq2seq.calls.translate.length).to.equal(1);
		expect(r.llm.calls.translate.length).to.equal(0);
		expect((await r.service.route("de", "en"))?.candidate).to.equal("opus:de-en");
		r.service.dispose();
	});

	it("an abort after a teardown creates no worker", async () => {
		const r = rig("gpu");
		clock = r.clock;
		await r.service.capabilities();

		const controller = new AbortController();
		let message = "";
		const iteration = (async () => {
			for await (const chunk of r.service.translate(base, controller.signal)) {
				void chunk; // unreachable: torn down before anything is ever yielded
			}
		})().catch((e: Error) => {
			message = e.message;
		});

		while (r.workers.length === 0) {
			await Promise.resolve();
		}

		// pagehide tears the worker down synchronously (this.worker = null);
		// the abort that follows, in the same tick, must not go through
		// this.client() (which would create a fresh one just to cancel).
		r.service.pagehide();
		controller.abort();
		await iteration;

		expect(message).to.equal(WORKER_DISPOSED);
		expect(r.workers.length).to.equal(1);
	});
});
