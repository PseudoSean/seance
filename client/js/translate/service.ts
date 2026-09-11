// The main-thread orchestrator (spec § service, § Lifecycle): probes once,
// routes a request, loads the model on demand, marks a candidate down for
// the session when its model cannot load or translate, and takes the next.
// The worker is created lazily and terminated after IDLE_UNLOAD_MS with
// nothing in flight, or on pagehide. Model views feed Settings. Vue-free:
// index.ts wires the real worker, the store and the settings.

import {Capability} from "./capability";
import {TranslateClient} from "./client";
import {LoadProgress, ModelRef, TranslateChunk, TranslateRequest} from "./engine";
import {Candidate, ModelCatalog, catalogModels} from "./models";
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
			this.capability = this.deps.probe();
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
		request: Omit<TranslateRequest, "id" | "model">
	): AsyncIterable<TranslateChunk> {
		this.inFlight++;
		this.clearIdle();

		try {
			for (;;) {
				const route = await this.route(request.from, request.to);

				if (!route) {
					throw new Error(TRANSLATION_UNAVAILABLE);
				}

				const id = this.nextId++;
				const req: TranslateRequest = {...request, id, model: route.ref.id};
				let yielded = false;

				try {
					for await (const chunk of this.client().translate(req, route.ref)) {
						yielded = true;
						yield chunk;
					}

					return;
				} catch (e) {
					if (yielded) {
						throw e;
					}

					this.down.add(route.candidate);
				}
			}
		} finally {
			this.inFlight--;
			this.scheduleIdle();
		}
	}

	async models(): Promise<ModelView[]> {
		if (!this.options.enabled) {
			return [];
		}

		const states = await this.client().models();

		for (const state of states) {
			const view = this.views.get(state.ref.id);

			if (view) {
				view.cached = state.cached;

				if (state.cached && view.status === "idle") {
					view.status = "ready";
					view.fraction = 1;
				}

				if (!state.cached && view.status === "ready") {
					view.status = "idle";
					view.fraction = 0;
				}
			}
		}

		this.scheduleIdle();
		this.publish();

		return this.snapshot();
	}

	onModels(listener: (views: ModelView[]) => void): () => void {
		this.listeners.add(listener);

		return () => this.listeners.delete(listener);
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
		} catch (e) {
			view.status = "failed";
			view.error = e instanceof Error ? e.message : String(e);
			throw e;
		} finally {
			this.inFlight--;
			this.scheduleIdle();
			this.publish();
		}
	}

	async deleteModel(ref: ModelRef): Promise<void> {
		const view = this.view(ref);

		await this.client().unload(ref.engine);
		await this.client().deleteModel(ref);
		view.cached = false;
		view.status = "idle";
		view.fraction = 0;
		view.error = null;
		this.scheduleIdle();
		this.publish();
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
		this.teardown();
		this.listeners.clear();
	}

	private client(): TranslateClient {
		if (!this.options.enabled) {
			throw new Error(TRANSLATION_UNAVAILABLE);
		}

		if (!this.worker) {
			this.worker = this.deps.createClient();
			this.worker.client.configure(this.options.catalog, this.options.ortBase);
		}

		return this.worker.client;
	}

	private teardown(): void {
		this.clearIdle();

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
		return catalogModels(this.options.catalog).map((ref) => ({...this.view(ref)}));
	}

	private publish(): void {
		const views = this.snapshot();

		for (const listener of this.listeners) {
			listener(views);
		}
	}
}
