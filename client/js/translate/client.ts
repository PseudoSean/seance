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

interface DedupEntry<T> extends Deferred<T> {
	promise: Promise<T>;
}

interface LoadEntry extends DedupEntry<void> {
	onProgress: Array<(p: LoadProgress) => void>;
}

interface StreamEntry {
	queue: AsyncQueue<TranslateChunk>;
	refId: string;
	onProgress: (p: LoadProgress) => void;
}

// A plain copy of a request, not the caller's object itself: a request's
// context is built from live store state (`reader.ts` passes
// `channelTranslation()`'s `settings.terms`, a Vue reactive Proxy, straight
// into `context.terms`), and every port — the fake, and a real Worker —
// structured-clones the message, which throws DataCloneError on a Proxy
// anywhere inside it. The request is plain data (strings, numbers, null,
// nested plain objects and arrays), so a JSON round trip is exact.
function plainRequest(req: TranslateRequest): TranslateRequest {
	return JSON.parse(JSON.stringify(req)) as TranslateRequest;
}

function deferred<T>(): DedupEntry<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return {promise, resolve, reject};
}

export const WORKER_DISPOSED = "translation worker disposed";

/**
 * Why a translation failed, so the service can tell the two apart: `"load"`
 * is the model (the download failed, no memory, no device) and the candidate
 * is marked down for the session; `"request"` is this request (a pair the
 * model has no code for, a batch a seq2seq engine cannot take) and the model
 * stays healthy.
 */
export class TranslateError extends Error {
	constructor(message: string, readonly cause: "load" | "request") {
		super(message);
		this.name = "TranslateError";
	}
}

export class TranslateClient {
	private loads = new Map<string, LoadEntry>();
	private unloads = new Map<EngineName, DedupEntry<void>>();
	private deletes = new Map<string, DedupEntry<void>>();
	private streams = new Map<number, StreamEntry>();
	private statusWaiters: Deferred<Record<EngineName, EngineSnapshot>>[] = [];
	private modelsWaiters: Deferred<ModelCacheState[]>[] = [];
	private disposed = false;
	/** `scope: "worker"`: a configure that threw, or a handler that did. */
	onWorkerError: ((message: string) => void) | null = null;

	constructor(private port: MainPort) {
		port.onmessage = (event) => this.receive(event.data);
	}

	configure(catalog: ModelCatalog, ortBase: string): void {
		this.port.postMessage({type: "configure", catalog, ortBase});
	}

	load(ref: ModelRef, onProgress: (p: LoadProgress) => void = () => {}): Promise<void> {
		const existing = this.loads.get(ref.id);

		if (existing) {
			existing.onProgress.push(onProgress);
			return existing.promise;
		}

		const entry: LoadEntry = {...deferred<void>(), onProgress: [onProgress]};

		this.loads.set(ref.id, entry);
		// A plain copy, not the caller's ref itself: a future call site may
		// hand in a Vue reactive Proxy (Translation.vue already guards with
		// toRaw(), but nothing enforces that upstream), and every port —
		// the fake, and a real Worker — structured-clones the message,
		// which throws DataCloneError on a Proxy.
		this.port.postMessage({type: "load", ref: {...ref}});

		return entry.promise;
	}

	unload(engine: EngineName): Promise<void> {
		const existing = this.unloads.get(engine);

		if (existing) {
			return existing.promise;
		}

		const entry = deferred<void>();

		this.unloads.set(engine, entry);
		this.port.postMessage({type: "unload", engine});

		return entry.promise;
	}

	translate(
		req: TranslateRequest,
		ref: ModelRef,
		onProgress: (p: LoadProgress) => void = () => {}
	): AsyncIterable<TranslateChunk> {
		if (this.streams.has(req.id)) {
			throw new Error(`duplicate translation request id ${req.id}`);
		}

		const queue = new AsyncQueue<TranslateChunk>();

		queue.onReturn = () => this.cancel(req.id);
		this.streams.set(req.id, {queue, refId: ref.id, onProgress});
		this.port.postMessage({type: "translate", req: plainRequest(req), ref: {...ref}});

		return queue;
	}

	cancel(id: number): void {
		const stream = this.streams.get(id);

		if (stream) {
			stream.queue.close();
			this.streams.delete(id);
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
		const existing = this.deletes.get(ref.id);

		if (existing) {
			return existing.promise;
		}

		const entry = deferred<void>();

		this.deletes.set(ref.id, entry);
		this.port.postMessage({type: "delete", ref: {...ref}});

		return entry.promise;
	}

	dispose(): void {
		this.disposed = true;
		this.port.onmessage = null;
		const error = new Error(WORKER_DISPOSED);

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
			stream.queue.fail(error);
		}

		this.loads.clear();
		this.unloads.clear();
		this.deletes.clear();
		this.streams.clear();
		this.statusWaiters = [];
		this.modelsWaiters = [];
	}

	private failStream(id: number, error: Error): void {
		this.streams.get(id)?.queue.fail(error);
		this.streams.delete(id);
	}

	private receive(message: WorkerToMain): void {
		if (this.disposed) {
			return;
		}

		switch (message.type) {
			case "progress":
				this.loads.get(message.ref.id)?.onProgress.forEach((cb) => cb(message.progress));

				for (const stream of this.streams.values()) {
					if (stream.refId === message.ref.id) {
						stream.onProgress(message.progress);
					}
				}

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
				this.streams.get(message.chunk.id)?.queue.push(message.chunk);
				break;
			case "done":
				this.streams.get(message.id)?.queue.close();
				this.streams.delete(message.id);
				break;

			case "error": {
				const error = new Error(message.message);

				if (message.scope === "load" && message.id !== undefined) {
					// The implicit load of a translation: nothing asked for
					// this load, so it fails that stream and says why.
					this.failStream(message.id, new TranslateError(message.message, "load"));
				} else if (message.scope === "load" && message.ref) {
					this.loads
						.get(message.ref.id)
						?.reject(new TranslateError(message.message, "load"));
					this.loads.delete(message.ref.id);
				} else if (message.scope === "unload" && message.engine) {
					this.unloads.get(message.engine)?.reject(error);
					this.unloads.delete(message.engine);
				} else if (message.scope === "translate" && message.id !== undefined) {
					this.failStream(message.id, new TranslateError(message.message, "request"));
				} else if (message.scope === "worker") {
					this.onWorkerError?.(message.message);
				} else if (message.scope === "delete" && message.ref) {
					this.deletes.get(message.ref.id)?.reject(error);
					this.deletes.delete(message.ref.id);
				} else if (message.scope === "status") {
					this.statusWaiters.splice(0).forEach((w) => w.reject(error));
				} else if (message.scope === "models") {
					this.modelsWaiters.splice(0).forEach((w) => w.reject(error));
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
