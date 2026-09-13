// The main-thread orchestrator (spec § service, § Lifecycle): probes once,
// routes a request, loads the model on demand, marks a candidate down for
// the session when its model cannot load or translate, and takes the next.
// The worker is created lazily and terminated after IDLE_UNLOAD_MS with
// nothing in flight, or on pagehide. Model views feed Settings. Vue-free:
// index.ts wires the real worker, the store and the settings.

import {Capability} from "./capability";
import {TranslateClient, TranslateError, WORKER_DISPOSED} from "./client";
import {LoadProgress, ModelRef, TranslateChunk, TranslateRequest} from "./engine";
import {Candidate, ModelCatalog, candidateOf, catalogModels, selectLlm} from "./models";
import {Route, RouteTable, mergeRoutes, resolveRoute} from "./router";
import {routesFor as shippedRoutesFor} from "./routes.default";

export const IDLE_UNLOAD_MS = 10 * 60 * 1000;
export const TRANSLATION_UNAVAILABLE = "no translation engine can take this request";

export interface ServiceDeps {
	createClient(): {client: TranslateClient; terminate(): void};
	probe(): Promise<Capability>;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface ServiceOptions {
	/** Its `llm` is the selected GPU model; `setLlmModel` changes it. */
	catalog: ModelCatalog;
	/** The deploy's `translation.routes`, merged over the selected model's table. */
	routes?: RouteTable;
	/** The shipped table for a GPU model id; `routes.default.ts` `routesFor` unless a test swaps it. */
	routesFor?: (llmModelId: string) => RouteTable;
	ortBase: string;
	enabled: boolean;
}

export interface ServiceSettings {
	llm: boolean;
	cpu: boolean;
}

export type ModelStatus = "idle" | "downloading" | "ready" | "failed";

export interface ModelView {
	ref: ModelRef;
	cached: boolean;
	status: ModelStatus;
	fraction: number;
	error: string | null;
}

/** What a strip or a reading line says while its model downloads. */
export function downloadNote(view: ModelView): string {
	return `Downloading ${view.ref.label}… ${Math.round(view.fraction * 100)}%`;
}

export class TranslateService {
	private worker: {client: TranslateClient; terminate(): void} | null = null;
	private capability: Promise<Capability> | null = null;
	private down = new Set<Candidate>();
	private idleTimer: unknown = null;
	private inFlight = 0;
	private nextId = 1;
	private views = new Map<string, ModelView>();
	private listeners = new Set<(views: ModelView[]) => void>();
	private workerErrorListeners = new Set<(message: string) => void>();
	private generation = 0;
	private disposed = false;
	/** Once per service: which models are downloaded, for the router's in-class preference. */
	private cacheKnown: Promise<void> | null = null;
	/** Moves on every download progress event (`loadTicks`). */
	private ticks = 0;
	/** The selected GPU model's table with the deploy's overrides merged in. */
	private table: RouteTable;
	/** Running LLM streams by model id: a model is unloaded only once its own are done. */
	private llmRunning = new Map<string, number>();
	private llmWaiters: {ready: () => boolean; resolve: () => void}[] = [];
	/**
	 * A GPU model switch still settling: the old model's running requests
	 * finishing, then its unload. LLM work waits for it, since loading
	 * another model into WebLLM tears down the engine a request is still
	 * generating on.
	 */
	private llmSwitch: Promise<void> | null = null;

	constructor(
		private deps: ServiceDeps,
		private options: ServiceOptions,
		private settings: ServiceSettings
	) {
		for (const ref of catalogModels(options.catalog)) {
			this.views.set(ref.id, {ref, cached: false, status: "idle", fraction: 0, error: null});
		}

		this.table = this.buildTable();
	}

	get enabled(): boolean {
		return this.options.enabled;
	}

	/** The catalog as it stands: `catalog.llm` is the selected GPU model. */
	get catalog(): ModelCatalog {
		return this.options.catalog;
	}

	/**
	 * Selects the GPU model (an id that is not a choice selects the default).
	 * Nothing in flight is cancelled or failed: a running LLM request
	 * finishes on the old model, which is unloaded after it, and every LLM
	 * request routed from now on — a queued reading line included — goes to
	 * the new one. The LLM candidate's down-mark is lifted: it was the old
	 * model's.
	 */
	setLlmModel(id: string | null): void {
		const next = selectLlm(this.options.catalog, id);

		if (next === this.options.catalog) {
			return;
		}

		const previous = this.options.catalog.llm.id;

		this.options = {...this.options, catalog: next};
		this.table = this.buildTable();
		this.down.delete("llm");
		this.retireLlm(previous);
	}

	private buildTable(): RouteTable {
		const shipped = (this.options.routesFor ?? shippedRoutesFor)(this.options.catalog.llm.id);

		return mergeRoutes(shipped, this.options.routes ?? {});
	}

