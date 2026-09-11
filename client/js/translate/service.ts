// The main-thread orchestrator (spec § service, § Lifecycle): probes once,
// routes a request, loads the model on demand, marks a candidate down for
// the session when its model cannot load or translate, and takes the next.
// The worker is created lazily and terminated after IDLE_UNLOAD_MS with
// nothing in flight, or on pagehide. Model views feed Settings. Vue-free:
// index.ts wires the real worker, the store and the settings.

import {Capability} from "./capability";
import {TranslateClient, TranslateError, WORKER_DISPOSED} from "./client";
import {LoadProgress, ModelRef, TranslateChunk, TranslateRequest} from "./engine";
import {Candidate, ModelCatalog, candidateOf, catalogModels} from "./models";
import {Route, RouteTable, resolveRoute} from "./router";

export const IDLE_UNLOAD_MS = 10 * 60 * 1000;
export const TRANSLATION_UNAVAILABLE = "no translation engine can take this request";

export interface ServiceDeps {
	createClient(): {client: TranslateClient; terminate(): void};
	probe(): Promise<Capability>;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface ServiceOptions {
	catalog: ModelCatalog;
	routes: RouteTable;
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

	constructor(
		private deps: ServiceDeps,
		private options: ServiceOptions,
		private settings: ServiceSettings
	) {
		for (const ref of catalogModels(options.catalog)) {
			this.views.set(ref.id, {ref, cached: false, status: "idle", fraction: 0, error: null});
		}
	}

	get enabled(): boolean {
		return this.options.enabled;
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

	async route(from: string | null, to: string): Promise<Route | null> {
		if (!this.options.enabled) {
			return null;
		}

		const capability = await this.capabilities();

		return resolveRoute(this.options.routes, this.options.catalog, {
			from,
			to,
			tier: capability.tier,
			allowLlm: this.settings.llm,
			allowCpu: this.settings.cpu,
			down: this.down,
		});
	}

	/** Tries the candidates in route order; a candidate that fails is down for the session. */
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
		// One listener for the whole call, whichever candidate is currently
		// running: a candidate that fails to load falls through to the next,
		// which would otherwise register another listener on the caller's
		// signal every time, each closing over an id already abandoned.
		let currentId = 0;

		const onAbort = () => {
			if (currentId) {
				this.worker?.client.cancel(currentId);
			}
		};

		signal?.addEventListener("abort", onAbort, {once: true});

		try {
			for (;;) {
				const route = await this.route(request.from, request.to);

				if (!route) {
					throw new Error(TRANSLATION_UNAVAILABLE);
				}

				const client = this.client();
				const gen = this.generation;
				const id = this.nextId++;
				const req: TranslateRequest = {...request, id, model: route.ref.id};
				const view = this.view(route.ref);
				let yielded = false;

				attemptedView = view;
				currentId = id;

				try {
					for await (const chunk of client.translate(
						req,
						route.ref,
						(progress: LoadProgress) => {
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

					this.down.add(route.candidate);
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
