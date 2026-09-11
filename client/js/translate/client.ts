// The page's side of the worker protocol: promises for the one-shot
// messages, an AsyncQueue per translation stream. One instance per worker;
// `dispose()` rejects everything still pending (the idle unload and
// pagehide terminate the worker right after).

import {AsyncQueue} from "./asyncQueue";
import {EngineName, LoadProgress, ModelRef, TranslateChunk, TranslateRequest} from "./engine";
import {ModelCacheState, ModelCatalog} from "./models";
import {EngineSnapshot, MainPort, WorkerToMain} from "./protocol";

interface Deferred<T> {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
}

const DISPOSED = "translation worker disposed";

export class TranslateClient {
	private loads = new Map<string, Deferred<void> & {onProgress: (p: LoadProgress) => void}>();
	private unloads = new Map<EngineName, Deferred<void>>();
	private deletes = new Map<string, Deferred<void>>();
	private streams = new Map<number, AsyncQueue<TranslateChunk>>();
	private statusWaiters: Deferred<Record<EngineName, EngineSnapshot>>[] = [];
	private modelsWaiters: Deferred<ModelCacheState[]>[] = [];
	private disposed = false;

	constructor(private port: MainPort) {
		port.onmessage = (event) => this.receive(event.data);
	}

	configure(catalog: ModelCatalog, ortBase: string): void {
		this.port.postMessage({type: "configure", catalog, ortBase});
	}

	load(ref: ModelRef, onProgress: (p: LoadProgress) => void = () => {}): Promise<void> {
		return new Promise((resolve, reject) => {
			this.loads.set(ref.id, {resolve, reject, onProgress});
			this.port.postMessage({type: "load", ref});
		});
	}

	unload(engine: EngineName): Promise<void> {
		return new Promise((resolve, reject) => {
			this.unloads.set(engine, {resolve, reject});
			this.port.postMessage({type: "unload", engine});
		});
	}

	translate(req: TranslateRequest, ref: ModelRef): AsyncIterable<TranslateChunk> {
		const queue = new AsyncQueue<TranslateChunk>();

		queue.onReturn = () => this.cancel(req.id);
		this.streams.set(req.id, queue);
		this.port.postMessage({type: "translate", req, ref});

		return queue;
	}

	cancel(id: number): void {
		if (this.streams.delete(id)) {
			this.port.postMessage({type: "cancel", id});
		}
	}

	status(): Promise<Record<EngineName, EngineSnapshot>> {
		return new Promise((resolve, reject) => {
			this.statusWaiters.push({resolve, reject});
			this.port.postMessage({type: "status"});
		});
	}

	models(): Promise<ModelCacheState[]> {
		return new Promise((resolve, reject) => {
			this.modelsWaiters.push({resolve, reject});
			this.port.postMessage({type: "models"});
		});
	}

	deleteModel(ref: ModelRef): Promise<void> {
		return new Promise((resolve, reject) => {
			this.deletes.set(ref.id, {resolve, reject});
			this.port.postMessage({type: "delete", ref});
		});
	}

	dispose(): void {
		this.disposed = true;
		this.port.onmessage = null;
		const error = new Error(DISPOSED);

		for (const load of this.loads.values()) {
			load.reject(error);
		}

		for (const waiter of [
			...this.unloads.values(),
			...this.deletes.values(),
			...this.statusWaiters,
			...this.modelsWaiters,
		]) {
			waiter.reject(error);
		}

		for (const stream of this.streams.values()) {
			stream.fail(error);
		}

		this.loads.clear();
		this.unloads.clear();
		this.deletes.clear();
		this.streams.clear();
		this.statusWaiters = [];
		this.modelsWaiters = [];
	}

	private receive(message: WorkerToMain): void {
		if (this.disposed) {
			return;
		}

		switch (message.type) {
			case "progress":
				this.loads.get(message.ref.id)?.onProgress(message.progress);
				break;
			case "loaded":
				this.loads.get(message.ref.id)?.resolve();
				this.loads.delete(message.ref.id);
				break;
			case "unloaded":
				this.unloads.get(message.engine)?.resolve();
				this.unloads.delete(message.engine);
				break;
			case "chunk":
				this.streams.get(message.chunk.id)?.push(message.chunk);
				break;
			case "done":
				this.streams.get(message.id)?.close();
				this.streams.delete(message.id);
				break;
			case "error": {
				const error = new Error(message.message);

				if (message.scope === "load" && message.ref) {
					this.loads.get(message.ref.id)?.reject(error);
					this.loads.delete(message.ref.id);
				} else if (message.scope === "translate" && message.id !== undefined) {
					this.streams.get(message.id)?.fail(error);
					this.streams.delete(message.id);
				} else if (message.scope === "delete" && message.ref) {
					this.deletes.get(message.ref.id)?.reject(error);
					this.deletes.delete(message.ref.id);
				}

				break;
			}
			case "status":
				this.statusWaiters.splice(0).forEach((w) => w.resolve(message.engines));
				break;
			case "models":
				this.modelsWaiters.splice(0).forEach((w) => w.resolve(message.models));
				break;
			case "deleted":
				this.deletes.get(message.ref.id)?.resolve();
				this.deletes.delete(message.ref.id);
				break;
		}
	}
}