	/** Unload `id` once its running requests are done, unless it is selected again by then. */
	private retireLlm(id: string): void {
		const worker = this.worker;

		if (!worker) {
			// No worker, nothing loaded.
			return;
		}

		const gen = this.generation;
		const before = this.llmSwitch ?? Promise.resolve();
		const settling: Promise<void> = before
			.then(() => this.whenLlm(() => !this.llmRunning.get(id)))
			.then(async () => {
				if (
					this.generation !== gen ||
					this.worker !== worker ||
					this.options.catalog.llm.id === id
				) {
					return;
				}

				const status = await worker.client.status();

				if (status.llm.models.includes(id)) {
					await worker.client.unload("llm");
				}
			})
			.catch(() => {
				// A worker torn down meanwhile unloaded everything anyway.
			})
			.then(() => {
				if (this.llmSwitch === settling) {
					this.llmSwitch = null;
				}
			});

		this.llmSwitch = settling;
	}

	private whenLlm(ready: () => boolean): Promise<void> {
		if (ready()) {
			return Promise.resolve();
		}

		return new Promise((resolve) => this.llmWaiters.push({ready, resolve}));
	}

	private llmStarted(id: string): void {
		this.llmRunning.set(id, (this.llmRunning.get(id) ?? 0) + 1);
	}

	private llmEnded(id: string): void {
		const left = (this.llmRunning.get(id) ?? 1) - 1;

		if (left > 0) {
			this.llmRunning.set(id, left);
		} else {
			this.llmRunning.delete(id);
		}

		const waiting = this.llmWaiters;

		this.llmWaiters = [];

		for (const waiter of waiting) {
			if (waiter.ready()) {
				waiter.resolve();
			} else {
				this.llmWaiters.push(waiter);
			}
		}
	}

	capabilities(): Promise<Capability> {
		if (!this.capability) {
			this.capability = this.deps.probe().catch(
				(e): Capability => ({
					tier: "none",
					reasons: [e instanceof Error ? e.message : String(e)],
					f16: false,
					maxBufferBytes: 0,
					deviceMemoryGiB: null,
					storageQuotaBytes: null,
				})
			);
		}

		return this.capability;
	}

	setSettings(settings: ServiceSettings): void {
		this.settings = settings;
	}

	/**
	 * The route for a pair. `hint` is the request's source hint: it picks the
	 * table row when `from` is null and lets a seq2seq candidate run with it
	 * as the source (router.ts). The first call asks the worker what is
	 * downloaded, once: without that every model counts as absent until
	 * Settings is opened, and the router could not prefer a downloaded one.
	 */
	async route(
		from: string | null,
		to: string,
		hint: string | null = null
	): Promise<Route | null> {
		if (!this.options.enabled) {
			return null;
		}

		const capability = await this.capabilities();

		if (capability.tier !== "none") {
			await this.primeCache();
		}

		return resolveRoute(this.table, this.options.catalog, {
			from,
			hint,
			to,
			tier: capability.tier,
			allowLlm: this.settings.llm,
			allowCpu: this.settings.cpu,
			down: this.down,
			cached: (ref: ModelRef) => this.views.get(ref.id)?.cached === true,
		});
	}

	/**
	 * A counter that moves on every progress event of a load a translation
	 * is waiting for. The reading queue and the composer re-arm a request
	 * deadline that runs out while it is still moving (outgoing.ts
	 * `armDeadline`): the router sends a request to the best class whether
	 * its model is downloaded or not, and a request waiting for a 620 MB
	 * download must not time out while the download progresses. A download
	 * started from Settings does not move it on its own (a translation that
	 * joins that download does, through its own progress callback: client.ts
	 * hands every joined load the same events), so a request stuck on an
	 * engine is kept alive at most as long as another request's download.
	 */
	loadTicks(): number {
		return this.ticks;
	}

