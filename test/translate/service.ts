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
		failNextConfigure(error: Error) {
			failConfigure = error;
		},
		hangNextDelete() {
			hangDelete = true;
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

	it("onModels hands the new listener the rows as they are now", () => {
		const r = rig("gpu");
		clock = r.clock;
		const seen: string[][] = [];

		r.service.onModels((views) => seen.push(views.map((v) => `${v.ref.id}:${v.status}`)));

		expect(seen.length).to.equal(1);
		expect(seen[0][0]).to.equal(`${catalog.llm.id}:idle`);
		expect(seen[0].length).to.equal(
			2 + Object.keys(catalog.opus).length // llm + nllb + the pairs
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