	/**
	 * Tries the candidates in route order; a candidate that fails is down for
	 * the session. A model that is not downloaded is downloaded here, its
	 * progress on the model views; one that fails to download is down, and
	 * the next class takes the request with the reason kept for the error.
	 */
	async *translate(
		request: Omit<TranslateRequest, "id" | "model">,
		signal?: AbortSignal
	): AsyncIterable<TranslateChunk> {
		if (signal?.aborted) {
			return;
		}

		this.inFlight++;
		this.clearIdle();

		let attemptedView: ModelView | null = null;
		let completed = false;
		// "<model id>: <reason>" of the last candidate whose model would not
		// load in this call. Every candidate failing that way is still
		// TRANSLATION_UNAVAILABLE to the caller, but a bare "no translation
		// engine can take this request" is what a broken CPU tier looked like
		// for a whole live test: the reason has to travel with it.
		let lastLoadError: string | null = null;
		// One listener for the whole call, whichever candidate is currently
		// running: a candidate that fails to load falls through to the next,
		// which would otherwise register another listener on the caller's
		// signal every time, each closing over an id already abandoned.
		let currentId = 0;
		const hint = request.hint ?? request.context.sourceHint ?? null;
		// A teardown (pagehide, unload all) while the route was still being
		// resolved -- the first route asks the worker what is downloaded --
		// ends this call like one during the translation itself, rather than
		// creating a new worker to carry on.
		const startGeneration = this.generation;

		const onAbort = () => {
			if (currentId) {
				this.worker?.client.cancel(currentId);
			}
		};

		signal?.addEventListener("abort", onAbort, {once: true});

		try {
			for (;;) {
				const route = await this.route(request.from, request.to, hint);

				if (this.generation !== startGeneration) {
					throw new Error(WORKER_DISPOSED);
				}

				if (!route) {
					throw new Error(
						lastLoadError
							? `${TRANSLATION_UNAVAILABLE}: ${lastLoadError}`
							: TRANSLATION_UNAVAILABLE
					);
				}

				// A GPU model switch is settling: the old model's requests
				// are still generating, and loading the new one would tear
				// their engine down. Wait, then route again, since the
				// selection may have moved on meanwhile.
				if (route.ref.engine === "llm" && this.llmSwitch) {
					await this.llmSwitch;
					continue;
				}

				const client = this.client();
				const gen = this.generation;
				const id = this.nextId++;
				// A seq2seq model has no prompt to detect a source in: it takes
				// the hint as its source. The LLM keeps `from: null`.
				const from = request.from ?? (route.ref.engine === "seq2seq" ? hint : null);
				const req: TranslateRequest = {...request, from, id, model: route.ref.id};
				const view = this.view(route.ref);
				let yielded = false;

				attemptedView = view;
				currentId = id;

				const llmId = route.ref.engine === "llm" ? route.ref.id : null;

				if (llmId) {
					this.llmStarted(llmId);
				}

				try {
					for await (const chunk of client.translate(
						req,
						route.ref,
						(progress: LoadProgress) => {
							this.ticks++;
							view.status = "downloading";
							view.fraction = progress.fraction;
							this.publish();
						}
					)) {
						yielded = true;
						yield chunk;
					}

					// A cancel ends the stream normally (client.ts closes it at
					// once, without waiting for the engine), so arriving here is
					// no proof the model did: leave the view to the `finally`,
					// which puts a half-downloaded one back to idle.
					if (signal?.aborted) {
						return;
					}

					if (view.status === "downloading") {
						view.status = "ready";
						view.fraction = 1;
						view.cached = true;
						this.publish();
					}

					completed = true;

					return;
				} catch (e) {
					if (this.generation !== gen) {
						throw e;
					}

					if (yielded) {
						throw e;
					}

					// Only the model failing takes the candidate out of the
					// session: a request this model cannot serve (an unknown
					// pair, a batch a seq2seq engine will not take) is the
					// caller's to see, and the next candidate would refuse it
					// the same way.
					if (!(e instanceof TranslateError) || e.cause !== "load") {
						throw e;
					}

					// The same record `download()` keeps, so Settings' model row
					// says why this one is out and the caller's error carries
					// the reason of the last candidate that would not load.
					const message = e instanceof Error ? e.message : String(e);

					view.status = "failed";
					view.error = message;
					this.publish();

					lastLoadError = `${route.ref.id}: ${message}`;

					// A GPU model that was switched away from while it loaded
					// is no longer what the candidate runs: its failure does
					// not take the new model down with it.
					if (!llmId || llmId === this.options.catalog.llm.id) {
						this.down.add(route.candidate);
					}
				} finally {
					if (llmId) {
						this.llmEnded(llmId);
					}
				}
			}
		} finally {
			signal?.removeEventListener("abort", onAbort);

			if (attemptedView && attemptedView.status === "downloading" && !completed) {
				attemptedView.status = "idle";
				attemptedView.fraction = 0;
				this.publish();
			}

			this.inFlight--;
			this.scheduleIdle();
		}
	}

	async models(): Promise<ModelView[]> {
		if (!this.options.enabled) {
			return [];
		}

		this.inFlight++;
		this.clearIdle();

		try {
			const states = await this.client().models();

			for (const state of states) {
				const view = this.views.get(state.ref.id);

				if (view) {
					view.cached = state.cached;

					if (state.cached && (view.status === "idle" || view.status === "failed")) {
						view.status = "ready";
						view.fraction = 1;
						view.error = null;
					}

					if (!state.cached && view.status === "ready") {
						view.status = "idle";
						view.fraction = 0;
					}
				}
			}

			this.publish();

			return this.snapshot();
		} finally {
			this.inFlight--;
			this.scheduleIdle();
		}
	}

	private primeCache(): Promise<void> {
		if (!this.cacheKnown) {
			this.cacheKnown = this.models().then(
				() => undefined,
				(e: unknown) => {
					// Torn down mid-question: ask again next time. Any other
					// failure is left alone, and every model counts as absent.
					if (e instanceof Error && e.message === WORKER_DISPOSED) {
						this.cacheKnown = null;
					}
				}
			);
		}

		return this.cacheKnown;
	}

	/** The listener is called at once with what the rows look like now. */
	onModels(listener: (views: ModelView[]) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshot());

		return () => this.listeners.delete(listener);
	}

	/** Errors the worker reports for itself: a configure that threw, a handler that did. */
	onWorkerError(listener: (message: string) => void): () => void {
		this.workerErrorListeners.add(listener);

		return () => this.workerErrorListeners.delete(listener);
	}

	async download(ref: ModelRef): Promise<void> {
		const view = this.view(ref);

		view.status = "downloading";
		view.fraction = 0;
		view.error = null;
		this.publish();
		this.inFlight++;
		this.clearIdle();

		try {
			if (ref.engine === "llm") {
				// WebLLM holds one model: loading this one while a request
				// generates on another would end that request.
				if (this.llmSwitch) {
					await this.llmSwitch;
				}

				await this.whenLlm(() => [...this.llmRunning.keys()].every((id) => id === ref.id));
			}

			await this.client().load(ref, (progress: LoadProgress) => {
				view.fraction = progress.fraction;
				this.publish();
			});
			view.status = "ready";
			view.fraction = 1;
			view.cached = true;
			// It loads again: whatever took this candidate out of the session
			// (a download that failed, a device that was lost) is over.
			this.down.delete(candidateOf(ref));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);

			if (message === WORKER_DISPOSED) {
				view.status = "idle";
				view.fraction = 0;
				view.error = null;
			} else {
				view.status = "failed";
				view.error = message;
			}

			throw e;
		} finally {
			this.inFlight--;
			this.scheduleIdle();
			this.publish();
		}
	}

	async deleteModel(ref: ModelRef): Promise<void> {
		const view = this.view(ref);

		this.inFlight++;
		this.clearIdle();

		try {
			await this.client().unload(ref.engine);
			await this.client().deleteModel(ref);
			view.cached = false;
			view.status = "idle";
			view.fraction = 0;
			view.error = null;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);

			if (message === WORKER_DISPOSED) {
				view.error = null;
			} else {
				view.status = "failed";
				view.error = message;
			}

			throw e;
		} finally {
			this.inFlight--;
			this.scheduleIdle();
			this.publish();
		}
	}

	/** Drop every loaded model and the worker with them. */
	unloadAll(): Promise<void> {
		this.teardown();

		return Promise.resolve();
	}

	pagehide(): void {
		this.teardown();
	}

	dispose(): void {
		this.disposed = true;
		this.teardown();
		this.listeners.clear();
		this.workerErrorListeners.clear();
	}

	private client(): TranslateClient {
		if (this.disposed || !this.options.enabled) {
			throw new Error(TRANSLATION_UNAVAILABLE);
		}

		if (!this.worker) {
			this.worker = this.deps.createClient();

			this.worker.client.onWorkerError = (message: string) => {
				for (const listener of this.workerErrorListeners) {
					listener(message);
				}
			};

			this.worker.client.configure(this.options.catalog, this.options.ortBase);
		}

		return this.worker.client;
	}

	private teardown(): void {
		this.clearIdle();
		this.generation++;

		if (this.worker) {
			this.worker.client.dispose();
			this.worker.terminate();
			this.worker = null;
		}
	}

	private scheduleIdle(): void {
		this.clearIdle();

		if (this.worker && this.inFlight === 0) {
			this.idleTimer = this.deps.setTimeout(() => {
				this.idleTimer = null;

				if (this.inFlight === 0) {
					this.teardown();
				}
			}, IDLE_UNLOAD_MS);
		}
	}

	private clearIdle(): void {
		if (this.idleTimer !== null) {
			this.deps.clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private view(ref: ModelRef): ModelView {
		let view = this.views.get(ref.id);

		if (!view) {
			view = {ref, cached: false, status: "idle", fraction: 0, error: null};
			this.views.set(ref.id, view);
		}

		return view;
	}

	private snapshot(): ModelView[] {
		return catalogModels(this.options.catalog).map((ref) => {
			const view: ModelView = this.views.get(ref.id) ?? {
				ref,
				cached: false,
				status: "idle",
				fraction: 0,
				error: null,
			};

			return {...view};
		});
	}

	private publish(): void {
		const views = this.snapshot();

		for (const listener of this.listeners) {
			listener(views);
		}
	}
}
